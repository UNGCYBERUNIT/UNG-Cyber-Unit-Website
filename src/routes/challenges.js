import { jsonResponse, addSecurityHeaders, notFoundResponse } from '../lib/http.js';
import { requireRole, getSession } from '../lib/auth.js';
import { checkChallengeSubmitLimit, recordChallengeSubmitFailure } from '../lib/ratelimit.js';
import { normalizeAnswer, MAX_ANSWER_SUBMIT_LEN } from '../lib/util.js';
import { CHALLENGE_PARTS } from '../data/challenges.js';
import { topics, topicsWithCheatSheet } from '../data/topics.js';

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
  // completed. Any session incl. guest (matches /api/progress's pattern
  // for topic quizzes) — returns [] rather than an error when signed out,
  // so the page can render normally either way.
  const progressChallengeMatch = path.match(/^\/api\/challenges\/([a-z0-9-]+)\/progress$/);
  if (progressChallengeMatch && request.method === 'GET') {
    if (!env.DB) return jsonResponse({ completed: [] });
    const session = await getSession(request, env);
    if (!session) return jsonResponse({ completed: [] });
    const { results } = await env.DB.prepare(
      'SELECT part_id FROM challenge_completions WHERE user_id = ? AND challenge_id = ?'
    ).bind(session.sub, progressChallengeMatch[1]).all();
    return jsonResponse({ completed: (results ?? []).map(r => r.part_id) });
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

    const match = await env.DB.prepare(
      'SELECT 1 FROM challenge_answers WHERE challenge_id = ? AND part_id = ? AND answer_norm = ?'
    ).bind(challengeId, partId, normalizeAnswer(answer)).first();

    if (!match) {
      await recordChallengeSubmitFailure(env, session.sub);
      return jsonResponse({ correct: false });
    }

    await env.DB.prepare(`
      INSERT INTO challenge_completions (user_id, challenge_id, part_id, completed_at)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(user_id, challenge_id, part_id) DO NOTHING
    `).bind(session.sub, challengeId, partId, Date.now()).run();

    return jsonResponse({ correct: true });
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
