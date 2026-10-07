import { jsonResponse } from '../lib/http.js';
import { requireRole } from '../lib/auth.js';

// Events API. Read: public — anyone, signed in or not (same trust model as
// Announcements). Write: admins only — no per-creator ownership check,
// matching Announcements' "shared unit-wide content" reasoning.
export async function handleEventsRoutes(request, env, url, path, secureCookie) {
  if (!path.startsWith('/api/events')) return null;

  if (!env.JWT_SECRET || !env.DB) return jsonResponse({ error: 'Server not configured' }, 503);

  // GET /api/events — one flat list ordered by date; the client buckets
  // into upcoming/past by comparing to Date.now() at render time.
  if (path === '/api/events' && request.method === 'GET') {
    const { results } = await env.DB.prepare(`
      SELECT e.id, e.title, e.description, e.location, e.event_date, e.created_at, e.updated_at, u.username
      FROM events e
      JOIN users u ON u.id = e.created_by
      ORDER BY e.event_date ASC
    `).all();
    return jsonResponse({ results: results ?? [] });
  }

  const session = await requireRole(request, env, 'member');
  if (session instanceof Response) return session;

  // POST /api/events — admin creates a new event.
  if (path === '/api/events' && request.method === 'POST') {
    if (session.role !== 'admin') return jsonResponse({ error: 'Forbidden' }, 403);

    let body;
    try { body = await request.json(); } catch { return jsonResponse({ error: 'Invalid request body' }, 400); }
    const title = (body?.title ?? '').toString().trim();
    const description = (body?.description ?? '').toString().trim();
    const location = (body?.location ?? '').toString().trim();
    const eventDate = new Date(body?.event_date).getTime();
    if (!title) return jsonResponse({ error: 'Title is required' }, 400);
    if (title.length > 200) return jsonResponse({ error: 'Title must be 200 characters or fewer' }, 400);
    if (!description) return jsonResponse({ error: 'Description is required' }, 400);
    if (description.length > 5000) return jsonResponse({ error: 'Description must be 5000 characters or fewer' }, 400);
    if (isNaN(eventDate)) return jsonResponse({ error: 'A valid event date is required' }, 400);

    const now = Date.now();
    const info = await env.DB.prepare(
      'INSERT INTO events (title, description, location, event_date, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?)'
    ).bind(title, description, location || null, eventDate, session.sub, now).run();
    return jsonResponse({
      id: info.meta.last_row_id, title, description, location: location || null,
      event_date: eventDate, created_at: now, username: session.username,
    }, 201);
  }

  const idMatch = path.match(/^\/api\/events\/(\d+)$/);

  // PATCH /api/events/:id — admin edits any event.
  if (idMatch && request.method === 'PATCH') {
    if (session.role !== 'admin') return jsonResponse({ error: 'Forbidden' }, 403);

    let body;
    try { body = await request.json(); } catch { return jsonResponse({ error: 'Invalid request body' }, 400); }
    const title = (body?.title ?? '').toString().trim();
    const description = (body?.description ?? '').toString().trim();
    const location = (body?.location ?? '').toString().trim();
    const eventDate = new Date(body?.event_date).getTime();
    if (!title) return jsonResponse({ error: 'Title is required' }, 400);
    if (title.length > 200) return jsonResponse({ error: 'Title must be 200 characters or fewer' }, 400);
    if (!description) return jsonResponse({ error: 'Description is required' }, 400);
    if (description.length > 5000) return jsonResponse({ error: 'Description must be 5000 characters or fewer' }, 400);
    if (isNaN(eventDate)) return jsonResponse({ error: 'A valid event date is required' }, 400);

    const info = await env.DB.prepare(
      'UPDATE events SET title = ?, description = ?, location = ?, event_date = ?, updated_at = ? WHERE id = ?'
    ).bind(title, description, location || null, eventDate, Date.now(), idMatch[1]).run();
    if (info.meta.changes === 0) return jsonResponse({ error: 'Event not found' }, 404);
    return jsonResponse({ ok: true });
  }

  // DELETE /api/events/:id — admin deletes any event.
  if (idMatch && request.method === 'DELETE') {
    if (session.role !== 'admin') return jsonResponse({ error: 'Forbidden' }, 403);

    const info = await env.DB.prepare('DELETE FROM events WHERE id = ?').bind(idMatch[1]).run();
    if (info.meta.changes === 0) return jsonResponse({ error: 'Event not found' }, 404);
    return jsonResponse({ ok: true });
  }

  return null;
}
