import { jsonResponse, addSecurityHeaders, notFoundResponse } from '../lib/http.js';
import { requireRole, getSession } from '../lib/auth.js';
import { checkChallengeSubmitLimit, recordChallengeSubmitFailure } from '../lib/ratelimit.js';
import { normalizeAnswer, MAX_ANSWER_SUBMIT_LEN } from '../lib/util.js';
import { CHALLENGE_PARTS, CHALLENGE_PART_POINTS, ctfModules } from '../data/challenges.js';
import { topics, topicsWithCheatSheet } from '../data/topics.js';

// Looks up a part's full definition object (never trusting the client for
// its gradingMode) given a challenge id + part id. Legacy parts that are
// plain id strings have no extra metadata, so this returns null for them —
// callers treat that the same as an auto-graded part.
function findPartDef(challengeId, partId) {
  const m = ctfModules.find(x => x.id === challengeId);
  const p = m?.parts?.find(p => (typeof p === 'string' ? p : p.id) === partId);
  return typeof p === 'object' ? p : null;
}

// Which named section (OSINT-style composite module) or part title (every
// other module — one "section" per part there) a part belongs to, for the
// submission log's "which section" column. Falls back to the raw part id if
// somehow neither is found, rather than leaving the column blank.
function findPartLabel(challengeId, partId) {
  const m = ctfModules.find(x => x.id === challengeId);
  if (!m) return partId;
  if (m.sections) {
    const section = m.sections.find(s => s.parts.some(p => p.id === partId));
    if (section) return section.title;
  }
  const part = findPartDef(challengeId, partId);
  return part?.title ?? partId;
}

// CTF challenge support API: instructor-only answer-key download,
// per-session completion progress, auto-graded answer submission, and the
// per-topic cheat-sheet PDF download.
export async function handleChallengesRoutes(request, env, url, path, secureCookie) {
  // GET /api/challenges/:id/answer-key — served from a D1 blob, never from
  // public/ — the source repo is public on GitHub, so a static asset (even
  // one no page links to) would leak the answers to anyone browsing the
  // repo. See schema.sql's challenge_answer_keys table.
  const answerKeyMatch = path.match(/^\/api\/challenges\/([a-z0-9-]+)\/answer-key$/);
  if (answerKeyMatch) {
    const session = await requireRole(request, env, 'instructor');
    if (session instanceof Response) return session;
    if (!env.DB) return jsonResponse({ error: 'Server not configured' }, 503);

    const row = await env.DB.prepare(
      'SELECT filename, content_type, data FROM challenge_answer_keys WHERE challenge_id = ?'
    ).bind(answerKeyMatch[1]).first();
    if (!row) return jsonResponse({ error: 'No answer key for this challenge' }, 404);

    const headers = addSecurityHeaders(new Headers({
      'Content-Type': row.content_type,
      'Content-Disposition': `attachment; filename="${row.filename}"`,
      'Cache-Control': 'no-store',
    }));
    // D1 hands back a BLOB column as a plain byte array, not an
    // ArrayBuffer/Uint8Array — passing it straight to Response() silently
    // stringifies it (e.g. "37,80,68,70,...") instead of sending real bytes.
    return new Response(new Uint8Array(row.data), { headers });
  }

  // GET /api/challenges/:id/progress — which parts this session has
  // completed and the resulting points score — computed here rather than in
  // the client so every consumer (the module page, the /challenges hub's
  // per-card badge) gets the same number from one place. Any session incl.
  // guest (matches /api/progress's pattern for topic quizzes) — returns
  // empty/zero rather than an error when signed out, so the page can render
  // normally either way.
  const progressChallengeMatch = path.match(/^\/api\/challenges\/([a-z0-9-]+)\/progress$/);
  if (progressChallengeMatch && request.method === 'GET') {
    const challengeId = progressChallengeMatch[1];
    const maxPoints = Object.values(CHALLENGE_PART_POINTS[challengeId] ?? {}).reduce((a, b) => a + b, 0);
    const empty = { completed: [], score: 0, maxPoints };
    if (!env.DB) return jsonResponse(empty);
    const session = await getSession(request, env);
    if (!session) return jsonResponse(empty);
    const { results: completedRows } = await env.DB.prepare(
      'SELECT part_id FROM challenge_completions WHERE user_id = ? AND challenge_id = ?'
    ).bind(session.sub, challengeId).all();

    const completed = (completedRows ?? []).map(r => r.part_id);
    const score = completed.reduce((sum, partId) => sum + (CHALLENGE_PART_POINTS[challengeId]?.[partId] ?? 0), 0);

    return jsonResponse({ completed, score, maxPoints });
  }

  // POST /api/challenges/:id/submit — auto-graded. Correct answers live
  // only in D1 (challenge_answers) — never in worker.js, since even a
  // normalized/hashed short answer would be offline-crackable once it's
  // sitting in the public GitHub repo.
  const submitChallengeMatch = path.match(/^\/api\/challenges\/([a-z0-9-]+)\/submit$/);
  if (submitChallengeMatch && request.method === 'POST') {
    if (!env.DB) return jsonResponse({ error: 'Server not configured' }, 503);
    const session = await getSession(request, env);
    if (!session) return jsonResponse({ error: 'Not authenticated' }, 401);

    const challengeId = submitChallengeMatch[1];
    const validParts = CHALLENGE_PARTS[challengeId];
    if (!validParts) return jsonResponse({ error: 'Unknown challenge' }, 404);

    let body;
    try { body = await request.json(); } catch { return jsonResponse({ error: 'Invalid request body' }, 400); }
    const { partId, answer } = body ?? {};
    if (!validParts.includes(partId)) return jsonResponse({ error: 'Unknown challenge part' }, 400);
    if (typeof answer !== 'string' || !answer.trim() || answer.length > MAX_ANSWER_SUBMIT_LEN) {
      return jsonResponse({ error: 'Invalid answer' }, 400);
    }

    const limited = await checkChallengeSubmitLimit(env, session.sub);
    if (limited) return limited;

    const now = Date.now();
    // Every attempt (correct, incorrect, or instructor-graded) gets logged
    // here for the instructor-only submission log — independent of what
    // else the attempt does below, never blocking the actual response.
    const logAttempt = (isCorrect) => env.DB.prepare(`
      INSERT INTO challenge_submission_log (user_id, username, challenge_id, part_id, answer_text, is_correct, submitted_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).bind(session.sub, session.username, challengeId, partId, answer.trim(), isCorrect, now).run();

    // Instructor-graded parts (OSINT lab's free-text/live-data questions) have
    // no correct/incorrect answer to check — just save the latest text. Not a
    // "wrong answer," so never counted against the rate limit above.
    const partDef = findPartDef(challengeId, partId);
    if (partDef?.gradingMode === 'manual') {
      await env.DB.prepare(`
        INSERT INTO challenge_pending_answers (user_id, challenge_id, part_id, answer_text, submitted_at)
        VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(user_id, challenge_id, part_id) DO UPDATE SET answer_text = excluded.answer_text, submitted_at = excluded.submitted_at
      `).bind(session.sub, challengeId, partId, answer.trim(), now).run();
      await logAttempt(null);
      return jsonResponse({ pending: true });
    }

    const match = await env.DB.prepare(
      'SELECT 1 FROM challenge_answers WHERE challenge_id = ? AND part_id = ? AND answer_norm = ?'
    ).bind(challengeId, partId, normalizeAnswer(answer)).first();

    if (!match) {
      await recordChallengeSubmitFailure(env, session.sub);
      await logAttempt(0);
      return jsonResponse({ correct: false });
    }

    await env.DB.prepare(`
      INSERT INTO challenge_completions (user_id, challenge_id, part_id, completed_at)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(user_id, challenge_id, part_id) DO NOTHING
    `).bind(session.sub, challengeId, partId, now).run();
    await logAttempt(1);

    return jsonResponse({ correct: true });
  }

  // GET /api/challenges/:id/submissions — instructor-only, every logged
  // submission attempt for this challenge (correct, incorrect, or
  // instructor-graded), newest first, with the accepted answer(s) attached
  // per part so an instructor can see right/wrong at a glance without a
  // separate answer-key lookup. Client sorts/filters this client-side (same
  // "fetch once, sort locally" shape as the admin users table) rather than
  // server-side cursor pagination — per-challenge submission volume here is
  // nowhere near audit_log's scale.
  const submissionsMatch = path.match(/^\/api\/challenges\/([a-z0-9-]+)\/submissions$/);
  if (submissionsMatch && request.method === 'GET') {
    const session = await requireRole(request, env, 'instructor');
    if (session instanceof Response) return session;
    if (!env.DB) return jsonResponse({ error: 'Server not configured' }, 503);

    const challengeId = submissionsMatch[1];
    if (!CHALLENGE_PARTS[challengeId]) return notFoundResponse();

    const { results: logRows } = await env.DB.prepare(
      'SELECT id, username, part_id, answer_text, is_correct, submitted_at FROM challenge_submission_log WHERE challenge_id = ? ORDER BY submitted_at DESC LIMIT 1000'
    ).bind(challengeId).all();

    const { results: answerRows } = await env.DB.prepare(
      'SELECT part_id, answer_norm FROM challenge_answers WHERE challenge_id = ?'
    ).bind(challengeId).all();
    const acceptedByPart = new Map();
    for (const r of answerRows ?? []) {
      if (!acceptedByPart.has(r.part_id)) acceptedByPart.set(r.part_id, []);
      acceptedByPart.get(r.part_id).push(r.answer_norm);
    }

    const results = (logRows ?? []).map(r => ({
      id: r.id,
      username: r.username,
      partId: r.part_id,
      section: findPartLabel(challengeId, r.part_id),
      answer: r.answer_text,
      isCorrect: r.is_correct,
      submittedAt: r.submitted_at,
      acceptedAnswers: acceptedByPart.get(r.part_id) ?? [],
    }));

    return jsonResponse({ results });
  }

  // GET /cheatsheet/:id — same "friendly route → static asset" idea as
  // /sop, but per-topic and dynamic. Unlike the HTML view routes, this
  // response has no worker-injected per-request content, so it keeps
  // normal asset caching (no ETag/Cache-Control stripping).
  const cheatSheetMatch = path.match(/^\/cheatsheet\/(\w+)$/);
  if (cheatSheetMatch) {
    const id = cheatSheetMatch[1];
    if (!topics.some(t => t.id === id) || !topicsWithCheatSheet.has(id)) {
      return notFoundResponse();
    }
    const assetUrl = new URL(`/cheatsheets/${id}.pdf`, url.origin);
    const assetResponse = await env.ASSETS.fetch(assetUrl.toString());
    if (!assetResponse.ok) return notFoundResponse();
    const headers = addSecurityHeaders(new Headers(assetResponse.headers));
    return new Response(assetResponse.body, { status: assetResponse.status, headers });
  }

  return null;
}
