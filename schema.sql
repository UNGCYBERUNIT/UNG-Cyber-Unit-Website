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
  email                     TEXT,
  email_pending             TEXT,
  email_verify_token_hash   TEXT,
  email_verify_expires_at   INTEGER,
  email_verify_last_sent_at INTEGER,
  is_ung_student            INTEGER NOT NULL DEFAULT 0,
  password_reset_token_hash   TEXT,
  password_reset_expires_at   INTEGER,
  password_reset_last_sent_at INTEGER,
  discord_id         TEXT,
  discord_username   TEXT,
  discord_linked_at  INTEGER
);

-- Verified email must uniquely identify one account (not currently tied to
-- any role — see CLAUDE.md; is_ung_student above is dormant, reserved for a
-- future feature, not referenced by any code).
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email ON users(email) WHERE email IS NOT NULL;

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
-- being logged. actor_id intentionally has no cascade-on-delete behavior:
-- the log must survive the actor's account being removed, which is why
-- actor_name is captured as a denormalized snapshot at insert time.
CREATE TABLE IF NOT EXISTS audit_log (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  actor_id    INTEGER NOT NULL,
  actor_name  TEXT    NOT NULL,
  action      TEXT    NOT NULL,
  target      TEXT    NOT NULL,
  detail      TEXT,
  created_at  INTEGER NOT NULL,
  FOREIGN KEY (actor_id) REFERENCES users(id)
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
