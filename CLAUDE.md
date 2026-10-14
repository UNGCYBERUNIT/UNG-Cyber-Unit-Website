# CyberUnit @ UNG — working notes

Interactive cybersecurity education site on **Cloudflare Workers + D1**. The
only entry point `wrangler.toml`'s `main` points at is still **`worker.js`**
at the repo root, but as of 2026-10-07 it's a thin ~340-line dispatcher —
`fetch()`/`scheduled()` plus a re-export block so unit-test imports keep
resolving. All actual implementation (every route handler, shared helpers,
content data) lives under **`src/`**:

- `src/lib/*.js` — cross-cutting helpers every domain can depend on, never
  each other's siblings' domain logic: `http.js` (jsonResponse,
  addSecurityHeaders, notFoundResponse, parseCookies, clientIP,
  timingSafeEqual, base64ImageMatchesType), `render.js` (re-exports
  escapeHtml/renderContent/getTopicSVG from `public/js/topic-render.js` —
  the one place anything under `src/` reaches into `public/js`), `auth.js`
  (password hashing, JWT sign/verify, session/role helpers,
  authActionPageResponse, checkBotSecret), `lab-auth.js` (the Web
  Exploitation Lab's intentionally-forgeable tokens — kept isolated from
  `auth.js` on purpose, see that section below), `ratelimit.js` (all six
  check/record rate-limit pairs), `email.js` (sendResendEmail), `audit.js`
  (logAudit), `util.js` (date/streak math, room codes, CSV/JSON question
  parsing, leaderboardRank).
- `src/data/topics.js` / `src/data/challenges.js` — the `topics[]` /
  `ctfModules[]` content arrays plus their render helpers (topicCard,
  homeTopicCards, pathwayHtml, challengeCard, etc.).
- `src/routes/*.js` — one file per API/page domain (auth, profile, discord,
  users, admin, announcements, events, feedback, rooms, question-bank,
  instructor, topics, challenges, web-exploitation, seo, pages). Each
  exports a single `handleXRoutes(request, env, url, path, secureCookie)`
  that returns a `Response` on a match or `null` to fall through to the
  next domain — `worker.js`'s `fetch()` is just these calls in sequence,
  in the same precedence order the routes always had.

There is no bundler/build step — Cloudflare Workers support native
multi-file ES modules, so `npx wrangler dev`/`wrangler deploy` read this
multi-file tree directly against `./public`, same as they read a single
file. See README.md's "Project Structure" section for the full map.

*(An earlier `server.js` Express prototype — static topic pages only, no
auth/D1/Quiz Rooms — was removed on 2026-07-30 once it no longer reflected
the app in any meaningful way. If you see references to it in old commits or
docs, it's gone; don't recreate it.)*

## Deployment
- **Pushing to `main` auto-deploys** via GitHub Actions (`wrangler deploy`). There is
  no separate deploy step — a push *is* a deploy.
- **Schema changes must be migrated on the remote D1 *before* the deploy lands**, or
  the worker will query a column/table that doesn't exist in prod and error. Apply to
  both local and remote:
  - `npx wrangler d1 execute DB --local  --command "<ALTER/CREATE ...>"`
  - `npx wrangler d1 execute DB --remote --command "<ALTER/CREATE ...>"`

## Gotchas when adding things

**Adding a new HTML page (`public/*.html`):**
- Cloudflare serves matching static files *before* the worker, so they bypass the
  worker's security headers (CSP, `X-Frame-Options`, `nosniff`). **Add the page's
  route to `run_worker_first` in `wrangler.toml`** so it gets those headers. Do NOT
  add CSS/JS/image paths there — routing assets through the worker breaks their MIME
  type. Pages only.
- **Never write inline `<script>` blocks.** The CSP `script-src` is `'self'` only (no
  hash/nonce/unsafe-inline), so inline scripts are blocked. Put all JS in a
  `public/js/*.js` file and load it with `<script src="/js/…">` — same-origin scripts
  are allowed automatically and need no CSP changes ever.
- If the page needs `main.js`, load it as `<script type="module" src="/js/main.js">`
  (not a classic script) — `main.js` imports `public/js/topic-render.js`, which needs
  module semantics. `about.js`/`start.js` stay classic scripts; they don't import
  anything.
- If it should rank in search: **add its path to the sitemap** (the `paths` array in
  the `/sitemap.xml` route in `src/routes/seo.js`) and give it a unique `<title>` +
  `<meta name="description">`.
- If it's a private/app page (auth-gated): add `<meta name="robots" content="noindex">`
  and do NOT list it in the sitemap.

**Adding a topic:** add it to the `topics` array in `src/data/topics.js`. The sitemap, the
per-topic `<title>`/description/OG/`BreadcrumbList`, and the homepage grid all derive
from that array automatically. Two things that do NOT auto-update:
- **The Beginner Pathway** (`/start`): a new topic won't appear until you add its id to a
  stage's `topicIds` in the `pathwayStages` array.
- **Topic hook/takeaway**: add an entry in the `topicFraming` map (keyed by topic id) so
  the topic page gets its mentor intro + key takeaway.
- **Cheat-sheet PDF** (optional): the "Download Cheat-Sheet" button on `/topic/:id` only
  shows for topic ids in the `topicsWithCheatSheet` set in `src/data/topics.js`. Drop the PDF at
  `public/cheatsheets/<id>.pdf` and add the id to that set — no other code changes needed,
  it's served at `/cheatsheet/:id` following the same pattern as `/sop`.

**Homepage topic grid** and the **`/start` pathway** are server-rendered by the worker
(`homeTopicCards()`/`topicCard()` in `src/data/topics.js`, called from `src/routes/pages.js`
on `path === '/'`; `pathwayHtml()` likewise on `path === '/start'`) so crawlers see the
content without JS. `main.js`/`start.js` then enhance with per-user progress and leave the
server-rendered cards intact if that fetch fails — the client re-fetches via `/api/topics`
rather than needing its own copy of `topicCard()`. **`/topic/:id` lesson content is also
server-rendered**, via `renderContent()` + its 16 `render*` helpers + `getTopicSVG()` — these
live in `public/js/topic-render.js`, a small dependency-free ES module with no DOM/browser API
calls, imported by both `src/lib/render.js` (the one crossing point from `src/` into
`public/js/`, used server-side by `src/routes/pages.js` for crawlers/no-JS) and
`public/js/main.js` (client render, adds per-user progress). One source of truth — no
more hand-syncing two copies. (This split is *why* `public/js/main.js`'s `<script>` tag
needs `type="module"`: see the `<head>` of any `public/*.html` page.)

**Public/private profiles:** `users.is_public` (default `0`, opt-in) gates `/u/:username` **and**
inclusion in the `/members` directory (`GET /api/members`) — as of `docs/plan-member-directory.md`,
toggling it on means "viewable via your link and browsable in the directory," not just the
former. `GET /api/user/:username` is the strict field whitelist (username, avatar,
member-since, pathway badges, module/room rank, isStudent) and must **never** include
quiz-room history, per-topic quiz progress, role, id, the verified email address itself, or
any other field from `/api/profile`. `GET /api/members` reuses this exact whitelist for every
row — never a parallel "directory summary" shape, and it filters to `is_public = 1` at the
SQL level (never fetch-then-filter client-side). Unknown username or a guest account → `404`;
a real but private account → `403` (no data). The leaderboard links every username to
`/u/:username` regardless of visibility — the private/404 state is resolved when that page is
opened, not by hiding the link. `/members` is different: it's a browsable list gated to
`is_public = 1` users only, so it never links to a private profile in the first place.

**Web Exploitation Lab** (see `docs/plan-intermediate-track.md`): the "Breach the Portal" CTF
module's login endpoint (`POST /api/lab/web-exploitation/login` in `src/routes/web-exploitation.js`) is a **real, live
SQL injection vulnerability** — the query is built with raw string concatenation on purpose,
not a simulation. This is only safe because it runs against `env.WEBEXPLOIT_DB`, a **second,
physically separate D1 database** (its own `[[d1_databases]]` binding in `wrangler.toml`,
schema in `webexploit-schema.sql` at the repo root) containing nothing but synthetic fake
"employees" — never the real site's `cyber-unit-db`. This isolation is the entire safety
mechanism: even a full UNION-based extraction against this endpoint can only ever reach
made-up lab data, because the real `users` table isn't in the same database to UNION against.
**Never point this route (or any future intentionally-vulnerable lab) at `env.DB`, and never
merge `webexploit-schema.sql` into `schema.sql`.** If a future lab needs its own vulnerable
surface (XSS, IDOR, etc.), give it the same treatment: a dedicated D1 database if it touches
data at all, so a real exploit's blast radius is structurally capped at "fake lab data," not
"whatever else happens to share the database." The flag itself (`PORTALBREACHED2026`) follows
the same rule as every other challenge answer — lives only in `challenge_answers` on the main
`DB`, never in this file or the repo.

**Question Bank** (see `docs/plan-question-bank.md`): `question_bank`/`question_bank_items`
are reusable question templates, private per-instructor — same ownership pattern as Quiz
Rooms (`requireRole('instructor')` + `created_by === session.sub || admin`), no shared/
department bank. A saved template is a **snapshot, not a live reference** —
`question_bank_items` has no foreign key back to `quiz_room_questions`, and its rows are a
plain copy taken at `POST /api/rooms/:code/save-as-template` time. Don't "fix" this into a
live sync — the whole point is that a template survives the deletion of the room it was
originally saved from (often exactly why an instructor saves one, right before deleting a
throwaway room). `POST /api/rooms` accepts a `template_id` form field as an alternative to
the uploaded `file` field for question source.

**Admin audit log** (see `docs/plan-audit-log.md`): `logAudit()` in `src/lib/audit.js` writes an
append-only row to `audit_log` for the destructive/privilege-altering mutations in the app —
role change (`PATCH /api/admin/users/:id`), user delete (`DELETE /api/admin/users/:id`),
announcement create/edit/delete, room delete (`DELETE /api/rooms/:code`, instructor or admin),
and Kanban card delete (`DELETE /api/kanban/items/:id`, see the Kanban Board section below).
Everywhere it's called, the `logAudit()` statement rides in the *same* `env.DB.batch([...])`
as the mutation it logs, so the two commit atomically. Deliberately **not** logged: Kanban card
create/edit/move/assign — those are low-stakes and reversible, unlike a delete, and logging
them would turn `audit_log` into a general activity feed (a different feature with a different
retention/volume shape), not the "who did the irreversible thing" record it's meant to be.
**No PATCH/DELETE route for `audit_log` should ever be added** — not even a "clear log" admin
button — that would defeat the feature's purpose; treat adding one as a deliberate,
separately-reviewed decision, not a routine change. `audit_log.actor_id` has **no FOREIGN KEY**
(schema.sql) — deliberately, not an oversight: the log must survive the actor's own account
being deleted, which is why `actor_name` is a denormalized snapshot captured at insert time, not
a join. A FK was there originally and silently blocked `DELETE /api/admin/users/:id` for any
user who'd ever performed a single audited action — caught and fixed by recreating the table
without it (SQLite has no `ALTER TABLE ... DROP CONSTRAINT`, so this is a create-new/copy/drop/
rename, same pattern as any other FK-removal migration on this app).

**Deleting a user account** (`DELETE /api/admin/users/:id`): cascades the account's own private
data (`user_emails`, quiz/challenge history) but **blocks with a specific error** — rather than
failing opaquely on a raw FK constraint — if the account still owns shared/instructor-managed
content as *creator* (`quiz_rooms`/`announcements`/`events`/`question_bank`/`kanban_items`, all
NOT NULL `created_by` columns). That content is deliberately not auto-deleted or reassigned: a
Quiz Room or Kanban card isn't "owned" by its creator the way a linked email is (CLAUDE.md's
Kanban section — no per-creator ownership model), so silently destroying it because the creating
account got deleted would be a worse surprise than asking the admin to reassign/delete it first.
Being the **assignee** of a Kanban card is different — `kanban_items.assigned_to` is nullable
(unlike every `created_by` column here), so it's not checked as a blocker at all; the cascade
just sets it back to `NULL` on every card assigned to the deleted account, same as unassignment
through the normal edit API. `audit_log` is correctly excluded from this check (see above) —
it's the one "owned by" table that's supposed to outlive the user.

**Kanban Board** (see `docs/plan-kanban-board.md`): a Jira replacement — the club only ever
used Jira's Kanban board feature, not its other modules, so `src/routes/kanban.js` reimplements
just that against a new `kanban_items` table. Instructor+-gated for **both** read and write
(`requireRole(request, env, 'instructor')` once, same pattern as
`src/routes/instructor.js`) — regular members never see this page at all, unlike
Announcements/Events' public-read model. Any instructor/admin can edit/move/delete any card —
shared-content ownership, no per-creator check, same trust model as Announcements, not Quiz
Rooms. One shared board, fixed status (`idea`/`todo`/`in_progress`/`in_review`/`archived`) and
priority (`lowest`/`low`/`medium`/`high`/`highest`) enums — no Jira-style custom workflows.
`archived` is deliberately not a board column — it's a terminal/historical state, not a
workflow step, reached by setting a card's status to Archived in the edit form (there's no
drag target for it). It lives in its own `#kanbanArchived` tab, hidden until the "Archived"
view-toggle button is clicked, same pattern as the Calendar tab — rendered as a flat,
non-draggable card list (`cardHtml(item, { draggable: false })`), not another set of columns.
`parent_id` gives one level of subtask nesting only (rendered as a checklist on the parent
card, not its own column card). **Assignees are restricted to instructor+ accounts** — `GET
/api/kanban/users` (the picker list) and the CSV import's username resolution both filter to
`role IN ('instructor', 'admin')`, and `POST`/`PATCH /api/kanban/items` independently re-check
a new `assigned_to`'s role server-side (`assigneeIsInstructorPlus()`) rather than trusting the
picker dropdown — a direct API call can't assign a member/student/guest id that was never
offered in the UI. An already-assigned user whose role later drops below instructor isn't
retroactively unassigned or re-validated on unrelated edits to that card — the check only
runs when `assigned_to` is actually changing. **Assignment notifications are email-only** — reuses
`sendResendEmail()` exactly like `verify-email`/`forgot-password` do, silently no-ops if the
assignee has no verified `users.email` or `RESEND_API_KEY` isn't set. There is **no real push-
notification infrastructure in this app** (no service worker, no VAPID keys) — don't add one
casually for this or any future feature; it's a meaningfully bigger lift than it looks (new
service worker, subscription lifecycle, payload encryption) and wasn't what "push notification"
turned out to mean here. **Due-date reminder emails** (`sendKanbanDueDateReminders()` in
`src/routes/kanban.js`, called from `worker.js`'s existing hourly `scheduled()` cron) are a
separate notification from the assignment email above — one-shot per card, tracked by
`kanban_items.due_reminder_sent_at` (schema.sql): a card's assignee gets exactly one reminder
once its `due_date` falls within 24h (including cards already overdue, so a cron outage or a
newly-added due date on an old card still gets caught), and never a second one for that same
due date. The PATCH handler resets `due_reminder_sent_at` back to `NULL` whenever `due_date` or
`assigned_to` actually changes, so a pushed-out deadline or a reassignment is eligible for a
fresh reminder rather than being treated as already handled. Same `RESEND_API_KEY`/verified-
email guard as the assignment notification; no per-row emails fire from CSV import for the same
mail-bomb reason. The due-date calendar view on `/kanban` reads the same
already-fetched item list client-side — it is **not** synced with the public `/events` table;
those are different audiences (internal planning deadline vs. club-wide event), and auto-
syncing them would violate the "snapshot, not live reference" principle used elsewhere in this
app (see Question Bank below). **CSV import** (`POST /api/kanban/import`, same instructor+
gate, same multipart/1MB-cap pattern as the Quiz Room question-file upload) bulk-creates cards
— every row goes through the exact same `validateItemFields()` the manual create/edit API uses
(200/5000-char caps, strict status/priority/item_type enum whitelist, due-date parse check), so
a hostile or malformed CSV can't smuggle in anything the manual form couldn't; all DB writes are
parameterized `bind()`s (never string-built SQL) and card text is HTML-escaped again
client-side on render, so CSV cell content is never treated as safe-to-render just because it
passed server validation. The whole import is all-or-nothing — one bad row rejects the entire
file before anything is written, rather than leaving a half-imported board. `assignee` resolves
by username (case-insensitive); `parent` resolves by exact title match against the rest of the
file first, then the existing board — either one failing to resolve is reported back, not
treated as an import failure (the row still imports). No per-row assignment emails fire on
import (a large CSV would otherwise mail-bomb the club) — only a manually created/edited card
notifies its assignee. **CSV export** is the inverse — client-side only (built from the already-
fetched `items`/`users` state in `initKanbanPage()`, no new API route), same 8-column shape the
importer expects, resolving `assigned_to`/`parent_id` back to username/title the same way the
importer resolves them forward, so an exported file re-imports unchanged. It's a full-board
backup tool, not a "download my current view" one — it always exports every item regardless of
the active search/filter/sort state. Reuses the exact formula-injection guard (leading `=`/`+`/
`-`/`@` gets a defusing leading apostrophe) the Quiz Room results CSV export already uses.

**Search/filter/sort** (client-side only, `public/js/main.js`'s `initKanbanPage()`): `isVisible()`
(text search, with the "surface the parent if a subtask matches" exception noted above),
`passesFilters()` (Priority/Type/Assignee, applied directly per item — no subtask-surfacing
exception, since filtering by a property shouldn't show a card whose *own* priority/type/
assignee doesn't match), and `sortItems()` (Manual/Recently Modified/Priority/A-Z/Z-A) all read
shared state (`searchQuery`/`activeFilters`/`sortMode`) that the Board, Calendar, and Archived
views each independently re-derive from on every render — there is no cached "filtered list"
anywhere. **Any handler that changes one of these three pieces of state must re-render all
three views** (`renderBoard()` + `renderCalendar()` + `renderArchived()`), even if only one view
is currently visible — the others still need to reflect the new state whenever the user switches
tabs, and a missed call here is an easy silent bug (this already happened once: the original
search/filter handlers were written before the Archived tab existed and only re-rendered
Board + Calendar). Outside `sortMode === 'manual'`, the drag-and-drop drop handler skips
computing/persisting a `sort_order` entirely — the visible order is fully determined by
`sortItems()` regardless of `sort_order`, so a drop only PATCHes the dragged card's `status`
(and is a no-op if dropped back in its own column, since nothing changed).

**Discord account pairing** (see `docs/plan-discord-pairing.md`): `users.discord_id` /
`discord_username` / `discord_linked_at`, linked via a real Discord OAuth (`identify` scope)
flow at `/api/discord/link/start` → `/api/discord/callback` → `/api/discord/unlink` — not a
linking-code trick, since we control both this codebase and the bot's. The OAuth `state`
param is a short-lived signed JWT (reusing `signJWT`/`verifyJWT`, not a new signing
mechanism) binding the callback to the session that started it — standard CSRF protection.
Discord link status is **owner-only** (unlike the profile visibility toggle above) — it is
never added to `/api/user/:username`'s whitelist. `/api/bot/progress/:discordId` and
`/api/bot/pathfinder-status` are a **second** whitelist-disciplined public-ish surface for
the Discord bot (gated by `checkBotSecret`/`X-Bot-Secret`, not a browser session) — hold
them to the exact same "never leak more than the whitelist" bar as `/api/user/:username`.
`idx_users_discord_id` is a partial unique index (same shape as `idx_users_email`) — a
Discord account can only ever be linked to one website account.

**Email verification (general-purpose, role-decoupled, multi-email):** any signed-in non-guest
member can link up to `MAX_EMAILS_PER_USER` (3, `src/routes/auth.js`) email addresses on their
account via `/api/auth/verify-email/request` + `/api/auth/verify-email/confirm` — no domain
restriction, and confirming does **not** grant any role by itself. Each address is its own row
in `user_emails` (schema.sql) — `email` set once verified, `pending_email` while awaiting
confirmation — rather than a single `users.email` column, so an account can have several
verified addresses at once (e.g. personal + school), each independently addable/removable via
`DELETE /api/auth/emails/:id` (ownership-checked, no re-auth prompt, same as every other
self-service profile mutation). "Replace an address" is remove-then-add from the client, not a
separate endpoint. Re-requesting an address that's already pending on the *same* account
reuses that row (treated as a resend, respecting its cooldown) rather than consuming a new
slot — only a genuinely new address counts against the cap. `GET /api/profile` returns the
full `emails: [{id, email, pendingEmail}]` array; the profile page (`public/profile.html`'s
"Linked Emails" section, `renderEmailVerification()` in `public/js/main.js`) renders one row
per slot plus an add-another form while under the cap. Anything that needs "the" email for a
given account — Kanban's assignment/due-date-reminder notifications
(`src/routes/kanban.js`) — sends to **every** verified address on file, not a designated
"primary", since there's nothing to pick: `Resend`'s `to` field accepts an array.
`forgot-password`/`forgot-username` are unaffected in spirit — both still look up by whichever
address the requester types in (now via a `user_emails` JOIN instead of `users.email`) — proving
you know *an* email linked to the account has always been the actual security property, not
"the" email. It's purely an identity/recovery marker (also backing forgot-password/
forgot-username below). `users.role` still has a `'student'` tier (ranked
above `member`, below `instructor` in `ROLE_RANK`, gates Quiz Rooms with
`visibility='student'` and `/student-hub`) but it's **admin-assigned only**
(`PATCH /api/admin/users/:id`) — there's currently no automatic path to it.
`users.is_ung_student` is a dormant column, unreferenced by any code, reserved for a future
UNG-specific feature that hasn't been designed yet — don't wire it back up without checking
with the user first, it was deliberately decoupled.

Role lives in the session JWT, not re-checked against the DB per request —
`refreshRoleIfStale()` in `src/lib/auth.js` reissues the cookie from `/api/auth/me` and
`/api/profile` (both already polled on every page load) whenever the DB role has moved past
the cookie's (e.g. after an admin promotes someone), so the browser doesn't need a
log-out/in to pick it up.

**Session revocation (`token_version`):** this reverses the statement just above — sessions
are no longer *purely* stateless. `users.token_version` (schema.sql) is embedded in every
issued session JWT as the `ver` claim, and `getSession()` in `src/lib/auth.js` now does one extra D1
read per authenticated request — `SELECT token_version FROM users WHERE id = ?` — comparing
it against the token's `ver` before accepting the session; a mismatch (or a missing user row)
rejects the token outright, even though its signature and expiry are still valid. This closes
the "session stealing" gap a stateless JWT can't otherwise close: HttpOnly/SameSite=Strict/
Secure cookie flags stop *remote* theft (XSS, network sniffing), but none of them can stop
*replay* of a raw cookie value that was somehow already copied out (shared computer, a
screen-shared terminal, etc.) — a stolen cookie used to stay valid until its natural 7-day
expiry no matter what. Two things bump `token_version`, invalidating every other outstanding
token for that account immediately: `POST /api/auth/reset-password` (the whole point of a
reset is "someone else may have access") and the self-service `POST
/api/auth/sign-out-everywhere` (bumps and also clears the calling browser's own cookie, since
there's no way to tell which outstanding token is the stolen copy and which is legitimate).
Every other `signJWT()` call site (register, login, guest, upgrade, `refreshRoleIfStale`) sets
`ver` to the row's current `token_version` (or `0` for a brand-new row) — never a bump. The
column defaults to `0` and pre-migration JWTs have no `ver` claim at all, so `payload.ver ?? 0`
naturally matches the default for every already-logged-in user — the migration itself doesn't
force a mass logout. `getSession()` fails closed (`null`) when `env.DB` is unset, same as
every other DB-dependent auth path in this app. The accepted trade-off is one extra D1 read
per authenticated request in exchange for actual revocation capability — deliberately chosen
over the cheaper "do nothing, let stolen cookies expire naturally" and "short-lived-JWT +
refresh-token" alternatives.

**GET-renders/POST-mutates for emailed links:** any single-use link clicked directly out of
an email (`/api/auth/verify-email/confirm`, `/api/auth/reset-password`) must **never mutate
state on `GET`** — only render a page with a plain `<form method="POST">` (no JS, so no CSP
concerns). University-grade mail security gateways commonly pre-fetch every link in an
inbound email automatically before a human opens it; a mutating `GET` lets that automated
crawler silently burn the real user's token. `authActionPageResponse()` in `src/lib/auth.js` is the
shared page-builder for these — follow this pattern for any future emailed action link.

Verification/reset/reminder emails send via the Resend HTTP API (`sendResendEmail()` in
`src/lib/email.js`, plain `fetch()`, no binding) rather than Cloudflare's own Email Sending — that's a
paid product; Resend's free tier covers this app's volume. Needs the `RESEND_API_KEY` secret
set (`wrangler secret put RESEND_API_KEY`) and `ungcyberunit.org` verified with Resend, or
the send is silently skipped (the `if (env.RESEND_API_KEY)` guard) so local dev without the
secret still works — `verify-email/request` and `forgot-username` degrade to a no-op send;
`sendResendEmail()`'s `from` defaults to `noreply@ungcyberunit.org` but can be overridden per
call (no DNS changes needed — it's the same verified domain, just a different local part); the
Kanban notifications (`KANBAN_FROM` in `src/routes/kanban.js`) use `kanban@ungcyberunit.org`
instead, since a `noreply@` local part is itself a spam-score signal some mail gateways weight
heavily (university O365/Defender tenants especially), independent of SPF/DKIM passing — this
was confirmed with a live UNG O365/Proofpoint inbox: a `kanban@` send arrived clean
(`spamscore=0`, Microsoft `SCL:1`) and was actually seen, while `noreply@` verify-email sends
to the same inbox around the same time were never found, in Junk or otherwise. `verify-email/
request` sends from `email-verification@ungcyberunit.org` and `forgot-password`/
`forgot-username` both send from `account-recovery@ungcyberunit.org`, for the same reason.
`forgot-password` still stores the token either way, just doesn't email the link.

**Private files that must never touch the repo (this GitHub repo is public):** any
instructor-only asset (e.g. a challenge answer key) must NOT go in `public/` — a static asset
is visible in the repo's file tree/history to anyone, even if no page links to it. Instead
store it as a BLOB in D1 (see the `challenge_answer_keys` table in `schema.sql`) and serve it
from a dedicated `/api/...` route gated by `requireRole(request, env, 'instructor')`, e.g.
`GET /api/challenges/:id/answer-key` in `src/routes/challenges.js`. To ingest a file: hex-encode it and
`INSERT ... VALUES (..., X'<hex>', ...)` via `wrangler d1 execute DB --local/--remote --file`
(a `--command` string is impractical past a few KB). **Gotcha:** D1 hands back a BLOB column
as a plain byte array, not an ArrayBuffer — wrap it in `new Uint8Array(row.data)` before
passing to `Response()`, or it silently stringifies to `"37,80,68,70,..."` instead of sending
real bytes (caught in code review — Content-Length was ~3.5x the real file size). Keep the
source file itself out of the repo entirely (gitignored), since it's now living in D1.

**Same rule applies to short "answer" strings, not just whole files** (see
`/log-analysis-challenge` and `/network-traffic-challenge`'s auto-graded submission forms,
`POST /api/challenges/:id/submit` in `src/routes/challenges.js`): a correct-answer IP, count, or password is
low-entropy enough that even a SHA-256 hash of it, sitting in the public repo, is crackable
offline in seconds with a wordlist/mask attack — hashing doesn't save you here the way it
does for real passwords. Store the accepted normalized answer(s) as **plaintext** rows in D1
(`challenge_answers` — `challenge_id, part_id, answer_norm`, multiple rows per part for
alternate phrasings) instead, compared server-side via `normalizeAnswer()`; never put the
correct value in any `src/` file or any client-visible response. Completion state lives in
`challenge_completions` (`user_id, challenge_id, part_id`), and wrong submissions are rate
limited per-user (`challenge_submit_rate_limit`, 15/10min) the same way `room_lookup_failures`
throttles room-code guessing.

## Verify before committing
Run `npx wrangler dev` and actually exercise the change (repo pattern: drive it in
headless Chrome via puppeteer-core). For DB-touching work, seed and clean rows with
`wrangler d1 execute DB --local`, and delete any test users/rows afterward.
