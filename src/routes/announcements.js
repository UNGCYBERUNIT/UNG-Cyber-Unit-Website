import { jsonResponse } from '../lib/http.js';
import { requireRole } from '../lib/auth.js';
import { logAudit } from '../lib/audit.js';

// Announcements API. Read: public — anyone, signed in or not. Write:
// admins only — announcements are shared unit-wide content, not personal,
// so any admin may edit/delete any post (no per-creator ownership check,
// unlike Quiz Rooms).
export async function handleAnnouncementsRoutes(request, env, url, path, secureCookie) {
  if (!path.startsWith('/api/announcements')) return null;

  if (!env.JWT_SECRET || !env.DB) return jsonResponse({ error: 'Server not configured' }, 503);

  // GET /api/announcements — newest first; client handles sort/search.
  // No auth required — announcements are public.
  if (path === '/api/announcements' && request.method === 'GET') {
    const { results } = await env.DB.prepare(`
      SELECT a.id, a.title, a.body, a.created_at, a.updated_at, u.username
      FROM announcements a
      JOIN users u ON u.id = a.created_by
      ORDER BY a.created_at DESC
    `).all();
    return jsonResponse({ results: results ?? [] });
  }

  const session = await requireRole(request, env, 'member');
  if (session instanceof Response) return session;

  // POST /api/announcements/seen — any signed-in non-guest member marks
  // themself caught up, clearing the unread badge (see /api/auth/me).
  if (path === '/api/announcements/seen' && request.method === 'POST') {
    await env.DB.prepare('UPDATE users SET last_seen_announcements = ? WHERE id = ?')
      .bind(Date.now(), session.sub).run();
    return jsonResponse({ ok: true });
  }

  // POST /api/announcements — admin creates a new announcement.
  if (path === '/api/announcements' && request.method === 'POST') {
    if (session.role !== 'admin') return jsonResponse({ error: 'Forbidden' }, 403);

    let body;
    try { body = await request.json(); } catch { return jsonResponse({ error: 'Invalid request body' }, 400); }
    const title = (body?.title ?? '').toString().trim();
    const text = (body?.body ?? '').toString().trim();
    if (!title) return jsonResponse({ error: 'Title is required' }, 400);
    if (title.length > 200) return jsonResponse({ error: 'Title must be 200 characters or fewer' }, 400);
    if (!text) return jsonResponse({ error: 'Body is required' }, 400);
    if (text.length > 5000) return jsonResponse({ error: 'Body must be 5000 characters or fewer' }, 400);

    const now = Date.now();
    const [info] = await env.DB.batch([
      env.DB.prepare(
        'INSERT INTO announcements (title, body, created_by, created_at) VALUES (?, ?, ?, ?)'
      ).bind(title, text, session.sub, now),
      logAudit(env, {
        actorId: session.sub, actorName: session.username, action: 'announcement.create', target: title,
      }),
    ]);
    return jsonResponse({ id: info.meta.last_row_id, title, body: text, created_at: now, username: session.username }, 201);
  }

  const idMatch = path.match(/^\/api\/announcements\/(\d+)$/);

  // PATCH /api/announcements/:id — admin edits any announcement.
  if (idMatch && request.method === 'PATCH') {
    if (session.role !== 'admin') return jsonResponse({ error: 'Forbidden' }, 403);

    let body;
    try { body = await request.json(); } catch { return jsonResponse({ error: 'Invalid request body' }, 400); }
    const title = (body?.title ?? '').toString().trim();
    const text = (body?.body ?? '').toString().trim();
    if (!title) return jsonResponse({ error: 'Title is required' }, 400);
    if (title.length > 200) return jsonResponse({ error: 'Title must be 200 characters or fewer' }, 400);
    if (!text) return jsonResponse({ error: 'Body is required' }, 400);
    if (text.length > 5000) return jsonResponse({ error: 'Body must be 5000 characters or fewer' }, 400);

    const existing = await env.DB.prepare('SELECT title, body FROM announcements WHERE id = ?').bind(idMatch[1]).first();
    if (!existing) return jsonResponse({ error: 'Announcement not found' }, 404);

    await env.DB.batch([
      env.DB.prepare(
        'UPDATE announcements SET title = ?, body = ?, updated_at = ? WHERE id = ?'
      ).bind(title, text, Date.now(), idMatch[1]),
      logAudit(env, {
        actorId: session.sub, actorName: session.username, action: 'announcement.edit', target: title,
        detail: [
          { field: 'title', before: existing.title, after: title },
          { field: 'body', before: existing.body, after: text },
        ],
      }),
    ]);
    return jsonResponse({ ok: true });
  }

  // DELETE /api/announcements/:id — admin deletes any announcement.
  if (idMatch && request.method === 'DELETE') {
    if (session.role !== 'admin') return jsonResponse({ error: 'Forbidden' }, 403);

    const existing = await env.DB.prepare('SELECT title FROM announcements WHERE id = ?').bind(idMatch[1]).first();
    if (!existing) return jsonResponse({ error: 'Announcement not found' }, 404);

    await env.DB.batch([
      env.DB.prepare('DELETE FROM announcements WHERE id = ?').bind(idMatch[1]),
      logAudit(env, {
        actorId: session.sub, actorName: session.username, action: 'announcement.delete', target: existing.title,
      }),
    ]);
    return jsonResponse({ ok: true });
  }

  return null;
}
