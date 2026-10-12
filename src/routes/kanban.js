import { jsonResponse } from '../lib/http.js';
import { requireRole } from '../lib/auth.js';
import { logAudit } from '../lib/audit.js';
import { sendResendEmail } from '../lib/email.js';
import { parseCSVLine } from '../lib/util.js';

// Kanban Board (Jira replacement, see docs/plan-kanban-board.md). One
// shared board, instructor+-gated for both read and write — any
// instructor/admin may create/edit/move/delete any card, no per-creator
// ownership check, same shared-content trust model as Announcements, not
// Quiz Rooms' per-creator model. Fixed status/priority/item_type enums
// rather than Jira-style custom workflows.
const STATUSES = ['idea', 'todo', 'in_progress', 'in_review', 'archived'];
const PRIORITIES = ['lowest', 'low', 'medium', 'high', 'highest'];
const ITEM_TYPES = ['task', 'story', 'subtask', 'epic'];
const MAX_IMPORT_FILE_BYTES = 1_000_000; // same cap as the Quiz Room question-file upload
const MAX_IMPORT_ROWS = 500;

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

// CSV import. Reuses parseCSVLine (src/lib/util.js — the same quote-aware
// tokenizer the Quiz Room question-file upload uses) for line-splitting
// only; everything column-specific is kanban's own, so it stays here rather
// than in util.js (per CLAUDE.md: src/lib/*.js is for logic every domain
// can depend on, not one domain's own parsing rules).
//
// Sanitization: every field goes through the exact same validateItemFields()
// used by the manual create/edit API — same 200/5000-char caps, same
// enum whitelist for status/priority/type, same due-date parse check — so a
// malformed or hostile CSV can't smuggle in a field the manual form
// couldn't. Every DB write is a parameterized bind() (no string-built SQL
// anywhere in this file), and every value is HTML-escaped again client-side
// on render (escHtml() in public/js/main.js) — the CSV text itself is never
// trusted as safe-to-render just because it passed validation here.
function parseKanbanCSV(text) {
  const lines = text.trim().split(/\r?\n/);
  if (lines.length < 2) return { error: 'CSV must have a header row and at least one task' };
  const headers = parseCSVLine(lines[0]).map(h => h.toLowerCase().trim());
  if (!headers.includes('title')) return { error: 'Missing required CSV column: title' };
  const get = (row, col) => { const i = headers.indexOf(col); return i >= 0 ? (row[i] ?? '').trim() : ''; };

  const rows = [];
  for (let r = 1; r < lines.length; r++) {
    if (!lines[r].trim()) continue;
    if (rows.length >= MAX_IMPORT_ROWS) return { error: `Maximum ${MAX_IMPORT_ROWS} tasks per import` };
    const row = parseCSVLine(lines[r]);
    const title = get(row, 'title');
    if (!title) continue; // a blank title cell is a skippable blank row, not an error
    rows.push({
      rowNum: r + 1, // 1-indexed, header included, so humans can match it back to their spreadsheet
      title,
      description: get(row, 'description'),
      status: get(row, 'status').toLowerCase() || 'idea',
      priority: get(row, 'priority').toLowerCase() || 'medium',
      item_type: get(row, 'type').toLowerCase() || 'task',
      assigneeUsername: get(row, 'assignee'),
      due_date: get(row, 'due_date') || null,
      parentTitle: get(row, 'parent'),
    });
  }
  if (rows.length === 0) return { error: 'No valid tasks found in CSV (need at least a non-empty "title" column)' };
  return { rows };
}

// Assignees are restricted to instructor+ (this is an internal planning
// board — members/students never see it at all, so there'd be no one for a
// member-assigned card to notify anyway). Re-checked here, not just
// filtered out of the picker dropdowns, so a direct API call can't assign a
// card to a member/student/guest id that was never offered in the UI.
async function assigneeIsInstructorPlus(env, userId) {
  const row = await env.DB.prepare('SELECT role FROM users WHERE id = ?').bind(userId).first();
  return row?.role === 'instructor' || row?.role === 'admin';
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
  // separate from GET /api/admin/users, which is admin-only. Scoped to
  // instructor+ accounts only — see assigneeIsInstructorPlus() above for why.
  if (path === '/api/kanban/users' && request.method === 'GET') {
    const { results } = await env.DB.prepare(
      "SELECT id, username FROM users WHERE role IN ('instructor', 'admin') ORDER BY username ASC"
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

  // POST /api/kanban/import — bulk-create cards from an uploaded CSV. Same
  // multipart/1MB-cap pattern as the Quiz Room question-file upload
  // (src/routes/rooms.js). All-or-nothing: if any row fails validation, the
  // whole import is rejected and nothing is written — matches parseCSV's
  // existing all-or-nothing behavior for question uploads, so a partially-
  // bad spreadsheet never leaves the board half-imported.
  if (path === '/api/kanban/import' && request.method === 'POST') {
    let formData;
    try { formData = await request.formData(); } catch { return jsonResponse({ error: 'Expected multipart/form-data' }, 400); }

    const file = formData.get('file');
    if (!file || typeof file.text !== 'function') return jsonResponse({ error: 'No file uploaded' }, 400);
    if (file.size > MAX_IMPORT_FILE_BYTES) return jsonResponse({ error: 'CSV file must be under 1MB' }, 400);

    const text = await file.text();
    const parseResult = parseKanbanCSV(text);
    if (parseResult.error) return jsonResponse({ error: parseResult.error }, 400);

    // Resolve "assignee" usernames up front (case-insensitive) — an
    // unmatched username is not an error (see docs/plan-kanban-board.md's
    // Chunk 0: don't invent placeholder accounts), it just leaves the card
    // unassigned, same as a blank assignee cell. Only instructor+ accounts
    // are eligible (same restriction as the manual create/edit assignee
    // picker), so a CSV naming a member/student in its "assignee" column
    // also just imports unassigned rather than being rejected.
    const { results: allUsers } = await env.DB.prepare("SELECT id, username FROM users WHERE role IN ('instructor', 'admin')").all();
    const usernameToId = new Map((allUsers ?? []).map(u => [u.username.toLowerCase(), u.id]));

    // Validate every row through the exact same gate the manual create/edit
    // API uses, before writing anything.
    const parsedRows = [];
    for (const row of parseResult.rows) {
      const assignedTo = row.assigneeUsername ? (usernameToId.get(row.assigneeUsername.toLowerCase()) ?? null) : null;
      const parsed = validateItemFields({
        title: row.title, description: row.description, status: row.status, priority: row.priority,
        item_type: row.item_type, assigned_to: assignedTo, due_date: row.due_date,
      });
      if (parsed.error) return jsonResponse({ error: `Row ${row.rowNum}: ${parsed.error}` }, 400);
      parsedRows.push({ ...parsed, parentTitle: row.parentTitle, assignedTo });
    }

    // sort_order continues on from whatever's already in each status column
    // (rather than starting every import back at 0 and colliding with
    // existing cards).
    const { results: existing } = await env.DB.prepare('SELECT id, title, status, sort_order FROM kanban_items').all();
    const nextOrderByStatus = {};
    for (const s of STATUSES) {
      nextOrderByStatus[s] = Math.max(-1, ...(existing ?? []).filter(i => i.status === s).map(i => i.sort_order)) + 1;
    }

    const now = Date.now();
    const insertStmts = parsedRows.map(r => {
      const sortOrder = nextOrderByStatus[r.status]++;
      return env.DB.prepare(`
        INSERT INTO kanban_items (title, description, item_type, status, priority, sort_order, assigned_to, due_date, created_by, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).bind(r.title, r.description, r.itemType, r.status, r.priority, sortOrder, r.assignedTo, r.dueDate, session.sub, now);
    });
    const insertResults = await env.DB.batch(insertStmts);
    const insertedIds = insertResults.map(res => res.meta.last_row_id);

    // Resolve "parent" by title — a sibling row in this same CSV first
    // (common for a Jira-style export where a task and its subtasks are in
    // one file), falling back to an existing card's title on the board.
    // Deliberately a snapshot title match, not an id reference: CSVs have
    // no concept of this board's internal ids. An unresolved parent title
    // is reported back, not treated as an import failure — the row still
    // imports, just without the subtask link.
    const titleToId = new Map((existing ?? []).map(i => [i.title.toLowerCase(), i.id]));
    parsedRows.forEach((r, idx) => titleToId.set(r.title.toLowerCase(), insertedIds[idx]));

    const parentUpdates = [];
    const unresolvedParents = [];
    parsedRows.forEach((r, idx) => {
      if (!r.parentTitle) return;
      const parentId = titleToId.get(r.parentTitle.toLowerCase());
      if (!parentId || parentId === insertedIds[idx]) { unresolvedParents.push(r.title); return; }
      parentUpdates.push(env.DB.prepare('UPDATE kanban_items SET parent_id = ? WHERE id = ?').bind(parentId, insertedIds[idx]));
    });
    if (parentUpdates.length) await env.DB.batch(parentUpdates);

    // No per-row assignment emails on a bulk import — a 50-row CSV
    // shouldn't fire 50 emails at once. Manual single-card assignment
    // (create/edit) still notifies as usual.
    return jsonResponse({ imported: parsedRows.length, unresolvedParents }, 201);
  }

  // POST /api/kanban/items
  if (path === '/api/kanban/items' && request.method === 'POST') {
    let body;
    try { body = await request.json(); } catch { return jsonResponse({ error: 'Invalid request body' }, 400); }
    const parsed = validateItemFields(body);
    if (parsed.error) return jsonResponse({ error: parsed.error }, 400);
    if (parsed.assignedTo && !(await assigneeIsInstructorPlus(env, parsed.assignedTo))) {
      return jsonResponse({ error: 'Assignee must be an instructor or admin' }, 400);
    }

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
    if (parsed.assignedTo && parsed.assignedTo !== existing.assigned_to && !(await assigneeIsInstructorPlus(env, parsed.assignedTo))) {
      return jsonResponse({ error: 'Assignee must be an instructor or admin' }, 400);
    }

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

    // parent_id has a FOREIGN KEY back to this same table with no ON DELETE
    // behavior, so deleting a card that still has subtasks pointing at it
    // would violate that constraint. Detach them (promote to top-level
    // cards) rather than cascading the delete into them — losing a
    // subtask's whole record just because its parent was cleaned up would
    // be a surprising, silent data loss for something this low-stakes.
    await env.DB.batch([
      env.DB.prepare('UPDATE kanban_items SET parent_id = NULL WHERE parent_id = ?').bind(idMatch[1]),
      env.DB.prepare('DELETE FROM kanban_items WHERE id = ?').bind(idMatch[1]),
      logAudit(env, {
        actorId: session.sub, actorName: session.username, action: 'kanban.delete', target: existing.title,
      }),
    ]);
    return jsonResponse({ ok: true });
  }

  return null;
}
