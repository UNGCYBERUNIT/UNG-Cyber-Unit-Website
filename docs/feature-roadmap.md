# Feature Roadmap — Proposed (Not Yet Implemented)

> **Note (2026-10-07):** `worker.js` was split into `src/lib/*.js`,
> `src/data/*.js`, and `src/routes/*.js` modules on this date (see
> `CLAUDE.md`'s opening section and README.md's "Project Structure"). Every
> `worker.js` line-number reference in the plan docs below predates that
> split and is now approximate/historical — the named functions still exist,
> just in a different file.

Ten feature plans across four tracks (content depth, instructor/admin
tooling, social/community, cross-repo integrations) — the first nine written
2026-08-03, the tenth ([[plan-discord-pairing]]) added 2026-09-17. Each has
its own doc with a full "Chunk 0 — DECISIONS" section that needs sign-off
before implementation starts — this page is just the index + relative
priority/complexity read, not a substitute for reading the plan before
building.

**[[plan-discord-pairing]] has since shipped** (merged 2026-09-17, see
`CLAUDE.md`'s "Discord account pairing" section), and as of 2026-09-23 so has
every "quick win" from the original sequencing: [[plan-difficulty-tags]],
[[plan-cheat-sheets]], [[plan-events-page]], [[plan-instructor-analytics]],
and [[plan-member-directory]] (moved up from "medium" once its privacy
question resolved — see the sequencing note below). [[plan-audit-log]]
followed the same day, first out of the "medium builds" batch, and
[[plan-question-bank]] followed it. All eight are left in the tables below
marked **Done** for historical context; [[plan-intermediate-track]] and
[[plan-team-rooms]] are the active roadmap.

**Neither remaining plan is scheduled or approved.** Treat every
"recommend" in the linked docs as a starting proposal, not a decision.

---

## Content depth

| Plan | Complexity | Depends on | Note |
|---|---|---|---|
| [[plan-difficulty-tags]] | Low | none | **Done (shipped 2026-09-23).** Fixed the **latent bug** — the grid card's 3 call sites hardcoded `badge-beginner` regardless of the topic's real difficulty — plus added the All/Beginner/Intermediate/Advanced filter chips. |
| [[plan-cheat-sheets]] | Low | none | **Done (shipped 2026-09-23).** `/cheatsheet/:id` delivery mechanism is live, following the `/sop` pattern. No PDFs authored yet — `topicsWithCheatSheet` is empty, so the button doesn't show anywhere until a real PDF is dropped in and its id added. |
| [[plan-intermediate-track]] | Medium | none | **Redirected 2026-09-23** — no longer a `topics[]`/quiz-lesson extension. Now a CTF-style challenge track (downloadable/manipulable artifact per module: crypto puzzle, steganography/forensics, password auditing), built on the *existing* `/log-analysis-challenge`/`/network-traffic-challenge` pattern generalized into a data-driven `ctfModules` system + a `/challenges` hub page, instead of hand-copying a bespoke HTML page per module. Zero schema change — the `challenge_*` tables are already fully generic. See the plan doc's Chunk 0 before building. |

## Instructor/admin tooling

| Plan | Complexity | Depends on | Note |
|---|---|---|---|
| [[plan-instructor-analytics]] | Low–Medium | none | **Done (shipped 2026-09-23).** `/api/rooms/:code/analytics` (per-question miss-rate) + `/api/instructor/topic-completion` (site-wide, not per-class — no roster concept exists). Zero schema change, as predicted. |
| [[plan-audit-log]] | Medium | none | **Done (shipped 2026-09-23).** `logAudit()` instruments all five destructive/privilege-altering mutations (role change, user delete, announcement CRUD, room delete), each riding in the same `env.DB.batch([...])` as the mutation it logs. `GET /api/admin/audit-log` is cursor-paginated. No PATCH/DELETE route for the table, enforced by simply not writing one. |
| [[plan-question-bank]] | Medium–High | none | **Done (shipped 2026-09-23).** Private-per-instructor templates (`question_bank` + `question_bank_items`), same ownership pattern as Quiz Rooms. `save-as-template` snapshots a room's questions (survives the room's deletion); `POST /api/rooms` accepts `template_id` as an alternative to a file upload. |

## Social/community

| Plan | Complexity | Depends on | Note |
|---|---|---|---|
| [[plan-events-page]] | Low | none | **Done (shipped 2026-09-23).** Near-verbatim clone of Announcements (same public-read/admin-write model, current post-"publicly viewable" behavior) plus `location` and `event_date` columns, split into Upcoming/Past client-side. Remote D1 migration applied before deploy. |
| [[plan-team-rooms]] | High | none | Biggest engineering lift here — a new `team` concept threads through join/attempt/results. Scoped as an opt-in `team_mode` flag per room so existing solo rooms/attempts are unaffected. |
| [[plan-member-directory]] | Low–Medium | none | **Done (shipped 2026-09-23).** `/members` + `GET /api/members`, reusing `/api/user/:username`'s exact field whitelist per row, filtered to `is_public = 1` at the SQL level. No schema change, as predicted. |

## Cross-repo integrations

| Plan | Complexity | Depends on | Note |
|---|---|---|---|
| [[plan-discord-pairing]] | Medium | none | **Done (shipped 2026-09-17).** The only plan here that touches a second repo (`cyber_discord_bot`). Real Discord OAuth (`identify` scope) links a website account to a Discord account — no scraping/code-pasting trick needed since we control both codebases, unlike that bot's pwn.college/HTB integrations. Two new trust boundaries this codebase hasn't had before: an OAuth `state`/CSRF flow, and a second whitelist-disciplined public-ish API surface (`/api/bot/*`) alongside `/api/user/:username`. |

---

## Suggested overall sequencing

1. ~~**Quick wins first** (all independent, all low-risk): [[plan-difficulty-tags]],
   [[plan-cheat-sheets]], [[plan-events-page]], [[plan-instructor-analytics]].~~
   **Done, shipped 2026-09-23** — [[plan-member-directory]] moved into this
   batch too once its privacy question resolved, and shipped alongside the
   other four the same day.
2. ~~**Medium builds**: [[plan-audit-log]], [[plan-question-bank]],
   [[plan-intermediate-track]] (content-authoring-bound, can run in parallel
   with the others since it touches different code).~~ [[plan-audit-log]] and
   [[plan-question-bank]] **done, shipped 2026-09-23** (both built same-day
   as follow-ons from the quick wins). [[plan-intermediate-track]] remains
   the one active "medium build" — redirected the same day from a quiz-lesson
   extension to a CTF challenge track (see its own doc); no longer purely
   content-authoring-bound, since the generic module system is genuinely new
   code, not just more of an existing pattern.
3. **Bigger swings**: [[plan-team-rooms]] (engineering-heavy, worth doing
   once the room-management basics above have shipped — [[plan-question-bank]]
   is now one of them).
4. ~~[[plan-discord-pairing]] stands apart from the sequencing above — it's
   the only plan touching a second repo, so it's better scheduled
   independently than slotted into a batch with the other nine.~~ **Done,
   shipped 2026-09-17** — no longer part of the active sequencing.

## Cross-cutting reminders (apply to the remaining two)

[[plan-discord-pairing]] had its own additional cross-cutting concerns (new
Discord Developer Portal config, three new secrets, a companion change in a
different repo) — see that doc's own "Session learnings" section if a future
plan needs a similar cross-repo pattern.

- **Schema changes**: per `CLAUDE.md`, any new/altered table must be migrated
  on remote D1 *before* the deploy that depends on it lands — both `--local`
  and `--remote`. Of the remaining two, only [[plan-team-rooms]] needs this;
  [[plan-intermediate-track]] needs zero schema change (the `challenge_*`
  tables are already fully generic).
- **New static pages** need a `run_worker_first` entry in `wrangler.toml`
  ([[plan-intermediate-track]]'s `/challenges` hub + `/challenges/:id`).
- **No inline `<script>`** — all client JS stays in `public/js/*.js`.
- **Tests gate deploy** (`npm test` runs in CI before `wrangler deploy`) —
  every plan's checklist includes new tests in `test/worker.test.mjs`
  following the existing mock-D1 pattern.
- **Verify before committing**: run `npx wrangler dev` and exercise the
  change for real (headless Chrome via `puppeteer-core`, per `CLAUDE.md`)
  before any of these ships.
