# Plan: Kanban Board (Jira Replacement)

**Goal:** replace the club's paid Jira seat with an in-site Kanban board —
instructor+ can view, create, and edit work items (cards), drag them across
status columns, assign them to a member, see due dates on a calendar, and
have the assignee notified. `Jira.csv` (139 rows exported from the "KAN"
project) is the seed data and the reference for what fields actually get
used in practice.

**Status:** **Shipped — live at `/kanban` (2026-10-12).** Built and deployed
beyond the original checklist below: CSV import (`POST /api/kanban/import`,
with a format guide), search, a Priority/Type/Assignee filter menu, a
Manual/Recently Modified/Priority/A-Z/Z-A sort (applied to both the board
and the archived list), assignees restricted to instructor+ accounts,
click-to-prefill (column header → status, empty calendar day → due date),
Esc-to-discard on the create/edit modal, a subtasks list inside a parent
card's edit modal, and — a mid-flight design change from the original
`done` column below — `done` was renamed to `archived` and pulled out of
the board entirely into its own hidden-until-selected Archived tab (a flat
list, not a column), since a working board shouldn't have to keep every
finished card visible forever. The real Jira backlog (139 rows) was
formatted to the CSV shape the in-app format guide documents, dry-run
verified against a local copy through the real `/api/kanban/import`
endpoint, then loaded onto production directly via `wrangler d1 execute`
(no instructor credentials were available to run the actual upload
through the UI) — every row still went through the exact same validation/
transform logic as the endpoint, just not the HTTP call itself. Also
superseded by a later Chunk 0-style decision made mid-build rather than
up front: "assign every item to me" meant the literal `assigned_to` field
on every card, not just `created_by` — see the CSV import's assignee
column in the data that landed.

**Scope relative to the other social/collab plans:** bigger than
[[plan-events-page]] (new multi-table domain, not a clone of an existing
one), comparable to [[plan-team-rooms]] in lift, but the risk is concentrated
in two open questions rather than spread across many small ones — see Chunk
0. Unlike [[plan-member-directory]], there's no public-privacy angle at all;
this is a fully internal, instructor+-gated tool, closer in trust model to
[[plan-audit-log]] or [[plan-instructor-analytics]] than to any
member-facing feature.

---

## What the Jira export actually tells us

`python3 -I` over `Jira.csv` (139 rows, 54 columns — most columns are empty
Jira cruft: `Σ Original Estimate`, `Security Level`, `Custom field
(Development)`, etc.):

| Field | Observed values |
|---|---|
| Issue Type | Subtask (62), Task (37), Story (25), Asset (9), Epic (5), Feature (1) |
| Status | Done (44), Idea (37), To Do (31), In Progress (18), In Review (9) |
| Status category | To Do (37), In Progress (58), Done (44) — this is Jira's 3-bucket rollup of the 5 statuses above |
| Priority | Medium (109), High (15), Highest (6), Low (4), Lowest (4) |
| Assignee | 11 distinct people, 26 rows unassigned |

Columns worth carrying over: `Summary` (title), `Description`, `Assignee`,
`Priority`, `Status`, `Due date`, `Created`/`Updated`, `Parent`/`Parent key`
(subtask → parent task link), `Custom field (Rank)` (manual drag order within
a column — Jira's `0|i0002f:` style lexo-rank string). Everything else
(`Watchers`, `Time Spent`, `Σ` estimate fields, `Security Level`, `Team
Id`/`Team Name`, `Custom field (Vulnerability)`) is empty or Jira-internal
plumbing with no analog needed here.

**Status category confirms the 3-column board is the real mental model** —
"Idea" reads as a backlog sub-state of To Do, not a 6th column. Recommend
shipping 4 columns (**Idea → To Do → In Progress → Done**, folding "In
Review" into "In Progress" or keeping it as a 5th — see Chunk 0) rather than
reproducing Jira's exact 5-status list, which existed partly to fit Jira's
own workflow UI, not because this club's process needs 5 distinct states.

---

## Chunk 0 — DECISIONS (need your input before building)

- [x] **Decided: instructor+ only, both read and write.** No member-visible
      board in v1. You said "anyone
      with Instructor or higher access to view, create, or edit" — reading
      literally, that's view-and-write both gated at instructor+, i.e.
      regular members never see the board at all (it replaces an internal
      Jira seat, not a public roadmap). **Recommend instructor+ for both
      read and write** — simplest gate (`requireRole(request, env,
      'instructor')` once, matching `src/routes/instructor.js`'s exact
      pattern), and avoids a second, member-visible board becoming
      aspirational/stale "nice-to-haves we never did" exposed to the people
      you'd least want seeing an incomplete backlog. Flag if you actually
      want member read-only — that's a different gate shape (split GET vs
      POST/PATCH/DELETE, like Announcements) and a different page (would
      need a `noindex` member nav link instead of being instructor/admin-nav
      only).
- [x] **Decided: email only.** This repo has **no existing push-notification infrastructure at all**
      (no service worker registration, no VAPID keys, no `Notification`/
      `PushManager` usage anywhere in `public/js/`). Building real browser
      push from scratch is a meaningfully bigger lift than everything else
      in this plan combined: a new service worker, VAPID key generation, a
      `push_subscriptions` table, per-browser subscribe/unsubscribe
      lifecycle, and a payload-encryption step on every send. **Recommend
      email-only for v1**, reusing `sendResendEmail()` (`src/lib/email.js`)
      exactly as `verify-email`/`forgot-password` already do — "linked
      email" in your message suggests you were already thinking of it as
      email, not literal OS-level push. A card assignment triggers one
      Resend email to the assignee's verified `users.email`. Real push can
      be a distinct future plan if email notifications turn out to be
      insufficient (people not noticing them, wanting a badge/sound, etc.)
      — don't conflate the two in one build.
- [ ] **What happens when the assignee has no verified email?** Per
      `CLAUDE.md`'s email-verification section, `users.email` is optional and
      member-set — an instructor could be assigned a card with no email on
      file yet. Recommend: assignment still succeeds, notification silently
      no-ops (same `if (env.RESEND_API_KEY)`-style guard pattern already used
      for degraded-send cases), and the card UI shows a small "no email on
      file" hint next to that assignee's name so the instructor assigning it
      knows the notification won't land. Don't block the assignment on it.
  - **Alternative worth naming:** since this app already has a real Discord
    bot integration (`users.discord_id`, `/api/bot/*` in
    `src/routes/discord.js`), a linked Discord account could receive a DM
    from the bot instead of/alongside email for members who've paired their
    account. That's a bot-side change (the bot would need a new "send DM"
    command triggered by a webhook from this app) — bigger than reusing
    Resend, so recommend treating it as a v2 enhancement, not part of this
    build, and flagging it here only so it's not lost.
- [ ] **Column set:** 4 columns (Idea, To Do, In Progress, Done) or 5
      (keep In Review distinct)? Status category data above shows "In
      Review" (9 rows) is a real, used state in Jira. Recommend keeping all
      5 as fixed columns rather than inventing a custom-columns feature —
      Jira-style arbitrary custom workflows is a lot of UI (column
      add/rename/reorder/delete, re-mapping cards when a column is deleted)
      for a club board that's used one specific way. Fixed columns, no
      custom-workflow builder, is the right scope here.
- [ ] **One board, or multiple (e.g. per-semester, or per-initiative)?**
      The Jira export is a single project (`KAN`). Recommend **one board**
      for v1 — adding a `boards` table with a picker now, for a feature with
      exactly one real board today, is speculative scope. If the unit later
      wants to separate e.g. "website dev" from "event planning" into two
      boards, that's a cheap additive migration (`board_id` column +
      picker) once there's an actual second board to justify it.
  - **Epics/Subtasks:** the export's `Parent`/`Parent key` columns show
        real two-level nesting (Epic → Task, and 62 Subtasks under tasks).
        Recommend v1 supports **one level of subtask nesting** (an item can
        have a `parent_id` pointing at another item on the same board,
        shown as a checklist/mini-list on the parent card — not its own
        card on the main board) rather than full Epic-as-a-swimlane. Full
        Epic swimlanes are a real Jira-specific concept that adds board
        layout complexity for not much club-planning value.
- [ ] **"Integrated calendar" — a new calendar view inside the board, or
      reuse the existing `/events` page/table?** These are different
      audiences: `events` (schema.sql, `docs/plan-events-page.md`) is
      member-facing club events (meetings, CTF comps, guest talks) with no
      assignee/status/priority concept. A Kanban item's due date is an
      internal planning deadline, not something to surface on the public
      events page. **Recommend a separate, board-scoped calendar view**
      (a month grid rendered client-side from the same `kanban_items` the
      board already fetches, filtering to rows with a `due_date` set) —
      not a new table, not a merge into `events`. If a specific item's due
      date is genuinely club-wide-relevant (e.g. "competition submission
      deadline"), the instructor can separately create a real `events` row
      for it; don't auto-sync the two, for the same "snapshot not live
      reference" reason `docs/plan-question-bank.md` gives for not
      syncing templates back to live rooms.
- [ ] **Audit log coverage?** `CLAUDE.md` currently documents audit logging
      as covering exactly five mutations (role change, user delete,
      announcement CRUD, room delete) and explicitly calls that scope
      deliberate. Adding Kanban item delete (the only truly destructive
      Kanban action — create/edit/move are low-stakes and reversible)
      would make it six. Recommend **do log item delete** — it's the same
      "destructive, no undo" shape as room delete — and update `CLAUDE.md`'s
      wording from "the five" to describe the actual set rather than hard-
      coding a number that's now wrong. Don't log create/edit/move/assign;
      that would turn `audit_log` into a general activity feed, which is a
      different feature (and a bigger one — see "Activity feed" below) with
      a different retention/volume shape.
- [x] **Decided (superseded): a real, always-available CSV import, not a
      disposable one-time script.** `POST /api/kanban/import` on the board
      itself (see the implementation checklist below) rather than a
      `wrangler d1 execute --file` seeding pass — it's general-purpose (any
      future bulk add, not just the one Jira migration), it's instructor-
      self-service (no engineer needed to run a script), and the validation
      it needs to exist anyway (status/priority/type enums, length caps)
      is identical either way. `assignee` resolves by `users.username`
      (case-insensitive, unmatched → unassigned, no placeholder accounts
      invented — this part of the original recommendation still holds).
      No live Jira API sync either way — Jira access is going away, which
      is the entire reason for this feature.

---

## Session learnings / project gotchas (READ FIRST)

- **This is a genuinely new domain, not a clone** — unlike Events (near-
  verbatim Announcements clone) or Team Rooms (extends existing Quiz Rooms),
  there's no existing "cards with a status and an assignee" pattern in this
  codebase to copy. Budget real design time for the data model and the
  drag-and-drop UI; don't assume this is a weekend port of an existing
  route.
- **No bundler, no new npm dependency for drag-and-drop.** This repo ships
  Cloudflare Workers' native multi-file ES modules with zero build step
  (see `CLAUDE.md`'s opening section) and the frontend is vanilla HTML/CSS/
  JS throughout (`README.md`'s tech-stack table). Pulling in a drag-and-drop
  library would be the first external frontend dependency in the project.
  **Recommend the native HTML5 Drag and Drop API** (`draggable="true"`,
  `dragstart`/`dragover`/`drop` handlers) in a new `public/js/kanban.js` —
  it's enough for single-column-reorder/move-between-columns, needs no
  dependency, and matches every other page's "plain JS, no framework"
  convention.
- **Auth gate to copy exactly** (pending the "who can view" decision above
  defaulting to instructor+ both ways):
  ```js
  if (path.startsWith('/api/kanban')) {
    if (!env.JWT_SECRET || !env.DB) return jsonResponse({ error: 'Server not configured' }, 503);
    const session = await requireRole(request, env, 'instructor');
    if (session instanceof Response) return session;
    ...
  }
  ```
  This is `src/routes/instructor.js`'s exact pattern — `requireRole(request,
  env, 'instructor')` already excludes `member`/`student`/`guest`
  (`ROLE_RANK` in `src/lib/auth.js`) and returns 401/403 for anyone below it.
- **Ownership model: shared, not per-creator.** Like Announcements (admin-
  wide) rather than Quiz Rooms (per-creator `created_by` check) — any
  instructor+ should be able to edit/move/assign any card, not just ones
  they created, because this is one shared club board, not personal content.
  Confirm this matches your mental model before building; it's the same
  design note `worker.js`'s old Announcements comment makes explicit.
- **Validation caps**: follow the existing convention exactly — title
  required, ≤200 chars (matches Announcements/Events); description optional,
  ≤5000 chars; reuse the `isNaN(new Date(...).getTime())` due-date validation
  Quiz Room's `expires_at` already uses.
- **New page needs `run_worker_first`.** Per `CLAUDE.md`'s "Adding a new
  HTML page" section, `/kanban` (or whatever path you pick) must be added to
  `run_worker_first` in `wrangler.toml` or it skips the worker's CSP/
  security headers — it's a page route, not an asset path, so it belongs in
  that list alongside `/admin`, `/instructor`, etc.
- **`noindex`, no sitemap entry.** This is an internal tool behind an
  instructor+ gate, same treatment as `/admin`/`/instructor` — `<meta
  name="robots" content="noindex">`, not listed in `src/routes/seo.js`'s
  sitemap `paths` array.
- **No inline `<script>`** — CSP `script-src` is `'self'`-only with no
  nonce/hash (`CLAUDE.md`). All board/drag-drop/calendar JS goes in
  `public/js/kanban.js`, loaded via `<script src="/js/kanban.js">`.
- **Where this likely belongs in the nav**: instructor/admin-only tools
  currently surface via the `/admin` and `/instructor` pages themselves
  rather than the main hamburger nav (member-facing links live there instead
  — Announcements, Events, Feedback, Contact). Recommend a link from
  `/instructor` into `/kanban`, not a new top-level nav item every member
  sees and can't use.

---

## Implementation checklist (for the follow-up build pass)

### 1. Data model + migration
- [ ] `schema.sql`: new tables, something like:
  ```sql
  CREATE TABLE IF NOT EXISTS kanban_items (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    title        TEXT    NOT NULL,
    description  TEXT    NOT NULL DEFAULT '',
    item_type    TEXT    NOT NULL DEFAULT 'task',   -- 'task' | 'story' | 'subtask' | 'epic'
    status       TEXT    NOT NULL DEFAULT 'idea',    -- 'idea' | 'todo' | 'in_progress' | 'in_review' | 'archived'
    -- NOTE (post-launch change): 'done' was renamed to 'archived' and pulled
    -- out of the board's column set entirely — it now lives in its own
    -- hidden-until-selected "Archived" tab (a flat list, not a column),
    -- since a finished board tends to accumulate a lot of done cards that
    -- don't need to stay visible on the working board.
    priority     TEXT    NOT NULL DEFAULT 'medium',  -- 'lowest' | 'low' | 'medium' | 'high' | 'highest'
    sort_order   INTEGER NOT NULL DEFAULT 0,          -- position within its status column
    parent_id    INTEGER,                             -- one level of subtask nesting (pending Chunk 0)
    assigned_to  INTEGER,
    due_date     INTEGER,                              -- unix seconds, nullable
    created_by   INTEGER NOT NULL,
    created_at   INTEGER NOT NULL,
    updated_at   INTEGER,
    FOREIGN KEY (parent_id)    REFERENCES kanban_items(id),
    FOREIGN KEY (assigned_to)  REFERENCES users(id),
    FOREIGN KEY (created_by)   REFERENCES users(id)
  );
  CREATE INDEX IF NOT EXISTS idx_kanban_items_status ON kanban_items (status, sort_order);
  CREATE INDEX IF NOT EXISTS idx_kanban_items_due_date ON kanban_items (due_date);
  ```
  `sort_order` as a plain integer (not Jira's lexo-rank string) is enough
  for this scale — re-sequence the affected column on every move, same as
  any small drag-and-drop list; no need for the fractional-rank trick Jira
  uses to avoid O(n) renumbering at much larger scale.
- [ ] Migrate local + remote (schema change must land before the deploy
      that ships the route, per `CLAUDE.md`'s deployment rule).
- [ ] One-time seed pass from `Jira.csv` (Chunk 0) — write as a disposable
      script, not checked into `src/`, same "generate the migration, don't
      leave the import tool lying around" treatment as any other one-off
      data load in this repo.

### 2. Server (`src/routes/kanban.js`, new file)
- [ ] `GET /api/kanban/items` — instructor+, returns all items joined to
      assignee username/avatar, ordered by `status, sort_order`.
- [ ] `POST /api/kanban/items` — instructor+, creates a card (title required
      ≤200 chars, description ≤5000, due_date validated if present).
- [ ] `PATCH /api/kanban/items/:id` — instructor+, edits any field including
      `status`/`sort_order` (drag-and-drop move) and `assigned_to`
      (assignment — triggers the email notification here, pending Chunk 0).
- [ ] `DELETE /api/kanban/items/:id` — instructor+, logs to `audit_log`
      (`logAudit()`, same atomic-batch pattern as `rooms.js`'s delete).
- [ ] Notification send: on `assigned_to` changing to a non-null value
      different from its previous value, look up the new assignee's
      `users.email`; if set, `sendResendEmail()` with the card title/link;
      if not, no-op (Chunk 0). Don't block the PATCH response on the email
      send failing — fire it, swallow/log errors, same resilience posture
      `verify-email/request` already has around Resend failures.

### 3. Client
- [ ] New `public/kanban.html` — instructor/admin gated page,
      `noindex`, columns rendered as `<section>`s with card lists inside.
- [ ] New `public/js/kanban.js` (classic script, no `main.js` imports
      needed) — fetches `/api/kanban/items`, renders columns, HTML5
      drag-and-drop between columns (PATCH `status`+`sort_order` on drop),
      create/edit card modal, assignee picker (reuse whatever endpoint
      already lists users for the admin user-management page, if one
      exists — confirm during build rather than inventing a new one).
- [ ] Calendar view: a simple month-grid toggle within the same page,
      reading the same fetched item list client-side (Chunk 0) rather than
      a separate endpoint.
- [ ] Link from `/instructor` page into `/kanban`.

### 4. Tests (`test/`)
- [ ] `GET/POST/PATCH/DELETE /api/kanban/items`: instructor+-only (403 for
      member/student, 401 for unauthenticated), validation caps, 404 for
      unknown id.
- [ ] Assignment triggers a (mocked) Resend call; no-assignee-email case
      doesn't throw.
- [ ] Page-render test for `/kanban` (200, no leftover placeholders),
      `noindex` meta present.

### 5. Docs
- [ ] `README.md`: add `/kanban`, `/api/kanban/*` to the Routes table.
- [ ] `CLAUDE.md`: new short section describing the board (ownership model,
      fixed column set, notification mechanism) — same pattern as the
      existing Question Bank / Team Rooms sections — and the audit-log
      wording fix noted in Chunk 0.
- [ ] This file's `**Status:**` line flips to "shipped" once deployed.

### 6. Deploy
- [ ] Remote migration first (new tables) → seed import → commit/push →
      verify: instructor can create/move/assign/delete a card, assignee
      with a verified email receives the notification, member/guest get
      403/401 on every `/api/kanban/*` route and can't load `/kanban`.

---

## Explicitly out of scope for v1 (flag if any of these matter more than assumed)

- **Real browser push notifications** — no VAPID/service-worker
  infrastructure exists yet; this plan recommends email instead (Chunk 0).
- **Discord DM notifications** — possible given the existing bot
  integration, but it's a bot-side change, not just a web-app change;
  treat as a v2 idea, not part of this build.
- **Activity/comment feed on cards** — Jira's `Comment` column is empty
  across the entire export (not actually used by the club), so there's no
  real usage signal to justify building it now.
- **Custom/user-defined columns, swimlanes, multiple boards** — see Chunk 0;
  all would add real UI complexity for a one-board, fixed-workflow use case.
- **Time tracking / estimates** — every `Original estimate`/`Σ` column in
  the export is empty; the club never used this part of Jira either.

---

**Net assessment: yes, this is doable**, and it's a good trade — Jira's
Kanban board is a thin layer over "cards with a status, an assignee, a
priority, and a due date," which is a small, well-understood data model
next to the auth/role infrastructure this app already has. The real design
risk isn't the board itself; it's the two Chunk-0 questions that change the
shape of the build (view gating, and real-push-vs-email) — resolve those
first and the rest of this checklist is mechanical, following patterns
(`requireRole`, `logAudit`, `sendResendEmail`, the HTML5 DnD API) already
proven elsewhere in this codebase.
