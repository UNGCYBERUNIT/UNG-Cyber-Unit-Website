CREATE TABLE IF NOT EXISTS users (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  username      TEXT    UNIQUE NOT NULL,
  password_hash TEXT    NOT NULL,
  role          TEXT    NOT NULL DEFAULT 'member',
  avatar        TEXT,
  streak        INTEGER NOT NULL DEFAULT 0,
  last_active   TEXT,
  created_at    INTEGER NOT NULL,
  is_public     INTEGER NOT NULL DEFAULT 0,
  last_seen_announcements INTEGER,
  is_ung_student            INTEGER NOT NULL DEFAULT 0,
  password_reset_token_hash   TEXT,
  password_reset_expires_at   INTEGER,
  password_reset_last_sent_at INTEGER,
  discord_id         TEXT,
  discord_username   TEXT,
  discord_linked_at  INTEGER,
  -- Opt-out for the post-login "link a recovery email" nudge (shown when a
  -- member has zero confirmed user_emails rows). Toggled from the profile
  -- page's Linked Emails section, or from the popup's own "don't ask again"
  -- checkbox. Linking a confirmed email makes the nudge moot regardless of
  -- this flag (see showEmailReminder in POST /api/auth/login).
  email_reminder_dismissed INTEGER NOT NULL DEFAULT 0,
  -- Session revocation. Embedded in every issued session JWT as `ver`;
  -- getSession() rejects a token whose `ver` doesn't match this column.
  -- Bumped on password reset and POST /api/auth/sign-out-everywhere, so a
  -- copied/stolen session cookie stops working immediately instead of
  -- staying valid until its 7-day natural expiry. See CLAUDE.md's "Session
  -- revocation" section.
  token_version      INTEGER NOT NULL DEFAULT 0
);

-- Up to 3 email addresses per account (app-enforced cap, not a DB
-- constraint — see CLAUDE.md), each independently addable/removable, not
-- tied to any role (is_ung_student above is dormant, reserved for a future
-- feature, not referenced by any code). One row per address: `email` is
-- set once verified, NULL while `pending_email` awaits confirmation.
-- password_reset_* stays on `users` below, not here — a reset is keyed by
-- whichever address the requester types in (looked up via JOIN), not "the
-- account's email," so there's nothing per-address to store for it.
CREATE TABLE IF NOT EXISTS user_emails (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id             INTEGER NOT NULL,
  email               TEXT,
  pending_email       TEXT,
  verify_token_hash   TEXT,
  verify_expires_at   INTEGER,
  verify_last_sent_at INTEGER,
  created_at          INTEGER NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id)
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_user_emails_email ON user_emails(email) WHERE email IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_user_emails_user_id ON user_emails(user_id);
CREATE INDEX IF NOT EXISTS idx_user_emails_verify_token_hash ON user_emails(verify_token_hash) WHERE verify_token_hash IS NOT NULL;

-- A Discord account can only ever be linked to one website account (see
-- docs/plan-discord-pairing.md). Same partial-unique-index shape as email.
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_discord_id ON users(discord_id) WHERE discord_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS quiz_results (
  user_id    INTEGER NOT NULL,
  topic_id   TEXT    NOT NULL,
  score      INTEGER NOT NULL,
  total      INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, topic_id),
  FOREIGN KEY (user_id) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS quiz_rooms (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  code        TEXT    UNIQUE NOT NULL,
  title       TEXT    NOT NULL,
  created_by  INTEGER NOT NULL,
  expires_at  INTEGER,
  status      TEXT    NOT NULL DEFAULT 'open',
  visibility  TEXT    NOT NULL DEFAULT 'private',
  created_at  INTEGER NOT NULL,
  FOREIGN KEY (created_by) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS quiz_room_questions (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  room_id     INTEGER NOT NULL,
  sort_order  INTEGER NOT NULL DEFAULT 0,
  type        TEXT    NOT NULL DEFAULT 'multiple_choice',
  question    TEXT    NOT NULL,
  answers     TEXT    NOT NULL,
  correct     INTEGER,
  explanation TEXT    NOT NULL DEFAULT '',
  FOREIGN KEY (room_id) REFERENCES quiz_rooms(id)
);

-- Reusable question templates. Private per-instructor for v1 (no shared/
-- department bank — see docs/plan-question-bank.md's Chunk 0). Items are a
-- snapshot (copied values, not a live reference) so a template survives the
-- deletion of the room it may have originally been saved from.
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

CREATE TABLE IF NOT EXISTS quiz_room_attempts (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  room_id      INTEGER NOT NULL,
  user_id      INTEGER NOT NULL,
  score        INTEGER NOT NULL,
  total        INTEGER NOT NULL,
  completed_at INTEGER NOT NULL,
  UNIQUE (room_id, user_id),
  FOREIGN KEY (room_id) REFERENCES quiz_rooms(id),
  FOREIGN KEY (user_id) REFERENCES users(id)
);

-- Sliding-window brute-force protection: one row per failed room-code lookup.
CREATE TABLE IF NOT EXISTS room_lookup_failures (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ip TEXT    NOT NULL,
  ts INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_rlf_ip_ts ON room_lookup_failures (ip, ts);

CREATE TABLE IF NOT EXISTS quiz_room_answers (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  attempt_id    INTEGER NOT NULL,
  question_id   INTEGER NOT NULL,
  selected      INTEGER,
  response_text TEXT,
  is_correct    INTEGER,
  FOREIGN KEY (attempt_id)  REFERENCES quiz_room_attempts(id),
  FOREIGN KEY (question_id) REFERENCES quiz_room_questions(id)
);

CREATE TABLE IF NOT EXISTS announcements (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  title       TEXT    NOT NULL,
  body        TEXT    NOT NULL,
  created_by  INTEGER NOT NULL,
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER,
  FOREIGN KEY (created_by) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS events (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  title       TEXT    NOT NULL,
  description TEXT    NOT NULL,
  location    TEXT,
  event_date  INTEGER NOT NULL,
  created_by  INTEGER NOT NULL,
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER,
  FOREIGN KEY (created_by) REFERENCES users(id)
);
CREATE INDEX IF NOT EXISTS idx_events_date ON events (event_date);

-- Append-only. No UPDATE/DELETE route should ever exist for this table —
-- the only mutation is the INSERT performed as a side effect of the action
-- being logged. actor_id deliberately has NO FOREIGN KEY (unlike every
-- other actor/creator/user_id column in this file) — the log must survive
-- the actor's account being removed, which is why actor_name is captured
-- as a denormalized snapshot at insert time; a FK here would silently
-- block deleting any user who ever performed a single audited action,
-- contradicting that design (caught via DELETE /api/admin/users/:id
-- actually failing on this in practice — see CLAUDE.md).
CREATE TABLE IF NOT EXISTS audit_log (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  actor_id    INTEGER NOT NULL,
  actor_name  TEXT    NOT NULL,
  action      TEXT    NOT NULL,
  target      TEXT    NOT NULL,
  detail      TEXT,
  created_at  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_audit_log_created_at ON audit_log (created_at);

CREATE TABLE IF NOT EXISTS feedback (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  message     TEXT    NOT NULL,
  username    TEXT,
  created_at  INTEGER NOT NULL
);

-- Sliding-window rate limit for the open (unauthenticated) feedback form:
-- one row per submission, same shape as room_lookup_failures.
CREATE TABLE IF NOT EXISTS feedback_rate_limit (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ip TEXT    NOT NULL,
  ts INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_frl_ip_ts ON feedback_rate_limit (ip, ts);

-- Sliding-window rate limit for the unauthenticated forgot-password/
-- forgot-username endpoints (verify-email/request stays authenticated and
-- uses its own per-account cooldown instead — see worker.js).
CREATE TABLE IF NOT EXISTS email_action_rate_limit (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ip TEXT    NOT NULL,
  ts INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_earl_ip_ts ON email_action_rate_limit (ip, ts);

-- Sliding-window rate limit for account creation (register + guest), shared
-- table since both are unauthenticated and equally cheap to spam.
CREATE TABLE IF NOT EXISTS signup_rate_limit (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ip TEXT    NOT NULL,
  ts INTEGER NOT NULL
);

-- Sliding-window rate limit for POST /api/auth/login: counts only *failed*
-- attempts per IP (same shape/approach as room_lookup_failures), so normal
-- logins are never throttled — only brute-force/credential-stuffing is.
CREATE TABLE IF NOT EXISTS login_failures (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ip TEXT    NOT NULL,
  ts INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_lf_ip_ts ON login_failures (ip, ts);

-- Devices POST /api/auth/login has already alerted-on-and-remembered for a
-- given account, keyed by a hash of the long-lived device_id cookie (see
-- deviceCookie() in src/lib/auth.js) — never the raw cookie value, same
-- hash-not-plaintext rule as every other single-use/bearer token in this
-- app. A login with no device_id cookie, or one with no matching row here
-- for *this* user_id, is "new" and triggers the new-sign-in alert email
-- before being recorded. (user_id, device_token_hash) is unique rather than
-- device_token_hash alone, since the same browser logging into a second
-- account on this site is legitimately "new" from that second account's
-- perspective even though the cookie itself isn't.
CREATE TABLE IF NOT EXISTS known_devices (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id           INTEGER NOT NULL,
  device_token_hash TEXT    NOT NULL,
  user_agent        TEXT,
  first_seen_at     INTEGER NOT NULL,
  last_seen_at      INTEGER NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id)
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_known_devices_user_device ON known_devices (user_id, device_token_hash);
-- Column holds raw, attacker-controlled User-Agent text (nothing escapes
-- it on write) — fine today since no UI reads it back, but any future
-- "recent devices" admin/profile view MUST HTML-escape it on render, same
-- as every other user-controlled string in this app.

-- Sliding-window rate limit for the new-sign-in alert email above, keyed by
-- user_id rather than IP (unlike every other rate limit table here) —
-- the attacker's IP is irrelevant to what's being protected: the victim's
-- inbox and this site's shared Resend send quota. Without this, anyone who
-- already has valid credentials (phished password, a credential-stuffing
-- hit, or their own misbehaving script) could trigger unlimited alert
-- sends just by omitting the device_id cookie on every request — each
-- one looks "new" to known_devices above, since checkLoginLimit/
-- recordLoginFailure (ratelimit.js) only throttles FAILED logins, never
-- successful ones. isNewDeviceAlertLimited()/recordNewDeviceAlert() in
-- src/lib/ratelimit.js deliberately do NOT 429 the login itself (unlike
-- every other check*/record* pair) — valid credentials must still log the
-- caller in; only the side-effect email gets silently skipped past the cap.
CREATE TABLE IF NOT EXISTS new_device_alert_rate_limit (
  id      INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  ts      INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_ndarl_user_ts ON new_device_alert_rate_limit (user_id, ts);

-- Instructor-only answer keys for downloadable challenge sets (see
-- /log-analysis-challenge). Stored as a D1 blob rather than a public/ static
-- asset specifically so the file never enters the (public) git repo/GitHub
-- history — it's uploaded straight into D1, local and remote, and served
-- only via GET /api/challenges/:id/answer-key behind requireRole('instructor').
CREATE TABLE IF NOT EXISTS challenge_answer_keys (
  challenge_id TEXT    PRIMARY KEY,
  filename     TEXT    NOT NULL,
  content_type TEXT    NOT NULL,
  data         BLOB    NOT NULL,
  uploaded_at  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_srl_ip_ts ON signup_rate_limit (ip, ts);

-- Correct answers for downloadable-challenge parts (e.g. /log-analysis-challenge,
-- /network-traffic-challenge), checked server-side by POST
-- /api/challenges/:id/submit. Kept in D1 rather than worker.js — even
-- normalized/hashed, these are short low-entropy strings (IPs, small counts,
-- one password) that a public GitHub repo would effectively leak to offline
-- brute-forcing. Multiple rows per (challenge_id, part_id) allow more than
-- one accepted phrasing of the same answer.
CREATE TABLE IF NOT EXISTS challenge_answers (
  challenge_id TEXT NOT NULL,
  part_id      TEXT NOT NULL,
  answer_norm  TEXT NOT NULL,
  PRIMARY KEY (challenge_id, part_id, answer_norm)
);

-- Which (user, challenge, part) combos a member/guest has solved — the
-- "save completion state" this powers. Idempotent inserts (ON CONFLICT DO
-- NOTHING in worker.js) keep the original completed_at on repeat correct
-- submissions.
CREATE TABLE IF NOT EXISTS challenge_completions (
  user_id      INTEGER NOT NULL,
  challenge_id TEXT    NOT NULL,
  part_id      TEXT    NOT NULL,
  completed_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, challenge_id, part_id),
  FOREIGN KEY (user_id) REFERENCES users(id)
);

-- Sliding-window rate limit on challenge-answer submissions (brute-force/
-- spam guard) — only *wrong* submissions count, same "don't throttle
-- legitimate use" shape as room_lookup_failures, but keyed by user_id since
-- submitting requires a session rather than by IP.
CREATE TABLE IF NOT EXISTS challenge_submit_rate_limit (
  id      INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  ts      INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_csrl_user_ts ON challenge_submit_rate_limit (user_id, ts);

-- Which (user, challenge, part, hint) hints a user has paid the point-cost to
-- reveal (OSINT lab hint mechanic, POST /api/challenges/:id/hints/reveal).
-- Hint text/cost itself lives in
-- ctfModules (src/data/challenges.js) — not secret, it's meant to be given
-- out — only the "did this user already pay for it" fact is stateful.
-- Idempotent reveal: re-requesting an already-revealed hint never double-charges.
CREATE TABLE IF NOT EXISTS challenge_hints_revealed (
  user_id      INTEGER NOT NULL,
  challenge_id TEXT    NOT NULL,
  part_id      TEXT    NOT NULL,
  hint_index   INTEGER NOT NULL,
  revealed_at  INTEGER NOT NULL,
  PRIMARY KEY (user_id, challenge_id, part_id, hint_index),
  FOREIGN KEY (user_id) REFERENCES users(id)
);

-- Free-text answers for "instructor-graded" challenge parts (gradingMode:
-- 'manual' in ctfModules) — questions with no single checkable answer (a
-- live DNS value, "name two hobbies you wouldn't expect"). Never compared
-- against challenge_answers; POST /api/challenges/:id/submit just stores the
-- latest text here. Upserted (not append-only) so a resubmit overwrites
-- rather than piling up history an instructor would have to wade through.
CREATE TABLE IF NOT EXISTS challenge_pending_answers (
  user_id      INTEGER NOT NULL,
  challenge_id TEXT    NOT NULL,
  part_id      TEXT    NOT NULL,
  answer_text  TEXT    NOT NULL,
  submitted_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, challenge_id, part_id),
  FOREIGN KEY (user_id) REFERENCES users(id)
);

-- Kanban board (Jira replacement, see docs/plan-kanban-board.md). Shared,
-- single board, instructor+-gated for both read and write (no per-creator
-- ownership check — same shared-content trust model as announcements, not
-- Quiz Rooms' per-creator model). Fixed status/priority/item_type enums
-- rather than Jira-style custom workflows — see the plan doc's Chunk 0.
-- parent_id is one level of subtask nesting only (a subtask's own parent_id
-- points at a top-level item; subtasks are not shown as their own column
-- cards, just a checklist on the parent).
CREATE TABLE IF NOT EXISTS kanban_items (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  title       TEXT    NOT NULL,
  description TEXT    NOT NULL DEFAULT '',
  item_type   TEXT    NOT NULL DEFAULT 'task',    -- task | story | subtask | epic
  status      TEXT    NOT NULL DEFAULT 'idea',    -- idea | todo | in_progress | in_review | archived
  priority    TEXT    NOT NULL DEFAULT 'medium',  -- lowest | low | medium | high | highest
  sort_order  INTEGER NOT NULL DEFAULT 0,
  parent_id   INTEGER,
  assigned_to INTEGER,
  due_date    INTEGER,
  due_reminder_sent_at INTEGER, -- set once the due-date reminder email fires, so the hourly cron (worker.js scheduled()) never re-sends it on a later tick
  created_by  INTEGER NOT NULL,
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER,
  FOREIGN KEY (parent_id)    REFERENCES kanban_items(id),
  FOREIGN KEY (assigned_to)  REFERENCES users(id),
  FOREIGN KEY (created_by)   REFERENCES users(id)
);
CREATE INDEX IF NOT EXISTS idx_kanban_items_status ON kanban_items (status, sort_order);
CREATE INDEX IF NOT EXISTS idx_kanban_items_due_date ON kanban_items (due_date);
