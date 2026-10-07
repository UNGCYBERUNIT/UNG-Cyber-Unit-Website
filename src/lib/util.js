// ─── Misc utilities ───────────────────────────────────────────────────────────
// Small, mostly-pure helpers with no natural home elsewhere: date/streak math,
// room codes, answer normalization, CSV/JSON question-upload parsing, and the
// leaderboard-rank query.

import { jsonResponse } from './http.js';

// YYYY-MM-DD in UTC, offset by `days` (0 = today, -1 = yesterday). Used for
// the daily learning streak.
export function dateStrUTC(days = 0) {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

// New daily-streak value given the stored streak, the user's last-active date,
// and today's/yesterday's dates. Same day = unchanged; consecutive day = +1;
// any other gap (or never active) = reset to 1.
export function nextStreak(prevStreak, lastActive, today, yesterday) {
  if (lastActive === today) return prevStreak || 1;
  if (lastActive === yesterday) return (prevStreak || 0) + 1;
  return 1;
}

export function generateRoomCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const bytes = crypto.getRandomValues(new Uint8Array(8));
  const r = i => chars[bytes[i] % chars.length];
  return `${r(0)}${r(1)}${r(2)}${r(3)}-${r(4)}${r(5)}${r(6)}${r(7)}`;
}

// Per-question miss-rate for a Quiz Room's instructor analytics view.
// `answers` is every quiz_room_answers row across all attempts in the room
// (just `question_id`/`is_correct`). Ungraded free-response answers
// (`is_correct === null`) are pending — excluded from both the numerator and
// denominator, since counting them as wrong (or dividing by a count that
// includes them) would misrepresent the rate while a grading backlog exists.
export function computeMissRates(questions, answers) {
  return questions.map(q => {
    const forQuestion = answers.filter(a => a.question_id === q.id);
    const pendingCount = forQuestion.filter(a => a.is_correct === null).length;
    const graded = forQuestion.filter(a => a.is_correct !== null);
    const incorrect = graded.filter(a => a.is_correct === 0).length;
    return {
      id: q.id,
      question: q.question,
      answeredCount: forQuestion.length,
      pendingCount,
      missRate: graded.length > 0 ? incorrect / graded.length : 0,
    };
  });
}

// A user's rank on a leaderboard, using the same ordering as /api/leaderboard
// (points, then count, then username). `table` is a fixed internal name, never
// user input. Returns null for guests or users with no points.
export async function leaderboardRank(env, table, userId, username) {
  const agg = await env.DB.prepare(
    `SELECT SUM(score) AS points, COUNT(*) AS count FROM ${table} WHERE user_id = ?`
  ).bind(userId).first();
  const points = agg?.points ?? 0;
  const count = agg?.count ?? 0;
  if (points <= 0) return null;
  const row = await env.DB.prepare(`
    SELECT COUNT(*) + 1 AS rank FROM (
      SELECT u.username, SUM(t.score) AS pts, COUNT(*) AS cnt
      FROM users u JOIN ${table} t ON t.user_id = u.id
      WHERE u.role != 'guest'
      GROUP BY u.id
    ) x
    WHERE x.pts > ?
       OR (x.pts = ? AND x.cnt > ?)
       OR (x.pts = ? AND x.cnt = ? AND x.username < ?)
  `).bind(points, points, count, points, count, username).first();
  return row?.rank ?? null;
}

// ─── Quiz Room / Question Upload Helpers ─────────────────────────────────────

export const MAX_QUESTION_LEN = 1000;
export const MAX_ANSWER_LEN = 300;
export const MAX_EXPLANATION_LEN = 2000;
export const MAX_ANSWER_SUBMIT_LEN = 200;

export function normalizeAnswer(s) {
  return String(s ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
}

// Uniform response for any code that can't be joined (unknown, closed, or
// expired) so responses can't be used to probe which private rooms exist.
export function roomUnavailable() {
  return jsonResponse({ error: 'Room not found or unavailable.' }, 404);
}

export function parseCSVLine(line) {
  const result = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"' && line[i + 1] === '"') { current += '"'; i++; }
      else if (ch === '"') { inQuotes = false; }
      else { current += ch; }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ',') {
      result.push(current.trim()); current = '';
    } else {
      current += ch;
    }
  }
  result.push(current.trim());
  return result;
}

export function parseCSV(text) {
  const lines = text.trim().split(/\r?\n/);
  if (lines.length < 2) return { error: 'CSV must have a header row and at least one question' };
  const headers = parseCSVLine(lines[0]).map(h => h.toLowerCase().trim());
  if (!headers.includes('question')) return { error: 'Missing required CSV column: question' };
  const get = (row, col) => { const i = headers.indexOf(col); return i >= 0 ? (row[i] ?? '') : ''; };
  const questions = [];
  for (let r = 1; r < lines.length; r++) {
    if (!lines[r].trim()) continue;
    const row = parseCSVLine(lines[r]);
    const question = get(row, 'question');
    if (!question) continue;
    if (question.length > MAX_QUESTION_LEN) return { error: `Row ${r}: question must be ${MAX_QUESTION_LEN} characters or fewer` };
    const type = get(row, 'type').toLowerCase().trim() === 'free_response' ? 'free_response' : 'multiple_choice';
    const explanation = get(row, 'explanation');
    if (explanation.length > MAX_EXPLANATION_LEN) return { error: `Row ${r}: explanation must be ${MAX_EXPLANATION_LEN} characters or fewer` };

    if (type === 'free_response') {
      questions.push({ question, type, answers: [], correct: null, explanation });
      continue;
    }

    const answers = ['answer_a', 'answer_b', 'answer_c', 'answer_d']
      .map(col => get(row, col)).filter(a => a !== '');
    if (answers.length < 2) return { error: `Row ${r}: need at least 2 non-empty answers` };
    if (answers.some(a => a.length > MAX_ANSWER_LEN)) return { error: `Row ${r}: each answer must be ${MAX_ANSWER_LEN} characters or fewer` };
    const correct = parseInt(get(row, 'correct'), 10);
    if (isNaN(correct) || correct < 0 || correct >= answers.length) {
      return { error: `Row ${r}: "correct" must be 0–${answers.length - 1}` };
    }
    questions.push({ question, type, answers, correct, explanation });
  }
  if (questions.length === 0) return { error: 'No valid questions found in CSV' };
  if (questions.length > 100) return { error: 'Maximum 100 questions per room' };
  return { questions };
}

export function validateJSONQuestions(raw) {
  if (!Array.isArray(raw)) return { error: 'JSON must be an array of question objects' };
  if (raw.length === 0) return { error: 'At least one question is required' };
  if (raw.length > 100) return { error: 'Maximum 100 questions per room' };
  const questions = [];
  for (let i = 0; i < raw.length; i++) {
    const q = raw[i];
    if (typeof q.question !== 'string' || !q.question.trim()) {
      return { error: `Question ${i + 1}: question text is required` };
    }
    if (q.question.trim().length > MAX_QUESTION_LEN) {
      return { error: `Question ${i + 1}: question must be ${MAX_QUESTION_LEN} characters or fewer` };
    }
    const type = q.type === 'free_response' ? 'free_response' : 'multiple_choice';
    const explanation = typeof q.explanation === 'string' ? q.explanation : '';
    if (explanation.length > MAX_EXPLANATION_LEN) {
      return { error: `Question ${i + 1}: explanation must be ${MAX_EXPLANATION_LEN} characters or fewer` };
    }

    if (type === 'free_response') {
      questions.push({ question: q.question.trim(), type, answers: [], correct: null, explanation });
      continue;
    }

    if (!Array.isArray(q.answers) || q.answers.length < 2 || q.answers.length > 4) {
      return { error: `Question ${i + 1}: must have 2–4 answers` };
    }
    const answers = q.answers.map(a => String(a).trim());
    if (answers.some(a => !a)) return { error: `Question ${i + 1}: answer text cannot be empty` };
    if (answers.some(a => a.length > MAX_ANSWER_LEN)) {
      return { error: `Question ${i + 1}: each answer must be ${MAX_ANSWER_LEN} characters or fewer` };
    }
    if (typeof q.correct !== 'number' || q.correct < 0 || q.correct >= answers.length) {
      return { error: `Question ${i + 1}: correct must be 0–${answers.length - 1}` };
    }
    questions.push({ question: q.question.trim(), type, answers, correct: q.correct, explanation });
  }
  return { questions };
}
