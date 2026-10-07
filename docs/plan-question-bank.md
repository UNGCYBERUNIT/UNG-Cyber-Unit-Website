# Plan: Reusable Question Bank

**Goal:** let an instructor save a room's questions as a reusable template
and pull from it when building a new room, instead of re-typing or
re-uploading the same questions every time.

**Status:** **Done — shipped 2026-09-23.** Private-per-instructor templates
(`question_bank` + `question_bank_items`), same ownership pattern as Quiz
Rooms. `save-as-template` snapshots a room's questions; `POST /api/rooms`
accepts `template_id` as an alternative to a file upload.

---

## Chunk 0 — DECISIONS (need your input before building)

- [ ] **Ownership scope — private per-instructor, or shared across all
      instructors?** `quiz_rooms` today is strictly per-creator (`created_by`,
      enforced on every read/write per the ownership pattern documented in
      [[plan-instructor-analytics]]). A question bank could follow the same
      model (each instructor's bank is theirs alone), or introduce a "shared
      department bank" both instructors and admins can contribute to.
      **Recommend private-per-instructor for v1** — matches every existing
      ownership convention in this codebase exactly, avoids a new
      cross-user-visibility decision (which this project treats carefully —
      see the public/private profile precedent), and a "shared bank" can be
      layered on later as an explicit opt-in without a breaking schema change
      (e.g. an `is_shared` flag, same shape as `users.is_public`).
- [ ] **Save granularity — whole room as one template, or individual
      questions saved à la carte?** Whole-room-as-template is simpler (one
      save action, matches how rooms are created today) but less flexible
      (can't mix-and-match questions from different past rooms into a new
      one). À la carte is more useful long-term but is a bigger UI lift
      (question-level selection UI in the room builder). **Recommend
      whole-template for v1**, with the schema shaped so à la carte is a
      pure UI change later, not a schema change (see table design below —
      `question_bank_items` already stores one row per question, so a future
      "select individual items across banks" UI needs no migration).
- [ ] **Does saving a template capture a snapshot, or a live reference to
      room questions?** If an instructor edits a room's questions after
      saving it as a template, should the template update too? **Recommend
      snapshot (copy, not reference)** — templates should survive room
      deletion (a template is often saved specifically so the throwaway room
      can be deleted), so `question_bank_items` must be independent rows, not
      foreign-keyed to `quiz_room_questions`.

---

## Session learnings / project gotchas (READ FIRST)

- **Reuse the existing question shape and validators — do not reinvent.**
  `parseCSV()` and `validateJSONQuestions()` (`worker.js` ~1589–1664) already
  produce a normalized `{ question, type, answers, correct, explanation }`
  shape from either upload format, and the manual room-builder path in
  `instructor.html` produces the same shape client-side before POSTing. A
  question bank should store exactly this shape — `answers` as a
  `JSON.stringify`'d array, same as `quiz_room_questions.answers` already
  does — so importing a template into a new room is a straight copy, not a
  reshape.
- **Ownership + auth pattern to replicate**: every room mutation does
  `requireRole(request, env, 'instructor')` then a `created_by ===
  session.sub || session.role === 'admin'` check (see
  [[plan-instructor-analytics]]'s "Session learnings" for the exact
  three-step pattern, e.g. at `worker.js` ~3002 for `PATCH
  /api/rooms/:code`). The question bank's read/update/delete endpoints must
  copy this exactly, scoped to `question_bank.created_by` instead of
  `quiz_rooms.created_by`.
- **1MB file cap / 100-question cap already exist** (`MAX_QUESTION_LEN`,
  `MAX_ANSWER_LEN`, `MAX_EXPLANATION_LEN` constants at `worker.js` ~1464, and
  the `if (questions.length > 100)` cap in both parsers) — a saved template
  should be capped the same way; reuse the same constants rather than
  duplicating magic numbers.
- **Room creation is currently `multipart/form-data`-only** (`POST
  /api/rooms` reads `request.formData()`, not JSON, because it also carries
  the uploaded file). "Create room from template" is a different input shape
  (no file, just a `template_id`) — needs its own branch in the room-creation
  handler (`if (formData.get('template_id'))` before the file-required
  check) or, cleaner, a small addition alongside the existing POST: accept
  an optional `template_id` field and skip the file-parsing branch entirely
  when present, pulling the question rows from `question_bank_items` instead.
- **`CLAUDE.md`'s migration rule is load-bearing here** — this is the one
  plan in this batch that actually needs a schema change. Any `ALTER
  TABLE`/`CREATE TABLE` must run on **both** `--local` and `--remote` D1
  *before* the deploy that ships the code depending on it, or prod 500s on
  a missing table:
  ```
  npx wrangler d1 execute DB --local  --command "CREATE TABLE IF NOT EXISTS question_bank (...)"
  npx wrangler d1 execute DB --remote --command "CREATE TABLE IF NOT EXISTS question_bank (...)"
  ```
  (repeat per new table).

---

## Implementation checklist

### 1. Data model + migration
- [ ] `schema.sql` additions:
  ```sql
  CREATE TABLE IF NOT EXISTS question_bank (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    title      TEXT    NOT NULL,
    created_by INTEGER NOT NULL,
    created_at INTEGER NOT NULL,
    FOREIGN KEY (created_by) REFERENCES users(id)
  );

  CREATE TABLE IF NOT EXISTS question_bank_items (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    bank_id       INTEGER NOT NULL,
    sort_order    INTEGER NOT NULL DEFAULT 0,
    type          TEXT    NOT NULL DEFAULT 'multiple_choice',
    question      TEXT    NOT NULL,
    answers       TEXT    NOT NULL,
    correct       INTEGER,
    explanation   TEXT    NOT NULL DEFAULT '',
    FOREIGN KEY (bank_id) REFERENCES question_bank(id)
  );
  ```
  Deliberately mirrors `quiz_rooms`/`quiz_room_questions` column-for-column
  (same types, same nullability) so the copy-in/copy-out code is a
  straight field mapping, not a transform.
- [ ] Migrate `--local`, then **`--remote` before deploy** (see gotcha
      above).

### 2. Server (`worker.js`)
- [ ] `POST /api/question-bank` — `requireRole(..., 'instructor')`; body is
      JSON `{ title, questions: [...] }` (same shape `validateJSONQuestions`
      already validates — call it directly, don't duplicate the validation
      logic); insert one `question_bank` row + batch-insert
      `question_bank_items`, same `env.DB.batch(...)` pattern used for room
      creation (~worker.js:2582).
- [ ] `POST /api/rooms/:code/save-as-template` — convenience endpoint:
      instructor-owns-room check (existing pattern), then read that room's
      `quiz_room_questions`, insert as a new `question_bank` (title defaults
      to the room's title). Saves a round-trip vs. requiring the client to
      re-POST question data it already has server-side.
- [ ] `GET /api/question-bank` — instructor lists **their own** banks only
      (`WHERE created_by = ?`, admin sees all only if Chunk 0's shared-bank
      question resolves that way — default: no `?all=1` escape hatch unless
      explicitly decided, unlike `/api/rooms`).
- [ ] `GET /api/question-bank/:id` — bank detail (items), ownership-checked.
- [ ] `DELETE /api/question-bank/:id` — ownership-checked, cascades to
      `question_bank_items` (same cascade-delete pattern as
      `DELETE /api/rooms/:code` at ~worker.js:3037–3059).
- [ ] `POST /api/rooms` — extend to accept `template_id` as an alternative
      to the uploaded `file` field (Chunk 0/gotchas above); when present,
      copy `question_bank_items` rows into new `quiz_room_questions` rows
      instead of parsing a file. Ownership-check the template the same way
      (`bank.created_by === session.sub`) before allowing it to be used.

### 3. Client (`instructor.html` + `main.js`)
- [ ] "Save as Template" button on the room results/detail view (reuses
      `save-as-template` endpoint — zero new form needed, just a button +
      title prompt).
- [ ] New "Question Bank" section in `instructor.html`, listing saved banks
      (title, question count, created date) with a delete action.
- [ ] Room-builder: a third `questionSourceMode` option ("Use a Saved
      Template") alongside the existing "Build Manually" / "Import from
      File" (`instructor.html` ~line 53), populated from `GET
      /api/question-bank`.

### 4. Tests (`test/worker.test.mjs`)
- [ ] `POST /api/question-bank`: rejects non-instructors, validates question
      shape via the existing validator (assert it's actually being reused,
      not reimplemented).
- [ ] `GET /api/question-bank`: instructor A never sees instructor B's banks
      in the results (mock-DB binding assertion, same style as the
      `/api/profile/visibility` ownership test in `public-profile-plan.md`).
- [ ] `DELETE /api/question-bank/:id`: 403 for a non-owning instructor, 404
      for unknown id, cascade-deletes items.
- [ ] `POST /api/rooms` with `template_id`: creates room questions matching
      the template's items; rejects a `template_id` owned by another
      instructor (403, not silently ignored).

### 5. Docs
- [ ] `README.md`: add the new endpoints to the API table; mention
      `question_bank`/`question_bank_items` in the schema.sql line alongside
      the other quiz-room tables.
- [ ] `CLAUDE.md`: note the snapshot-not-reference decision (Chunk 0) so a
      future contributor doesn't "fix" a template to live-sync with its
      source room and break the "survives room deletion" property.

### 6. Deploy
- [ ] Remote migration **before** push (both new tables).
- [ ] Verify: save a room as a template, delete the room, confirm the
      template still lists its questions; create a new room from that
      template; confirm instructor B cannot see or use instructor A's bank.

---

## Suggested build order
1. Schema + migration (both environments) — nothing else can be tested
   without it.
2. `POST /api/question-bank` + `save-as-template` + `GET` list/detail +
   `DELETE`, with tests, before touching room creation.
3. Wire `template_id` into `POST /api/rooms` last — it's the highest-risk
   change (touches the existing, working room-creation path) so do it once
   the bank CRUD is proven solid in isolation.

**Only plan in this batch of three that needs a schema migration** — budget
the two-environment D1 step into the timeline explicitly.
