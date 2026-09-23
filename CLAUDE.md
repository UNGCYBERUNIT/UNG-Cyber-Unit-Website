# CyberUnit @ UNG — working notes

Interactive cybersecurity education site on **Cloudflare Workers + D1**. The
only entry point is **`worker.js`** (routing, API, auth, security headers,
per-page SEO injection). There is no bundler/build step — `npx wrangler dev`
runs `worker.js` directly against `./public`.

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
  the `/sitemap.xml` route in `worker.js`) and give it a unique `<title>` +
  `<meta name="description">`.
- If it's a private/app page (auth-gated): add `<meta name="robots" content="noindex">`
  and do NOT list it in the sitemap.

**Adding a topic:** add it to the `topics` array in `worker.js`. The sitemap, the
per-topic `<title>`/description/OG/`BreadcrumbList`, and the homepage grid all derive
from that array automatically. Two things that do NOT auto-update:
- **The Beginner Pathway** (`/start`): a new topic won't appear until you add its id to a
  stage's `topicIds` in the `pathwayStages` array.
- **Topic hook/takeaway**: add an entry in the `topicFraming` map (keyed by topic id) so
  the topic page gets its mentor intro + key takeaway.
- **Cheat-sheet PDF** (optional): the "Download Cheat-Sheet" button on `/topic/:id` only
  shows for topic ids in the `topicsWithCheatSheet` set in `worker.js`. Drop the PDF at
  `public/cheatsheets/<id>.pdf` and add the id to that set — no other code changes needed,
  it's served at `/cheatsheet/:id` following the same pattern as `/sop`.

**Homepage topic grid** and the **`/start` pathway** are server-rendered by the worker
(`homeTopicCards()` on `path === '/'`, `pathwayHtml()` on `path === '/start'`) so crawlers
see the content without JS. `main.js`/`start.js` then enhance with per-user progress and
leave the server-rendered cards intact if that fetch fails. Both share the `topicCard()`
"module" component (worker-only — the client re-fetches via `/api/topics` rather than
needing its own copy). **`/topic/:id` lesson content is also server-rendered**, via
`renderContent()` + its 16 `render*` helpers + `getTopicSVG()` — these live in
`public/js/topic-render.js`, a small dependency-free ES module with no DOM/browser API
calls, imported by both `worker.js` (server render, for crawlers/no-JS) and
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

**Admin audit log** (see `docs/plan-audit-log.md`): `logAudit()` in worker.js writes an
append-only row to `audit_log` for the five destructive/privilege-altering mutations in the
app — role change (`PATCH /api/admin/users/:id`), user delete (`DELETE
/api/admin/users/:id`), announcement create/edit/delete, and room delete (`DELETE
/api/rooms/:code`, instructor or admin). Everywhere it's called, the `logAudit()` statement
rides in the *same* `env.DB.batch([...])` as the mutation it logs, so the two commit
atomically. **No PATCH/DELETE route for `audit_log` should ever be added** — not even a "clear
log" admin button — that would defeat the feature's purpose; treat adding one as a deliberate,
separately-reviewed decision, not a routine change.

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

**Email verification (general-purpose, role-decoupled):** any signed-in non-guest member can
confirm any email address on their account via `/api/auth/verify-email/request` +
`/api/auth/verify-email/confirm` (worker.js) — no domain restriction, and confirming does
**not** grant any role by itself. It's purely an identity/recovery marker (also backing
forgot-password/forgot-username below). `users.role` still has a `'student'` tier (ranked
above `member`, below `instructor` in `ROLE_RANK`, gates Quiz Rooms with
`visibility='student'` and `/student-hub`) but it's **admin-assigned only**
(`PATCH /api/admin/users/:id`) — there's currently no automatic path to it.
`users.is_ung_student` is a dormant column, unreferenced by any code, reserved for a future
UNG-specific feature that hasn't been designed yet — don't wire it back up without checking
with the user first, it was deliberately decoupled.

Role lives in the session JWT, not re-checked against the DB per request —
`refreshRoleIfStale()` in worker.js reissues the cookie from `/api/auth/me` and
`/api/profile` (both already polled on every page load) whenever the DB role has moved past
the cookie's (e.g. after an admin promotes someone), so the browser doesn't need a
log-out/in to pick it up.

**GET-renders/POST-mutates for emailed links:** any single-use link clicked directly out of
an email (`/api/auth/verify-email/confirm`, `/api/auth/reset-password`) must **never mutate
state on `GET`** — only render a page with a plain `<form method="POST">` (no JS, so no CSP
concerns). University-grade mail security gateways commonly pre-fetch every link in an
inbound email automatically before a human opens it; a mutating `GET` lets that automated
crawler silently burn the real user's token. `authActionPageResponse()` in worker.js is the
shared page-builder for these — follow this pattern for any future emailed action link.

Verification/reset/reminder emails send via the Resend HTTP API (`sendResendEmail()` in
worker.js, plain `fetch()`, no binding) rather than Cloudflare's own Email Sending — that's a
paid product; Resend's free tier covers this app's volume. Needs the `RESEND_API_KEY` secret
set (`wrangler secret put RESEND_API_KEY`) and `ungcyberunit.org` verified with Resend, or
the send is silently skipped (the `if (env.RESEND_API_KEY)` guard) so local dev without the
secret still works — `verify-email/request` and `forgot-username` degrade to a no-op send;
`forgot-password` still stores the token either way, just doesn't email the link.

**Private files that must never touch the repo (this GitHub repo is public):** any
instructor-only asset (e.g. a challenge answer key) must NOT go in `public/` — a static asset
is visible in the repo's file tree/history to anyone, even if no page links to it. Instead
store it as a BLOB in D1 (see the `challenge_answer_keys` table in `schema.sql`) and serve it
from a dedicated `/api/...` route gated by `requireRole(request, env, 'instructor')`, e.g.
`GET /api/challenges/:id/answer-key` in worker.js. To ingest a file: hex-encode it and
`INSERT ... VALUES (..., X'<hex>', ...)` via `wrangler d1 execute DB --local/--remote --file`
(a `--command` string is impractical past a few KB). **Gotcha:** D1 hands back a BLOB column
as a plain byte array, not an ArrayBuffer — wrap it in `new Uint8Array(row.data)` before
passing to `Response()`, or it silently stringifies to `"37,80,68,70,..."` instead of sending
real bytes (caught in code review — Content-Length was ~3.5x the real file size). Keep the
source file itself out of the repo entirely (gitignored), since it's now living in D1.

**Same rule applies to short "answer" strings, not just whole files** (see
`/log-analysis-challenge` and `/network-traffic-challenge`'s auto-graded submission forms,
`POST /api/challenges/:id/submit` in worker.js): a correct-answer IP, count, or password is
low-entropy enough that even a SHA-256 hash of it, sitting in the public repo, is crackable
offline in seconds with a wordlist/mask attack — hashing doesn't save you here the way it
does for real passwords. Store the accepted normalized answer(s) as **plaintext** rows in D1
(`challenge_answers` — `challenge_id, part_id, answer_norm`, multiple rows per part for
alternate phrasings) instead, compared server-side via `normalizeAnswer()`; never put the
correct value in worker.js or any client-visible response. Completion state lives in
`challenge_completions` (`user_id, challenge_id, part_id`), and wrong submissions are rate
limited per-user (`challenge_submit_rate_limit`, 15/10min) the same way `room_lookup_failures`
throttles room-code guessing.

## Verify before committing
Run `npx wrangler dev` and actually exercise the change (repo pattern: drive it in
headless Chrome via puppeteer-core). For DB-touching work, seed and clean rows with
`wrangler d1 execute DB --local`, and delete any test users/rows afterward.
