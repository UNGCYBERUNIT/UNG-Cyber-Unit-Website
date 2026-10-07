# Plan: Instructor Analytics Dashboard

**Goal:** give instructors a per-room, question-level view of where students
are struggling (miss-rate per question) plus a class-wide view of topic-quiz
completion, without exposing any room or user data an instructor doesn't
already have access to.

**Status:** **Done — shipped 2026-09-23.** `/api/rooms/:code/analytics`
(per-question miss-rate) and `/api/instructor/topic-completion` (site-wide)
are both live. Zero schema change, as predicted below.

---

## Chunk 0 — DECISIONS (need your input before building)

- [ ] **Route namespace:** extend the existing `/api/rooms/:code/...`
      sub-resource pattern (e.g. `GET /api/rooms/:code/analytics`, sitting
      next to the existing `/results` handler at ~worker.js:2930) vs. a new
      `/api/instructor/...` namespace. **Recommend extending
      `/api/rooms/:code/...`** — the room-scoped analytics need is really
      "richer `/results`," and it reuses the exact same room-lookup +
      creator-ownership check already written there, rather than
      re-implementing it under a new path. A *class-wide* (cross-room)
      completion view doesn't fit under one room's code, though — see next.
- [ ] **Scope of the "class-wide" view:** `quiz_results` (self-paced topic
      quizzes) has no concept of "class" or "room" — it's just
      `(user_id, topic_id) → score/total`, global across the whole site. An
      instructor asking "how is my class doing on topic quizzes" needs some
      notion of *which* students count as "their class." Two options:
      (a) show aggregate stats across **all** members (site-wide, not
      instructor-scoped) — simplest, no new relationship needed, but not
      really "their" class; (b) scope it to students who have joined at least
      one of that instructor's rooms — an implicit, un-configured roster
      inferred from `quiz_room_attempts`. **Recommend (a) for v1** — label it
      clearly as "site-wide topic quiz completion," ship it as a read-only
      admin-ish view, and treat a real roster/class concept as future scope
      (a `question_bank`-style ownership table if this becomes a real need —
      see [[plan-question-bank]] for the analogous ownership pattern were
      classes ever modeled).
- [ ] **Live query vs. snapshot:** confirm every room in this project is
      small enough (rooms cap at 100 questions per `parseCSV`/
      `validateJSONQuestions`, attempts are one-per-student via the
      `UNIQUE(room_id, user_id)` constraint on `quiz_room_attempts`) that a
      live aggregate query per dashboard load is cheap enough — no caching
      table needed. **Recommend yes**, confirmed by schema: worst case is
      100 questions × attempt count, a single `GROUP BY` query, well within
      D1's comfort zone for a room-scoped admin view loaded on demand (not
      polled).

---

## Session learnings / project gotchas (READ FIRST)

- **No new tables needed.** Everything this feature needs already exists:
  `quiz_room_answers` (`attempt_id, question_id, selected, response_text,
  is_correct`), `quiz_room_questions` (`id, room_id, sort_order, question,
  ...`), `quiz_room_attempts` (`id, room_id, user_id, score, total,
  completed_at`), and `quiz_results` (`user_id, topic_id, score, total,
  updated_at`). This is a pure read/aggregate feature — **no schema.sql
  change, no migration, no `--local`/`--remote` D1 steps.**
- **Creator-ownership pattern to replicate exactly** — every existing
  instructor room endpoint (`GET /api/rooms/:code`, `/results`, `PATCH`,
  `DELETE`, all in `worker.js` ~2930–3060) does the same three-step guard:
  1. `requireRole(request, env, 'instructor')`
  2. `SELECT ... created_by FROM quiz_rooms WHERE code = ?` → 404 if no room
  3. `if (room.created_by !== session.sub && session.role !== 'admin') return jsonResponse({ error: 'Forbidden' }, 403);`

  A new `/api/rooms/:code/analytics` endpoint must copy this verbatim — an
  instructor must never see another instructor's room analytics. Admins see
  everything, same as they can already via `GET /api/rooms?all=1`.
- **`/results` already computes most of the raw material** — read it before
  writing anything new. It already joins `quiz_room_answers` per attempt and
  computes `pendingCount` (ungraded free-response answers) per student. The
  analytics endpoint is the same shape of query, aggregated by *question*
  instead of by *student*: for each `quiz_room_questions.id`, count
  `quiz_room_answers` rows where `is_correct = 0` vs. total answered, to get
  a miss-rate. This can literally be computed **client-side from the
  existing `/results` payload** (it already returns `questions` +
  `attempts[].answers`) instead of a new server route — worth weighing as
  the simplest option (see Chunk 0's route-namespace decision; if client-side
  aggregation from existing data is sufficient, this whole feature might be
  **zero new server code**, only `instructor.html`/`main.js` UI work).
- **`response_text` (free-response) has no automatic correctness** — `is_correct`
  stays `NULL` until an instructor manually grades it (per `CLAUDE.md`'s Quiz
  Rooms description). Miss-rate for free-response questions must exclude
  ungraded (`is_correct IS NULL`) answers from both numerator and
  denominator, or a room with a backlog of ungraded answers will show a
  misleadingly low (or divide-by-zero) miss-rate. Surface "N pending" per
  question the same way `/results` already surfaces it per student.
- **SQL-injection guard**: this feature only ever queries by `room.id`
  (an integer looked up via a parameterized `code` bind) and fixed column
  names — no user-controlled table/column names anywhere, so the
  `leaderboardRank`-style "fixed lookup, never user input" concern from
  `public-profile-plan.md` doesn't apply here; flagging only to confirm no
  new endpoint introduces a dynamic `ORDER BY`/table name from a query param.

---

## Implementation checklist

### 1. Data model
- [ ] None — confirmed no schema change needed (Chunk 0).

### 2. Server (`worker.js`)
- [ ] **If** going the dedicated-endpoint route (Chunk 0): add
      `GET /api/rooms/:code/analytics` alongside `/results`, reusing the
      exact `requireRole` + `created_by` ownership check. Response shape:
      `{ room: {...}, questions: [{ id, question, type, missRate, answeredCount, pendingCount }] }`
      where `missRate = incorrectGraded / (answeredCount - pendingCount)`
      (0 when denominator is 0, not `NaN`/`Infinity`).
- [ ] **If** going client-side-only (Chunk 0): no server change — skip to
      step 3.
- [ ] Site-wide topic-quiz completion view (Chunk 0 option (a)): a
      `requireRole(request, env, 'instructor')`-gated `GET
      /api/instructor/topic-completion` (or similar) that runs
      `SELECT topic_id, COUNT(DISTINCT user_id) AS completions, AVG(score * 1.0 / total) AS avg_pct FROM quiz_results GROUP BY topic_id`
      — read-only, instructor+ only (not member-visible, since it's
      aggregate-but-still-internal usage data), joined against the in-code
      `topics` array (title/icon) purely on the client for display.

### 3. Client (`instructor.html` + `main.js`)
- [ ] `instructor.html`: add an "Analytics" tab/section per room (likely
      surfaced from the existing per-room detail/results view, not a
      standalone top-level page) — a simple bar-per-question miss-rate list,
      reusing the visual language of the existing results roster.
- [ ] `main.js`: fetch + render either the new endpoint's payload or (if
      client-side aggregation was chosen) compute miss-rates from the
      `/results` response already being fetched for the results view — no
      duplicate network call either way.
- [ ] Site-wide completion view: a small section, instructor+ only, showing
      each topic's completion count / average score — read-only, no
      per-student drill-down (that would risk turning into a privacy
      question this plan explicitly scoped out — see Chunk 0).

### 4. Tests (`test/worker.test.mjs`)
- [ ] If a new endpoint was added: mock-DB test asserting a non-owning
      instructor gets `403`, the owning instructor gets the right aggregate
      shape, and an admin can view any room's analytics — mirroring the
      existing `/results` ownership tests if any exist (check first).
- [ ] Miss-rate math: a focused unit test for the aggregation function
      (extract it as a small pure helper, e.g. `computeMissRates(questions,
      answers)`, so it's testable without a DB — same pattern as other pure
      helpers in this codebase like `pathwayBadges`) covering the
      all-pending, zero-answers, and mixed-graded cases.

### 5. Docs
- [ ] `README.md`: add the new route (if any) to the API table.
- [ ] `CLAUDE.md`: not required — this follows an existing pattern closely
      enough to not need a new gotcha note, unless the "site-wide, not
      class-scoped" decision (Chunk 0) is non-obvious enough to warrant a
      one-line callout so it isn't "fixed" into a broken per-class filter by
      someone who forgets there's no roster concept.

### 6. Deploy
- [ ] No migration required.
- [ ] Verify: instructor A cannot fetch instructor B's room analytics (403);
      admin can fetch any room's; miss-rate numbers match manual counting on
      a small seeded test room; pending free-response answers are excluded
      from the rate, not counted as wrong.

---

## Suggested build order
1. Resolve Chunk 0's route-namespace decision — it changes whether this is a
   server task or purely a `main.js` change.
2. Per-room question miss-rate view (highest instructor value, smallest
   scope, no schema change either way).
3. Site-wide topic completion view, once the "site-wide vs. per-class" scope
   decision is confirmed comfortable.

**Cheapest of the three instructor/admin plans** — genuinely might ship with
zero backend changes if the client-side-aggregation option is chosen.
