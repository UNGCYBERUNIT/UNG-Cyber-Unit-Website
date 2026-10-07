// ─── Admin Audit Log ────────────────────────────────────────────────────────
// Append-only by design — see the schema.sql comment above the audit_log
// table. This is the ONLY function that ever writes to it; no PATCH/DELETE
// route for this table should ever be added. `detail` is an optional array
// of { field, before, after } objects, stored as JSON. Returns a bound (not
// yet executed) statement, so callers can push it into an existing
// env.DB.batch([...]) array to commit atomically with the mutation it logs.
export function logAudit(env, { actorId, actorName, action, target, detail }) {
  return env.DB.prepare(
    'INSERT INTO audit_log (actor_id, actor_name, action, target, detail, created_at) VALUES (?, ?, ?, ?, ?, ?)'
  ).bind(actorId, actorName, action, target, detail ? JSON.stringify(detail) : null, Date.now());
}
