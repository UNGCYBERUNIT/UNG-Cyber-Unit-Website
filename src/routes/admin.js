import { jsonResponse } from '../lib/http.js';
import { requireRole } from '../lib/auth.js';
import { logAudit } from '../lib/audit.js';

// Admin API — user list/role-change/delete, audit-log read. Every
// destructive/privilege-altering mutation here rides in the same
// env.DB.batch([...]) as its logAudit() call so the two commit atomically.
// See CLAUDE.md's "Admin audit log" section.
export async function handleAdminRoutes(request, env, url, path, secureCookie) {
  if (!path.startsWith('/api/admin/')) return null;

  if (!env.JWT_SECRET || !env.DB) return jsonResponse({ error: 'Server not configured' }, 503);

  const session = await requireRole(request, env, 'admin');
  if (session instanceof Response) return session;

  // GET /api/admin/users
  if (path === '/api/admin/users' && request.method === 'GET') {
    const { results } = await env.DB.prepare(
      'SELECT id, username, role, created_at FROM users ORDER BY created_at DESC'
    ).all();
    return jsonResponse({ results: results ?? [] });
  }

  // PATCH /api/admin/users/:id — change role
  const adminUserMatch = path.match(/^\/api\/admin\/users\/(\d+)$/);
  if (adminUserMatch && request.method === 'PATCH') {
    const targetId = parseInt(adminUserMatch[1], 10);
    if (targetId === session.sub) return jsonResponse({ error: 'Cannot modify your own account' }, 403);
    let body;
    try { body = await request.json(); } catch { return jsonResponse({ error: 'Invalid request body' }, 400); }
    const { role } = body ?? {};
    if (!['member', 'student', 'instructor', 'admin'].includes(role)) return jsonResponse({ error: 'Invalid role' }, 400);

    const target = await env.DB.prepare('SELECT username, role FROM users WHERE id = ?').bind(targetId).first();
    if (!target) return jsonResponse({ error: 'User not found' }, 404);

    await env.DB.batch([
      env.DB.prepare('UPDATE users SET role = ? WHERE id = ?').bind(role, targetId),
      logAudit(env, {
        actorId: session.sub, actorName: session.username, action: 'user.role_change',
        target: target.username, detail: [{ field: 'role', before: target.role, after: role }],
      }),
    ]);
    return jsonResponse({ ok: true });
  }

  // DELETE /api/admin/users/:id
  if (adminUserMatch && request.method === 'DELETE') {
    const targetId = parseInt(adminUserMatch[1], 10);
    if (targetId === session.sub) return jsonResponse({ error: 'Cannot delete your own account' }, 403);

    const target = await env.DB.prepare('SELECT username, role FROM users WHERE id = ?').bind(targetId).first();
    if (!target) return jsonResponse({ error: 'User not found' }, 404);

    // Shared-content tables (quiz_rooms/announcements/events/kanban_items/
    // question_bank) have a NOT NULL created_by FK back to users with no
    // cascade — deliberately not auto-deleted here, since that content is
    // shared/instructor-managed (CLAUDE.md), not exclusively owned by its
    // creator, so silently destroying a room/announcement/card just
    // because the account that happened to create it got deleted would be
    // a worse surprise than blocking the delete with a clear reason.
    // kanban_items.assigned_to is NOT checked here, unlike created_by —
    // it's nullable (unlike every created_by column), so being someone's
    // assigned card isn't a "you must deal with this first" relationship
    // the way authorship is; the card just goes back to unassigned below.
    // audit_log is NOT checked here either — unlike these, it has no FK at
    // all (schema.sql), by design: the log must survive the actor's
    // account being deleted, which is the entire point of denormalizing
    // actor_name onto each row.
    const blockers = [];
    const checks = [
      ['quiz_rooms', 'created_by', 'Quiz Room(s)'],
      ['announcements', 'created_by', 'announcement(s)'],
      ['events', 'created_by', 'event(s)'],
      ['question_bank', 'created_by', 'question bank template(s)'],
      ['kanban_items', 'created_by', 'Kanban card(s) (as creator)'],
    ];
    for (const [table, column, label] of checks) {
      const row = await env.DB.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE ${column} = ?`).bind(targetId).first();
      if (row?.n > 0) blockers.push(`${row.n} ${label}`);
    }
    if (blockers.length) {
      return jsonResponse({
        error: `Can't delete this account — it's still linked to ${blockers.join(', ')}. Reassign or delete that content first.`,
      }, 409);
    }

    // Cascade room attempt answers before deleting attempts
    const { results: userAttempts } = await env.DB.prepare(
      'SELECT id FROM quiz_room_attempts WHERE user_id = ?'
    ).bind(targetId).all();
    const stmts = (userAttempts ?? []).map(a =>
      env.DB.prepare('DELETE FROM quiz_room_answers WHERE attempt_id = ?').bind(a.id)
    );
    stmts.push(env.DB.prepare('DELETE FROM quiz_room_attempts WHERE user_id = ?').bind(targetId));
    stmts.push(env.DB.prepare('DELETE FROM quiz_results WHERE user_id = ?').bind(targetId));
    stmts.push(env.DB.prepare('DELETE FROM challenge_completions WHERE user_id = ?').bind(targetId));
    stmts.push(env.DB.prepare('DELETE FROM user_emails WHERE user_id = ?').bind(targetId));
    stmts.push(env.DB.prepare('UPDATE kanban_items SET assigned_to = NULL WHERE assigned_to = ?').bind(targetId));
    stmts.push(env.DB.prepare('DELETE FROM users WHERE id = ?').bind(targetId));
    stmts.push(logAudit(env, {
      actorId: session.sub, actorName: session.username, action: 'user.delete',
      target: target.username, detail: [{ field: 'role', before: target.role, after: null }],
    }));
    await env.DB.batch(stmts);
    return jsonResponse({ ok: true });
  }

  // GET /api/admin/audit-log?before=<id>&limit=50 — cursor-paginated,
  // newest first. No PATCH/DELETE route for this table exists, or ever
  // should — see the append-only comments on schema.sql's audit_log
  // table and logAudit() above.
  if (path === '/api/admin/audit-log' && request.method === 'GET') {
    const limit = Math.min(Math.max(parseInt(url.searchParams.get('limit'), 10) || 50, 1), 100);
    const before = parseInt(url.searchParams.get('before'), 10);
    const cursorClause = Number.isInteger(before) ? 'WHERE id < ?' : '';
    const cursorBind = Number.isInteger(before) ? [before] : [];

    const { results } = await env.DB.prepare(
      `SELECT id, actor_id, actor_name, action, target, detail, created_at FROM audit_log ${cursorClause} ORDER BY id DESC LIMIT ?`
    ).bind(...cursorBind, limit).all();

    return jsonResponse({
      results: (results ?? []).map(r => ({ ...r, detail: r.detail ? JSON.parse(r.detail) : null })),
    });
  }

  return null;
}
