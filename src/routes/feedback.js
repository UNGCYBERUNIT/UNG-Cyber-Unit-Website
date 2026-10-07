import { jsonResponse } from '../lib/http.js';
import { getSession, requireRole } from '../lib/auth.js';
import { checkFeedbackLimit, recordFeedbackSubmission } from '../lib/ratelimit.js';

// Feedback API — the site's public suggestion box. Open to anyone, signed
// in or not: submission has no requireRole gate, just IP rate-limiting.
// Reading/deleting submissions is admin-only.
export async function handleFeedbackRoutes(request, env, url, path, secureCookie) {
  if (!path.startsWith('/api/feedback')) return null;

  if (!env.DB) return jsonResponse({ error: 'Server not configured' }, 503);

  // POST /api/feedback — anyone may submit; username attached only if
  // a valid session happens to be present (getSession, not requireRole,
  // so signed-out visitors aren't blocked).
  if (path === '/api/feedback' && request.method === 'POST') {
    const limited = await checkFeedbackLimit(env, request);
    if (limited) return limited;

    let body;
    try { body = await request.json(); } catch { return jsonResponse({ error: 'Invalid request body' }, 400); }
    const message = (body?.message ?? '').toString().trim();
    if (!message) return jsonResponse({ error: 'Message is required' }, 400);
    if (message.length > 5000) return jsonResponse({ error: 'Message must be 5000 characters or fewer' }, 400);

    const session = await getSession(request, env);
    const username = session?.username ?? null;

    const now = Date.now();
    await env.DB.prepare(
      'INSERT INTO feedback (message, username, created_at) VALUES (?, ?, ?)'
    ).bind(message, username, now).run();
    await recordFeedbackSubmission(env, request);
    return jsonResponse({ ok: true }, 201);
  }

  const feedbackIdMatch = path.match(/^\/api\/feedback\/(\d+)$/);

  // GET /api/feedback — admin reviews all submissions, newest first.
  if (path === '/api/feedback' && request.method === 'GET') {
    const session = await requireRole(request, env, 'admin');
    if (session instanceof Response) return session;

    const { results } = await env.DB.prepare(
      'SELECT id, message, username, created_at FROM feedback ORDER BY created_at DESC'
    ).all();
    return jsonResponse({ results: results ?? [] });
  }

  // DELETE /api/feedback/:id — admin dismisses a submission.
  if (feedbackIdMatch && request.method === 'DELETE') {
    const session = await requireRole(request, env, 'admin');
    if (session instanceof Response) return session;

    const info = await env.DB.prepare('DELETE FROM feedback WHERE id = ?').bind(feedbackIdMatch[1]).run();
    if (info.meta.changes === 0) return jsonResponse({ error: 'Feedback not found' }, 404);
    return jsonResponse({ ok: true });
  }

  return null;
}
