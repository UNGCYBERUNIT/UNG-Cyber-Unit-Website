# Plan: Admin Audit Log

**Goal:** an append-only record of admin-consequential actions (role
changes, room/user deletions, announcement create/edit/delete) so there's
accountability for who changed what, and when — currently these mutations
happen silently with no trail.

**Status:** **Done — shipped 2026-09-23.** `logAudit()` instruments all five
destructive/privilege-altering mutations (role change, user delete,
announcement create/edit/delete, room delete), each riding in the same
`env.DB.batch([...])` as the mutation it logs so the two commit atomically.
No PATCH/DELETE route for `audit_log` exists, by design. See `CLAUDE.md`'s
"Admin audit log" section for the current behavior.

---

## Chunk 0 — DECISIONS (need your input before building)

- [ ] **Which actions are in scope for v1?** Recommend starting narrow and
      expanding later rather than instrumenting everything at once:
      - `PATCH /api/admin/users/:id` (role change) — highest-value, this is
        the one action that grants/revokes real privilege.
      - `DELETE /api/admin/users/:id` (account deletion) — destructive,
        cascades data.
      - `POST/PATCH/DELETE /api/announcements` — unit-wide content, any
        admin can edit/delete any post today with zero trail.
      - `DELETE /api/rooms/:code` (instructor or admin) — destructive,
        cascades quiz data.
      **Recommend all four for v1** — they're the only *destructive or
      privilege-altering* mutations in the app today; everything else
      (creating a room, submitting a quiz, toggling profile visibility) is
      either non-destructive or already scoped to the acting user's own data.
- [ ] **Who can appear as an *actor*?** Only admins (role-change, user
      delete, announcements) plus instructors (room delete, since instructors
      can delete their own rooms without admin involvement). Confirm
      instructor room-deletes belong in the *admin* audit log even though the
      actor isn't an admin — recommend yes, "who deleted this room" is
      exactly the kind of question the log exists to answer regardless of
      the actor's role.
- [ ] **Retention / pagination:** this table is append-only and will grow
      forever. Recommend cursor/offset pagination on the read endpoint from
      day one (don't ship an unbounded `SELECT *`), and explicitly *no*
      auto-pruning for now — an audit log that silently deletes its own old
      entries defeats the purpose; revisit only if storage actually becomes a
      concern.
- [ ] **Diff shape:** store a small structured JSON blob (`{ field, before,
      after }` pairs) vs. a free-text summary string. Recommend structured
      JSON — cheap to produce at each call site (they already have both the
      old and new values in scope), and lets the UI render "role: member →
      instructor" cleanly instead of parsing a sentence.

---

## Session learnings / project gotchas (READ FIRST)

- **This must be genuinely append-only at the API layer, not just by
  convention.** No `PATCH`/`DELETE` route should ever exist for this table —
  the only mutation is the `INSERT` performed as a side effect of the
  actions being logged. Don't even build an admin "clear log" button later
  without treating that as a deliberate, separately-reviewed decision (it
  would defeat the feature's purpose).
- **Exact call sites needing a new `INSERT`** (verified by reading
  `worker.js` directly, not inferred):
  - `PATCH /api/admin/users/:id` — `worker.js` ~2354–2364. The handler
    already has `targetId`, the **old** role is NOT currently fetched before
    the `UPDATE` — a `SELECT role FROM users WHERE id = ?` needs to be added
    *before* the `UPDATE` to capture the before-state, since
    `UPDATE ... RETURNING` isn't used here today (would need to switch to
    `.first()` on an `UPDATE ... RETURNING role AS old_role` in D1/SQLite if
    avoiding an extra round-trip is desired — SQLite supports `RETURNING`).
  - `DELETE /api/admin/users/:id` — ~2367–2382. Log before the cascade runs
    (capture `username`/`role` of the deleted user — the row won't exist to
    look up afterward).
  - `POST /api/announcements` — ~2415–2432. Straightforward: log the new
    `id`/`title` after `INSERT`.
  - `PATCH /api/announcements/:id` — ~2437–2454. Same before-state problem
    as the role change: no `SELECT` of the old `title`/`body` happens today
    before the `UPDATE`; needs one added (or `RETURNING`).
  - `DELETE /api/announcements/:id` — ~2457–2463. Log before delete (title
    at minimum — capture it via a `SELECT` first, since the current code
    goes straight to `DELETE ... WHERE id = ?` with no prior read).
  - `DELETE /api/rooms/:code` — ~3037–3059. Room title/code already in scope
    (`room` was already `SELECT`ed for the ownership check) — cheapest of
    the five, no extra query needed.
- **Ownership/auth pattern**: all five call sites already run behind
  `requireRole(request, env, 'admin')` or `'instructor')` — the audit
  `INSERT` just needs `session.sub`/`session.username` (already in scope at
  every site) as the actor, no new auth logic.
- **SQL-injection guard**: this feature only ever inserts fixed columns with
  bound parameters — no dynamic table/column names, so no new
  fixed-lookup-list concern (unlike, say, `leaderboardRank`'s `table` param).
- **D1 batch semantics**: several of these sites already build an
  `env.DB.batch([...])` array for cascading deletes (e.g. `DELETE
  /api/rooms/:code` at ~3052–3058). The audit-log insert should be added to
  the *same* batch where one exists, so the log entry and the mutation
  commit atomically — don't fire it as a separate, unbatched `.run()` after,
  or a crash between the two could leave the mutation applied with no log
  entry (or vice versa on some future retry logic).

---

## Implementation checklist

### 1. Data model + migration
- [ ] `schema.sql` addition:
  ```sql
  -- Append-only. No UPDATE/DELETE route should ever exist for this table.
  CREATE TABLE IF NOT EXISTS audit_log (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    actor_id    INTEGER NOT NULL,
    actor_name  TEXT    NOT NULL,
    action      TEXT    NOT NULL,   -- e.g. 'user.role_change', 'user.delete',
                                     -- 'announcement.create', 'announcement.edit',
                                     -- 'announcement.delete', 'room.delete'
    target      TEXT    NOT NULL,   -- human-readable target, e.g. username or room code
    detail      TEXT,               -- JSON: [{ field, before, after }, ...] or null
    created_at  INTEGER NOT NULL,
    FOREIGN KEY (actor_id) REFERENCES users(id)
  );
  CREATE INDEX IF NOT EXISTS idx_audit_log_created_at ON audit_log (created_at);
  ```
  No `FOREIGN KEY` cascade behavior needed even if a user is later deleted —
  `actor_id` intentionally isn't cleaned up on user deletion (the log should
  survive the actor's account being removed); this means the log's
  `actor_name` column (not just `actor_id`) is required — captured as a
  denormalized snapshot at insert time, so the log stays readable even after
  an actor account no longer exists.
- [ ] Migrate `--local`, then **`--remote` before deploy**:
  ```
  npx wrangler d1 execute DB --local  --command "CREATE TABLE IF NOT EXISTS audit_log (...)"
  npx wrangler d1 execute DB --remote --command "CREATE TABLE IF NOT EXISTS audit_log (...)"
  ```

### 2. Server (`worker.js`)
- [ ] Small helper: `async function logAudit(env, { actorId, actorName, action, target, detail })`
      → single parameterized `INSERT`, `detail` passed through
      `JSON.stringify(detail ?? null)`. Centralizes the insert shape so all
      five call sites stay consistent.
- [ ] Add the before-state `SELECT` (or switch to `RETURNING`) + `logAudit(...)`
      call at each of the five sites listed above. Where an existing
      `env.DB.batch([...])` array already exists (room delete, user delete),
      push the audit insert into that same batch rather than a separate call.
- [ ] `GET /api/admin/audit-log` — `requireRole(..., 'admin')`, paginated
      (`?before=<id>&limit=50` cursor pattern, or offset — cursor avoids
      skipped/duplicated rows under concurrent inserts), newest first.
- [ ] **No PATCH/DELETE route** for this table, ever — enforce by simply not
      writing one, and note this explicitly in a comment above the schema
      table definition and the route handler (per gotchas above).

### 3. Client (`admin.html` + `main.js`)
- [ ] New "Audit Log" section in `admin.html`, below the existing "Contact
      Messages" section — a simple table (timestamp, actor, action, target,
      detail expandable) with a "Load more" button driving the cursor
      pagination.
- [ ] `main.js`: fetch/render function following the same pattern as
      `renderRoomsTable`/the existing admin user-table renderer (grep for the
      existing admin-table render function and mirror its structure/escaping
      — all actor/target strings must go through `escHtml`).

### 4. Tests (`test/worker.test.mjs`)
- [ ] For each of the five instrumented mutations: assert an `audit_log`
      `INSERT` is recorded with the correct `action`/`actor_id`/`target`
      (mock-DB binding assertion, same style used for the visibility-toggle
      ownership test in `public-profile-plan.md`).
- [ ] `GET /api/admin/audit-log`: rejects non-admins, returns newest-first,
      respects pagination params.
- [ ] Confirm (by inspection of the route table, not a test) that no
      PATCH/DELETE route exists for `/api/admin/audit-log` — this is a
      structural guarantee, not something to unit test, but worth a comment
      in the test file pointing at this plan so a future PR doesn't add one
      without re-reading this decision.

### 5. Docs
- [ ] `README.md`: add `GET /api/admin/audit-log` to the API table.
- [ ] `CLAUDE.md`: worth a short paragraph — "mutations logged here: role
      change, user delete, announcement CRUD, room delete; the log itself is
      append-only by design, no edit/delete route should ever be added" — this
      is exactly the kind of invariant `CLAUDE.md` exists to protect against
      a future well-intentioned "let's add a delete button" regression.

### 6. Deploy
- [ ] Remote migration **before** push.
- [ ] Verify: change a user's role, delete an announcement, delete a room —
      confirm all three appear in the audit log with correct before/after
      detail; confirm a non-admin gets 403 on the read endpoint.

---

## Suggested build order
1. Schema + migration + `logAudit()` helper.
2. Instrument the two `admin/users` mutations first (highest value, role
   change is the single most security-relevant action in the app).
3. Instrument announcements + room delete.
4. Read endpoint + `admin.html` UI last, once there's real data to display.

**Pairs naturally with [[plan-question-bank]]** as the two schema-touching
plans in this admin/instructor batch — consider migrating both new tables in
the same D1 session to reduce round-trips, but keep them as separate PRs.
