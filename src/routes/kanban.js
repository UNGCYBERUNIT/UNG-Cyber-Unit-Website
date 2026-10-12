import { jsonResponse } from '../lib/http.js';
import { requireRole } from '../lib/auth.js';
import { logAudit } from '../lib/audit.js';
import { sendResendEmail } from '../lib/email.js';

// Kanban Board (Jira replacement, see docs/plan-kanban-board.md). One
// shared board, instructor+-gated for both read and write — any
// instructor/admin may create/edit/move/delete any card, no per-creator
// ownership check, same shared-content trust model as Announcements, not
// Quiz Rooms' per-creator model. Fixed status/priority/item_type enums
// rather than Jira-style custom workflows.
const STATUSES = ['idea', 'todo', 'in_progress', 'in_review', 'done'];
const PRIORITIES = ['lowest', 'low', 'medium', 'high', 'highest'];
const ITEM_TYPES = ['task', 'story', 'subtask', 'epic'];

function validateItemFields(body) {
  const title = (body?.title ?? '').toString().trim();
  const description = (body?.description ?? '').toString().trim();
  const status = (body?.status ?? 'idea').toString();
  const priority = (body?.priority ?? 'medium').toString();
  const itemType = (body?.item_type ?? 'task').toString();
  const assignedTo = body?.assigned_to === null || body?.assigned_to === undefined || body?.assigned_to === ''
    ? null
    : parseInt(body.assigned_to, 10);
  const parentId = body?.parent_id === null || body?.parent_id === undefined || body?.parent_id === ''
    ? null
    : parseInt(body.parent_id, 10);

  let dueDate = null;
  if (body?.due_date !== null && body?.due_date !== undefined && body?.due_date !== '') {
    const d = new Date(body.due_date);
    if (isNaN(d.getTime())) return { error: 'Invalid due date' };
    dueDate = Math.floor(d.getTime() / 1000);
  }

  if (!title) return { error: 'Title is required' };
  if (title.length > 200) return { error: 'Title must be 200 characters or fewer' };
  if (description.length > 5000) return { error: 'Description must be 5000 characters or fewer' };
  if (!STATUSES.includes(status)) return { error: 'Invalid status' };
  if (!PRIORITIES.includes(priority)) return { error: 'Invalid priority' };
  if (!ITEM_TYPES.includes(itemType)) return { error: 'Invalid item type' };
  if (assignedTo !== null && (!Number.isInteger(assignedTo) || assignedTo <= 0)) return { error: 'Invalid assignee' };
  if (parentId !== null && (!Number.isInteger(parentId) || parentId <= 0)) return { error: 'Invalid parent item' };

  return { title, description, status, priority, itemType, assignedTo, parentId, dueDate };
}

async function notifyAssignee(env, { assignedTo, title, id }) {
  if (!assignedTo || !env.RESEND_API_KEY) return;
  const assignee = await env.DB.prepare('SELECT email, username FROM users WHERE id = ?').bind(assignedTo).first();
  if (!assignee?.email) return;
  try {
    await sendResendEmail(env, {
      to: assignee.email,
      subject: `You were assigned a Kanban card — ${title}`,
      text: `You were assigned to "${title}" on the Cyber Unit Kanban board.\n\nView it: ${env.SITE_ORIGIN ?? 'https://ungcyberunit.org'}/kanban`,
      html: `<p>You were assigned to <strong>${title}</strong> on the Cyber Unit Kanban board.</p><p><a href="${env.SITE_ORIGIN ?? 'https://ungcyberunit.org'}/kanban">View the board</a></p>`,
    });
  } catch (err) {
    console.error('kanban assignment notification failed', err.message);
  }
}

export async function handleKanbanRoutes(request, env, url, path, secureCookie) {
  if (!path.startsWith('/api/kanban')) return null;

  if (!env.JWT_SECRET || !env.DB) return jsonResponse({ error: 'Server not configured' }, 503);
  const session = await requireRole(request, env, 'instructor');
  if (session instanceof Response) return session;

  // GET /api/kanban/users — instructor+ picker list (id/username only, no
  // role/email/other profile fields) for the assignee dropdown. Deliberately
  // separate from GET /api/admin/users, which is admin-only.
  if (path === '/api/kanban/users' && request.method === 'GET') {
    const { results } = await env.DB.prepare(
      'SELECT id, username FROM users ORDER BY username ASC'
    ).all();
    return jsonResponse({ results: results ?? [] });
  }

  // GET /api/kanban/items
  if (path === '/api/kanban/items' && request.method === 'GET') {
    const { results } = await env.DB.prepare(`
      SELECT i.id, i.title, i.description, i.item_type, i.status, i.priority, i.sort_order,
             i.parent_id, i.due_date, i.created_at, i.updated_at,
             i.assigned_to, au.username AS assigned_username,
             i.created_by, cu.username AS created_username
      FROM kanban_items i
      LEFT JOIN users au ON au.id = i.assigned_to
      JOIN users cu ON cu.id = i.created_by
      ORDER BY i.status, i.sort_order
    `).all();
    return jsonResponse({ results: results ?? [] });
  }

  // POST /api/kanban/items
  if (path === '/api/kanban/items' && request.method === 'POST') {
    let body;
    try { body = await request.json(); } catch { return jsonResponse({ error: 'Invalid request body' }, 400); }
    const parsed = validateItemFields(body);
    if (parsed.error) return jsonResponse({ error: parsed.error }, 400);

    const now = Date.now();
    const info = await env.DB.prepare(`
      INSERT INTO kanban_items (title, description, item_type, status, priority, sort_order, parent_id, assigned_to, due_date, created_by, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      parsed.title, parsed.description, parsed.itemType, parsed.status, parsed.priority,
      body?.sort_order ?? 0, parsed.parentId, parsed.assignedTo, parsed.dueDate, session.sub, now
    ).run();

    await notifyAssignee(env, { assignedTo: parsed.assignedTo, title: parsed.title, id: info.meta.last_row_id });
    return jsonResponse({ id: info.meta.last_row_id, ...parsed, created_by: session.sub, created_at: now }, 201);
  }

  const idMatch = path.match(/^\/api\/kanban\/items\/(\d+)$/);

  // PATCH /api/kanban/items/:id
  if (idMatch && request.method === 'PATCH') {
    const existing = await env.DB.prepare('SELECT * FROM kanban_items WHERE id = ?').bind(idMatch[1]).first();
    if (!existing) return jsonResponse({ error: 'Item not found' }, 404);

    let body;
    try { body = await request.json(); } catch { return jsonResponse({ error: 'Invalid request body' }, 400); }

    // Merge onto the existing row so a partial PATCH (e.g. drag-and-drop
    // sending only status/sort_order) doesn't need to resend every field.
    const merged = {
      title: body.title ?? existing.title,
      description: body.description ?? existing.description,
      status: body.status ?? existing.status,
      priority: body.priority ?? existing.priority,
      item_type: body.item_type ?? existing.item_type,
      assigned_to: body.assigned_to !== undefined ? body.assigned_to : existing.assigned_to,
      parent_id: body.parent_id !== undefined ? body.parent_id : existing.parent_id,
      due_date: body.due_date !== undefined ? body.due_date : (existing.due_date ? new Date(existing.due_date * 1000).toISOString() : null),
      sort_order: body.sort_order ?? existing.sort_order,
    };
    const parsed = validateItemFields(merged);
    if (parsed.error) return jsonResponse({ error: parsed.error }, 400);
    if (!Number.isInteger(merged.sort_order)) return jsonResponse({ error: 'Invalid sort order' }, 400);

    await env.DB.prepare(`
      UPDATE kanban_items
      SET title = ?, description = ?, item_type = ?, status = ?, priority = ?, sort_order = ?, parent_id = ?, assigned_to = ?, due_date = ?, updated_at = ?
      WHERE id = ?
    `).bind(
      parsed.title, parsed.description, parsed.itemType, parsed.status, parsed.priority,
      merged.sort_order, parsed.parentId, parsed.assignedTo, parsed.dueDate, Date.now(), idMatch[1]
    ).run();

    if (parsed.assignedTo && parsed.assignedTo !== existing.assigned_to) {
      await notifyAssignee(env, { assignedTo: parsed.assignedTo, title: parsed.title, id: idMatch[1] });
    }
    return jsonResponse({ ok: true });
  }

  // DELETE /api/kanban/items/:id — the one destructive Kanban action, so
  // it's the one that gets audit-logged (create/edit/move/assign are
  // low-stakes and reversible — see docs/plan-kanban-board.md's Chunk 0).
  if (idMatch && request.method === 'DELETE') {
    const existing = await env.DB.prepare('SELECT title FROM kanban_items WHERE id = ?').bind(idMatch[1]).first();
    if (!existing) return jsonResponse({ error: 'Item not found' }, 404);

    await env.DB.batch([
      env.DB.prepare('DELETE FROM kanban_items WHERE id = ?').bind(idMatch[1]),
      logAudit(env, {
        actorId: session.sub, actorName: session.username, action: 'kanban.delete', target: existing.title,
      }),
    ]);
    return jsonResponse({ ok: true });
  }

  return null;
}
