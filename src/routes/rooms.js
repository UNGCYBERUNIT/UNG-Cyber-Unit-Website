import { jsonResponse } from '../lib/http.js';
import { requireRole, ROLE_RANK } from '../lib/auth.js';
import { logAudit } from '../lib/audit.js';
import { checkRoomLookupLimit, recordRoomLookupFailure } from '../lib/ratelimit.js';
import {
  generateRoomCode,
  parseCSV,
  validateJSONQuestions,
  roomUnavailable,
  computeMissRates,
} from '../lib/util.js';

// Quiz Rooms API — instructor-created rooms, student join/attempt, grading,
// analytics, question-bank templating, and deletion. The largest single
// API domain in the app.
export async function handleRoomsRoutes(request, env, url, path, secureCookie) {
  if (!path.startsWith('/api/rooms')) return null;

  if (!env.JWT_SECRET || !env.DB) return jsonResponse({ error: 'Server not configured' }, 503);

  // POST /api/rooms — instructor creates a room
  if (path === '/api/rooms' && request.method === 'POST') {
    const session = await requireRole(request, env, 'instructor');
    if (session instanceof Response) return session;

    let formData;
    try { formData = await request.formData(); } catch { return jsonResponse({ error: 'Expected multipart/form-data' }, 400); }

    const title = (formData.get('title') ?? '').trim();
    if (!title) return jsonResponse({ error: 'Room title is required' }, 400);
    if (title.length > 200) return jsonResponse({ error: 'Room title must be 200 characters or fewer' }, 400);

    const visibility = (formData.get('visibility') ?? 'private').toString().toLowerCase();
    if (!['public', 'private', 'student'].includes(visibility)) {
      return jsonResponse({ error: 'visibility must be "public", "private", or "student"' }, 400);
    }

    const expiresRaw = formData.get('expires_at');
    let expiresAt = null;
    if (expiresRaw) {
      const d = new Date(expiresRaw);
      if (isNaN(d.getTime())) return jsonResponse({ error: 'Invalid expires_at date' }, 400);
      expiresAt = Math.floor(d.getTime() / 1000);
    }

    // Questions come from either an uploaded file or a saved question
    // bank template (template_id) — never both required. The template
    // path is ownership-checked the same way every other question-bank
    // read is (created_by === session.sub, or admin).
    const templateId = formData.get('template_id');
    let questions;
    if (templateId) {
      const bank = await env.DB.prepare('SELECT id, created_by FROM question_bank WHERE id = ?').bind(templateId).first();
      if (!bank) return jsonResponse({ error: 'Question bank not found' }, 404);
      if (bank.created_by !== session.sub && session.role !== 'admin') {
        return jsonResponse({ error: 'Forbidden' }, 403);
      }
      const { results: items } = await env.DB.prepare(
        'SELECT type, question, answers, correct, explanation FROM question_bank_items WHERE bank_id = ? ORDER BY sort_order'
      ).bind(bank.id).all();
      if (!items?.length) return jsonResponse({ error: 'Question bank has no questions' }, 400);
      questions = items.map(q => ({
        type: q.type, question: q.question, answers: JSON.parse(q.answers), correct: q.correct, explanation: q.explanation,
      }));
    } else {
      const file = formData.get('file');
      if (!file || typeof file.text !== 'function') return jsonResponse({ error: 'No file uploaded' }, 400);
      if (file.size > 1_000_000) return jsonResponse({ error: 'Question file must be under 1MB' }, 400);

      const text = await file.text();
      const filename = (file.name ?? '').toLowerCase();
      let parseResult;
      if (filename.endsWith('.json')) {
        try { parseResult = validateJSONQuestions(JSON.parse(text)); }
        catch { return jsonResponse({ error: 'Invalid JSON file' }, 400); }
      } else {
        parseResult = parseCSV(text);
      }
      if (!parseResult) return jsonResponse({ error: 'Could not parse file' }, 400);
      if (parseResult.error) return jsonResponse({ error: parseResult.error }, 400);
      questions = parseResult.questions;
    }

    // Generate a unique room code (collision retry)
    let code;
    for (let attempt = 0; attempt < 10; attempt++) {
      const candidate = generateRoomCode();
      const existing = await env.DB.prepare('SELECT id FROM quiz_rooms WHERE code = ?').bind(candidate).first();
      if (!existing) { code = candidate; break; }
    }
    if (!code) return jsonResponse({ error: 'Failed to generate unique room code, try again' }, 500);

    const roomResult = await env.DB.prepare(
      'INSERT INTO quiz_rooms (code, title, created_by, expires_at, status, visibility, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
    ).bind(code, title, session.sub, expiresAt, 'open', visibility, Date.now()).run();

    const roomId = roomResult.meta.last_row_id;
    await env.DB.batch(questions.map((q, i) =>
      env.DB.prepare(
        'INSERT INTO quiz_room_questions (room_id, sort_order, type, question, answers, correct, explanation) VALUES (?, ?, ?, ?, ?, ?, ?)'
      ).bind(roomId, i, q.type ?? 'multiple_choice', q.question, JSON.stringify(q.answers), q.correct ?? null, q.explanation)
    ));

    return jsonResponse({ code, title, questionCount: questions.length }, 201);
  }

  // GET /api/rooms — instructor lists their rooms
  if (path === '/api/rooms' && request.method === 'GET') {
    const session = await requireRole(request, env, 'instructor');
    if (session instanceof Response) return session;

    // Admins can pass ?all=1 to see all rooms
    const showAll = session.role === 'admin' && url.searchParams.get('all') === '1';
    const query = showAll
      ? `SELECT r.id, r.code, r.title, r.status, r.visibility, r.expires_at, r.created_at,
                COUNT(DISTINCT q.id) AS question_count,
                COUNT(DISTINCT a.id) AS attempt_count
         FROM quiz_rooms r
         LEFT JOIN quiz_room_questions q ON q.room_id = r.id
         LEFT JOIN quiz_room_attempts a ON a.room_id = r.id
         GROUP BY r.id ORDER BY r.created_at DESC`
      : `SELECT r.id, r.code, r.title, r.status, r.visibility, r.expires_at, r.created_at,
                COUNT(DISTINCT q.id) AS question_count,
                COUNT(DISTINCT a.id) AS attempt_count
         FROM quiz_rooms r
         LEFT JOIN quiz_room_questions q ON q.room_id = r.id
         LEFT JOIN quiz_room_attempts a ON a.room_id = r.id
         WHERE r.created_by = ?
         GROUP BY r.id ORDER BY r.created_at DESC`;

    const stmt = showAll
      ? env.DB.prepare(query)
      : env.DB.prepare(query).bind(session.sub);
    const { results } = await stmt.all();
    return jsonResponse({ results: results ?? [] });
  }

  // GET /api/rooms/public — any logged-in member browses open public rooms
  if (path === '/api/rooms/public' && request.method === 'GET') {
    const session = await requireRole(request, env, 'member');
    if (session instanceof Response) return session;

    const nowSecs = Math.floor(Date.now() / 1000);
    // Student-only rooms are only listed to verified students+ — plain
    // members never see them here (they'd also be rejected on join/attempt).
    const visibilities = (ROLE_RANK[session.role] ?? 0) >= ROLE_RANK.student
      ? ['public', 'student']
      : ['public'];
    const { results } = await env.DB.prepare(`
      SELECT r.code, r.title, r.created_at, r.visibility, u.username AS instructor_name,
             COUNT(DISTINCT q.id) AS question_count,
             att.id IS NOT NULL AS attempted
      FROM quiz_rooms r
      JOIN users u ON u.id = r.created_by
      LEFT JOIN quiz_room_questions q ON q.room_id = r.id
      LEFT JOIN quiz_room_attempts att ON att.room_id = r.id AND att.user_id = ?
      WHERE r.visibility IN (${visibilities.map(() => '?').join(',')}) AND r.status = 'open'
        AND (r.expires_at IS NULL OR r.expires_at > ?)
      GROUP BY r.id ORDER BY r.created_at DESC
    `).bind(session.sub, ...visibilities, nowSecs).all();
    return jsonResponse({ results: results ?? [] });
  }

  // DELETE /api/rooms/:code/attempts/:attemptId — instructor resets a student's attempt
  const attemptMatch = path.match(/^\/api\/rooms\/([A-Z0-9]{4}-[A-Z0-9]{4})\/attempts\/(\d+)$/);
  if (attemptMatch && request.method === 'DELETE') {
    const session = await requireRole(request, env, 'instructor');
    if (session instanceof Response) return session;

    const [, attemptCode, attemptIdRaw] = attemptMatch;
    const attemptId = Number(attemptIdRaw);

    const room = await env.DB.prepare('SELECT id, created_by FROM quiz_rooms WHERE code = ?').bind(attemptCode).first();
    if (!room) return jsonResponse({ error: 'Room not found' }, 404);
    if (room.created_by !== session.sub && session.role !== 'admin') {
      return jsonResponse({ error: 'Forbidden' }, 403);
    }

    const attempt = await env.DB.prepare(
      'SELECT id FROM quiz_room_attempts WHERE id = ? AND room_id = ?'
    ).bind(attemptId, room.id).first();
    if (!attempt) return jsonResponse({ error: 'Attempt not found' }, 404);

    await env.DB.batch([
      env.DB.prepare('DELETE FROM quiz_room_answers WHERE attempt_id = ?').bind(attemptId),
      env.DB.prepare('DELETE FROM quiz_room_attempts WHERE id = ?').bind(attemptId),
    ]);

    return jsonResponse({ ok: true });
  }

  // PATCH /api/rooms/:code/answers/:answerId — instructor grades a free-response answer
  const gradeAnswerMatch = path.match(/^\/api\/rooms\/([A-Z0-9]{4}-[A-Z0-9]{4})\/answers\/(\d+)$/);
  if (gradeAnswerMatch && request.method === 'PATCH') {
    const session = await requireRole(request, env, 'instructor');
    if (session instanceof Response) return session;

    const [, gradeCode, answerIdRaw] = gradeAnswerMatch;
    const answerId = Number(answerIdRaw);

    let body;
    try { body = await request.json(); } catch { return jsonResponse({ error: 'Invalid request body' }, 400); }
    const { is_correct } = body ?? {};
    if (is_correct !== 0 && is_correct !== 1) {
      return jsonResponse({ error: 'is_correct must be 0 or 1' }, 400);
    }

    const answer = await env.DB.prepare(`
      SELECT ans.id, ans.attempt_id, r.code, r.created_by
      FROM quiz_room_answers ans
      JOIN quiz_room_attempts att ON att.id = ans.attempt_id
      JOIN quiz_rooms r ON r.id = att.room_id
      WHERE ans.id = ?
    `).bind(answerId).first();
    if (!answer || answer.code !== gradeCode) return jsonResponse({ error: 'Answer not found' }, 404);
    if (answer.created_by !== session.sub && session.role !== 'admin') {
      return jsonResponse({ error: 'Forbidden' }, 403);
    }

    await env.DB.prepare('UPDATE quiz_room_answers SET is_correct = ? WHERE id = ?')
      .bind(is_correct, answerId).run();

    const scoreRow = await env.DB.prepare(
      'SELECT COUNT(*) AS n FROM quiz_room_answers WHERE attempt_id = ? AND is_correct = 1'
    ).bind(answer.attempt_id).first();
    const pendingRow = await env.DB.prepare(
      'SELECT COUNT(*) AS n FROM quiz_room_answers WHERE attempt_id = ? AND is_correct IS NULL'
    ).bind(answer.attempt_id).first();

    await env.DB.prepare('UPDATE quiz_room_attempts SET score = ? WHERE id = ?')
      .bind(scoreRow.n, answer.attempt_id).run();

    return jsonResponse({ ok: true, score: scoreRow.n, pendingCount: pendingRow.n });
  }

  // Routes with a room code: /api/rooms/:code[/subpath]
  const roomCodeMatch = path.match(/^\/api\/rooms\/([A-Z0-9]{4}-[A-Z0-9]{4})(\/[a-z-]*)?$/);
  if (roomCodeMatch) {
    const code = roomCodeMatch[1];
    const subpath = roomCodeMatch[2] ?? '';

    // GET /api/rooms/:code/join — student joins a room
    if (subpath === '/join' && request.method === 'GET') {
      const session = await requireRole(request, env, 'member');
      if (session instanceof Response) return session;
      const limited = await checkRoomLookupLimit(env, request);
      if (limited) return limited;

      const room = await env.DB.prepare(
        'SELECT id, code, title, status, expires_at, visibility FROM quiz_rooms WHERE code = ?'
      ).bind(code).first();

      // Users who already attempted legitimately know the room exists, so
      // let them view their result even if it later closed or expired.
      const attempt = room ? await env.DB.prepare(
        'SELECT id, score, total, completed_at FROM quiz_room_attempts WHERE room_id = ? AND user_id = ?'
      ).bind(room.id, session.sub).first() : null;

      // Student-only rooms aren't code-secrets (they're listed to anyone
      // qualified), so a clear 403 is appropriate here, unlike the uniform
      // roomUnavailable() below which exists to stop code-guessing.
      if (room && !attempt && room.visibility === 'student' && (ROLE_RANK[session.role] ?? 0) < ROLE_RANK.student) {
        return jsonResponse({ error: 'This room is for verified students only.' }, 403);
      }

      if (!attempt && (!room || room.status === 'closed' || (room.expires_at && Date.now() / 1000 > room.expires_at))) {
        // Unknown, closed, and expired codes are indistinguishable, and each
        // failed lookup counts toward the brute-force limit.
        await recordRoomLookupFailure(env, request);
        return roomUnavailable();
      }

      if (attempt) {
        const { results: ansRows } = await env.DB.prepare(`
          SELECT a.question_id, a.selected, a.response_text, a.is_correct,
                 q.type, q.question, q.answers, q.correct, q.explanation, q.sort_order
          FROM quiz_room_answers a
          JOIN quiz_room_questions q ON q.id = a.question_id
          WHERE a.attempt_id = ?
          ORDER BY q.sort_order
        `).bind(attempt.id).all();
        const pendingCount = (ansRows ?? []).filter(a => a.is_correct === null).length;
        return jsonResponse({
          room: { code: room.code, title: room.title },
          alreadyAttempted: true,
          attempt: {
            score: attempt.score, total: attempt.total, completed_at: attempt.completed_at,
            pendingCount,
            answers: (ansRows ?? []).map(a => ({
              question_id: a.question_id, type: a.type, question: a.question,
              answers: JSON.parse(a.answers), correct: a.correct,
              selected: a.selected, response_text: a.response_text,
              is_correct: a.is_correct, explanation: a.explanation,
            })),
          },
        });
      }

      // Return questions without correct answers
      const { results: questions } = await env.DB.prepare(
        'SELECT id, sort_order, type, question, answers FROM quiz_room_questions WHERE room_id = ? ORDER BY sort_order'
      ).bind(room.id).all();
      return jsonResponse({
        room: { code: room.code, title: room.title },
        alreadyAttempted: false,
        questions: (questions ?? []).map(q => ({
          id: q.id, sort_order: q.sort_order, type: q.type,
          question: q.question, answers: JSON.parse(q.answers),
        })),
      });
    }

    // GET /api/rooms/:code/my-attempt — student checks their result
    if (subpath === '/my-attempt' && request.method === 'GET') {
      const session = await requireRole(request, env, 'member');
      if (session instanceof Response) return session;
      const limited = await checkRoomLookupLimit(env, request);
      if (limited) return limited;

      const room = await env.DB.prepare('SELECT id FROM quiz_rooms WHERE code = ?').bind(code).first();
      // An unknown code returns the same shape as a known room you haven't
      // attempted, so it can't be used to detect which rooms exist.
      if (!room) {
        await recordRoomLookupFailure(env, request);
        return jsonResponse({ attempt: null });
      }

      const attempt = await env.DB.prepare(
        'SELECT id, score, total, completed_at FROM quiz_room_attempts WHERE room_id = ? AND user_id = ?'
      ).bind(room.id, session.sub).first();
      if (!attempt) return jsonResponse({ attempt: null });

      const { results: ansRows } = await env.DB.prepare(`
        SELECT a.question_id, a.selected, a.response_text, a.is_correct,
               q.type, q.question, q.answers, q.correct, q.explanation, q.sort_order
        FROM quiz_room_answers a
        JOIN quiz_room_questions q ON q.id = a.question_id
        WHERE a.attempt_id = ?
        ORDER BY q.sort_order
      `).bind(attempt.id).all();
      const pendingCount = (ansRows ?? []).filter(a => a.is_correct === null).length;
      return jsonResponse({
        attempt: {
          score: attempt.score, total: attempt.total, completed_at: attempt.completed_at,
          pendingCount,
          answers: (ansRows ?? []).map(a => ({
            question_id: a.question_id, type: a.type, question: a.question,
            answers: JSON.parse(a.answers), correct: a.correct,
            selected: a.selected, response_text: a.response_text,
            is_correct: a.is_correct, explanation: a.explanation,
          })),
        },
      });
    }

    // POST /api/rooms/:code/attempt — student submits their answers
    if (subpath === '/attempt' && request.method === 'POST') {
      const session = await requireRole(request, env, 'member');
      if (session instanceof Response) return session;
      const limited = await checkRoomLookupLimit(env, request);
      if (limited) return limited;

      const room = await env.DB.prepare(
        'SELECT id, code, title, status, expires_at, visibility FROM quiz_rooms WHERE code = ?'
      ).bind(code).first();
      const existing = room ? await env.DB.prepare(
        'SELECT id FROM quiz_room_attempts WHERE room_id = ? AND user_id = ?'
      ).bind(room.id, session.sub).first() : null;
      if (existing) return jsonResponse({ error: 'You have already submitted this quiz' }, 409);

      if (room && room.visibility === 'student' && (ROLE_RANK[session.role] ?? 0) < ROLE_RANK.student) {
        return jsonResponse({ error: 'This room is for verified students only.' }, 403);
      }

      // Unknown, closed, and expired codes look identical and count toward
      // the brute-force limit (a prior attempt is handled above).
      if (!room || room.status === 'closed' || (room.expires_at && Date.now() / 1000 > room.expires_at)) {
        await recordRoomLookupFailure(env, request);
        return roomUnavailable();
      }

      let body;
      try { body = await request.json(); } catch { return jsonResponse({ error: 'Invalid request body' }, 400); }
      const { answers } = body ?? {};
      if (!Array.isArray(answers)) return jsonResponse({ error: 'answers must be an array' }, 400);

      const { results: questions } = await env.DB.prepare(
        'SELECT id, type, correct FROM quiz_room_questions WHERE room_id = ? ORDER BY sort_order'
      ).bind(room.id).all();

      if (answers.length !== questions.length) {
        return jsonResponse({ error: `Expected ${questions.length} answers, got ${answers.length}` }, 400);
      }
      for (let i = 0; i < answers.length; i++) {
        const q = questions[i];
        if (q.type === 'free_response') {
          if (typeof answers[i] !== 'string') return jsonResponse({ error: `Answer at index ${i} must be text` }, 400);
        } else if (typeof answers[i] !== 'number' || answers[i] < 0) {
          return jsonResponse({ error: `Answer at index ${i} is invalid` }, 400);
        }
      }

      const scored = questions.map((q, i) => {
        if (q.type === 'free_response') {
          return {
            question_id: q.id, selected: null,
            response_text: answers[i].trim().slice(0, 5000), is_correct: null,
          };
        }
        return {
          question_id: q.id, selected: answers[i], response_text: null,
          is_correct: answers[i] === q.correct ? 1 : 0,
        };
      });
      const score = scored.reduce((sum, s) => sum + (s.is_correct === 1 ? 1 : 0), 0);
      const completedAt = Date.now();

      const attemptResult = await env.DB.prepare(
        'INSERT INTO quiz_room_attempts (room_id, user_id, score, total, completed_at) VALUES (?, ?, ?, ?, ?)'
      ).bind(room.id, session.sub, score, questions.length, completedAt).run();

      await env.DB.batch(scored.map(s =>
        env.DB.prepare(
          'INSERT INTO quiz_room_answers (attempt_id, question_id, selected, response_text, is_correct) VALUES (?, ?, ?, ?, ?)'
        ).bind(attemptResult.meta.last_row_id, s.question_id, s.selected, s.response_text, s.is_correct)
      ));

      // Return full results (correct answers now revealed)
      const { results: fullQs } = await env.DB.prepare(
        'SELECT id, sort_order, type, question, answers, correct, explanation FROM quiz_room_questions WHERE room_id = ? ORDER BY sort_order'
      ).bind(room.id).all();

      const pendingCount = scored.filter(s => s.is_correct === null).length;
      return jsonResponse({
        score, total: questions.length, completed_at: completedAt, pendingCount,
        answers: fullQs.map((q, i) => ({
          question_id: q.id, type: q.type, question: q.question,
          answers: JSON.parse(q.answers), correct: q.correct,
          selected: scored[i].selected, response_text: scored[i].response_text,
          is_correct: scored[i].is_correct, explanation: q.explanation,
        })),
      }, 201);
    }

    // GET /api/rooms/:code/results — instructor views attempt roster
    if (subpath === '/results' && request.method === 'GET') {
      const session = await requireRole(request, env, 'instructor');
      if (session instanceof Response) return session;

      const room = await env.DB.prepare(
        'SELECT id, code, title, status, created_by FROM quiz_rooms WHERE code = ?'
      ).bind(code).first();
      if (!room) return jsonResponse({ error: 'Room not found' }, 404);
      if (room.created_by !== session.sub && session.role !== 'admin') {
        return jsonResponse({ error: 'Forbidden' }, 403);
      }

      const { results: attempts } = await env.DB.prepare(`
        SELECT a.id, a.score, a.total, a.completed_at, u.username
        FROM quiz_room_attempts a
        JOIN users u ON u.id = a.user_id
        WHERE a.room_id = ?
        ORDER BY a.completed_at DESC
      `).bind(room.id).all();

      const { results: questions } = await env.DB.prepare(
        'SELECT id, sort_order, type, question, answers, correct, explanation FROM quiz_room_questions WHERE room_id = ? ORDER BY sort_order'
      ).bind(room.id).all();

      const detailedAttempts = await Promise.all((attempts ?? []).map(async att => {
        const { results: ansRows } = await env.DB.prepare(
          'SELECT id, question_id, selected, response_text, is_correct FROM quiz_room_answers WHERE attempt_id = ?'
        ).bind(att.id).all();
        const pendingCount = (ansRows ?? []).filter(a => a.is_correct === null).length;
        return { ...att, pendingCount, answers: ansRows ?? [] };
      }));

      return jsonResponse({
        room: { code: room.code, title: room.title, status: room.status },
        questions: (questions ?? []).map(q => ({
          id: q.id, sort_order: q.sort_order, type: q.type, question: q.question,
          answers: JSON.parse(q.answers), correct: q.correct, explanation: q.explanation,
        })),
        attempts: detailedAttempts,
      });
    }

    // GET /api/rooms/:code/analytics — instructor views per-question miss-rate
    if (subpath === '/analytics' && request.method === 'GET') {
      const session = await requireRole(request, env, 'instructor');
      if (session instanceof Response) return session;

      const room = await env.DB.prepare(
        'SELECT id, code, title, created_by FROM quiz_rooms WHERE code = ?'
      ).bind(code).first();
      if (!room) return jsonResponse({ error: 'Room not found' }, 404);
      if (room.created_by !== session.sub && session.role !== 'admin') {
        return jsonResponse({ error: 'Forbidden' }, 403);
      }

      const { results: questions } = await env.DB.prepare(
        'SELECT id, sort_order, type, question FROM quiz_room_questions WHERE room_id = ? ORDER BY sort_order'
      ).bind(room.id).all();

      const { results: answers } = await env.DB.prepare(`
        SELECT a.question_id, a.is_correct
        FROM quiz_room_answers a
        JOIN quiz_room_attempts att ON att.id = a.attempt_id
        WHERE att.room_id = ?
      `).bind(room.id).all();

      return jsonResponse({
        room: { code: room.code, title: room.title },
        questions: computeMissRates(questions ?? [], answers ?? []),
      });
    }

    // POST /api/rooms/:code/save-as-template — snapshot this room's
    // current questions into a new question bank. A copy, not a live
    // reference (question_bank_items has no FK back to
    // quiz_room_questions) — the template must survive this room being
    // deleted later, which is often exactly why it's being saved.
    if (subpath === '/save-as-template' && request.method === 'POST') {
      const session = await requireRole(request, env, 'instructor');
      if (session instanceof Response) return session;

      const room = await env.DB.prepare('SELECT id, title, created_by FROM quiz_rooms WHERE code = ?').bind(code).first();
      if (!room) return jsonResponse({ error: 'Room not found' }, 404);
      if (room.created_by !== session.sub && session.role !== 'admin') {
        return jsonResponse({ error: 'Forbidden' }, 403);
      }

      let body = {};
      try { body = await request.json(); } catch { /* optional body — title defaults below */ }
      const title = (body?.title ?? '').toString().trim() || room.title;
      if (title.length > 200) return jsonResponse({ error: 'Title must be 200 characters or fewer' }, 400);

      const { results: questions } = await env.DB.prepare(
        'SELECT sort_order, type, question, answers, correct, explanation FROM quiz_room_questions WHERE room_id = ? ORDER BY sort_order'
      ).bind(room.id).all();
      if (!questions?.length) return jsonResponse({ error: 'Room has no questions to save' }, 400);

      const now = Date.now();
      const bankResult = await env.DB.prepare(
        'INSERT INTO question_bank (title, created_by, created_at) VALUES (?, ?, ?)'
      ).bind(title, session.sub, now).run();
      const bankId = bankResult.meta.last_row_id;

      await env.DB.batch(questions.map(q =>
        env.DB.prepare(
          'INSERT INTO question_bank_items (bank_id, sort_order, type, question, answers, correct, explanation) VALUES (?, ?, ?, ?, ?, ?, ?)'
        ).bind(bankId, q.sort_order, q.type, q.question, q.answers, q.correct, q.explanation)
      ));

      return jsonResponse({ id: bankId, title, questionCount: questions.length }, 201);
    }

    // GET /api/rooms/:code — instructor views room detail
    if (subpath === '' && request.method === 'GET') {
      const session = await requireRole(request, env, 'instructor');
      if (session instanceof Response) return session;

      const room = await env.DB.prepare(
        'SELECT id, code, title, status, expires_at, created_at, created_by FROM quiz_rooms WHERE code = ?'
      ).bind(code).first();
      if (!room) return jsonResponse({ error: 'Room not found' }, 404);
      if (room.created_by !== session.sub && session.role !== 'admin') {
        return jsonResponse({ error: 'Forbidden' }, 403);
      }

      const { results: questions } = await env.DB.prepare(
        'SELECT id, sort_order, question, answers, correct, explanation FROM quiz_room_questions WHERE room_id = ? ORDER BY sort_order'
      ).bind(room.id).all();

      return jsonResponse({
        room: {
          id: room.id, code: room.code, title: room.title,
          status: room.status, expires_at: room.expires_at, created_at: room.created_at,
        },
        questions: (questions ?? []).map(q => ({
          id: q.id, sort_order: q.sort_order, question: q.question,
          answers: JSON.parse(q.answers), correct: q.correct, explanation: q.explanation,
        })),
      });
    }

    // PATCH /api/rooms/:code — instructor updates status or expiry
    if (subpath === '' && request.method === 'PATCH') {
      const session = await requireRole(request, env, 'instructor');
      if (session instanceof Response) return session;

      const room = await env.DB.prepare('SELECT id, created_by FROM quiz_rooms WHERE code = ?').bind(code).first();
      if (!room) return jsonResponse({ error: 'Room not found' }, 404);
      if (room.created_by !== session.sub && session.role !== 'admin') {
        return jsonResponse({ error: 'Forbidden' }, 403);
      }

      let body;
      try { body = await request.json(); } catch { return jsonResponse({ error: 'Invalid request body' }, 400); }
      const { status, expires_at } = body ?? {};

      const updates = []; const params = [];
      if (status !== undefined) {
        if (!['open', 'closed'].includes(status)) return jsonResponse({ error: 'status must be "open" or "closed"' }, 400);
        updates.push('status = ?'); params.push(status);
      }
      if (expires_at !== undefined) {
        if (expires_at === null) {
          updates.push('expires_at = NULL');
        } else {
          const d = new Date(expires_at);
          if (isNaN(d.getTime())) return jsonResponse({ error: 'Invalid expires_at date' }, 400);
          updates.push('expires_at = ?'); params.push(Math.floor(d.getTime() / 1000));
        }
      }
      if (updates.length === 0) return jsonResponse({ error: 'Nothing to update' }, 400);
      params.push(room.id);
      await env.DB.prepare(`UPDATE quiz_rooms SET ${updates.join(', ')} WHERE id = ?`).bind(...params).run();
      return jsonResponse({ ok: true });
    }

    // DELETE /api/rooms/:code — instructor deletes room + all data
    if (subpath === '' && request.method === 'DELETE') {
      const session = await requireRole(request, env, 'instructor');
      if (session instanceof Response) return session;

      const room = await env.DB.prepare('SELECT id, title, created_by FROM quiz_rooms WHERE code = ?').bind(code).first();
      if (!room) return jsonResponse({ error: 'Room not found' }, 404);
      if (room.created_by !== session.sub && session.role !== 'admin') {
        return jsonResponse({ error: 'Forbidden' }, 403);
      }

      // Cascade: answers → attempts → questions → room
      const { results: attemptRows } = await env.DB.prepare(
        'SELECT id FROM quiz_room_attempts WHERE room_id = ?'
      ).bind(room.id).all();

      const stmts = (attemptRows ?? []).map(a =>
        env.DB.prepare('DELETE FROM quiz_room_answers WHERE attempt_id = ?').bind(a.id)
      );
      stmts.push(env.DB.prepare('DELETE FROM quiz_room_attempts WHERE room_id = ?').bind(room.id));
      stmts.push(env.DB.prepare('DELETE FROM quiz_room_questions WHERE room_id = ?').bind(room.id));
      stmts.push(env.DB.prepare('DELETE FROM quiz_rooms WHERE id = ?').bind(room.id));
      stmts.push(logAudit(env, {
        actorId: session.sub, actorName: session.username, action: 'room.delete', target: `${room.title} (${code})`,
      }));
      await env.DB.batch(stmts);
      return jsonResponse({ ok: true });
    }
  }

  return jsonResponse({ error: 'Not found' }, 404);
}
