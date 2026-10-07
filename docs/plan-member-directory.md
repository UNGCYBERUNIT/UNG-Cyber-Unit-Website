# Plan: Member Directory

**Goal:** a browsable list of opted-in public profiles (building on the
existing `users.is_public` flag), filterable by role/rank, so members can
find study partners — without weakening the privacy contract
`GET /api/user/:username` already established.

**Status:** **Done — shipped 2026-09-23.** `/members` + `GET /api/members`
are live, reusing `/api/user/:username`'s exact field whitelist per row,
filtered to `is_public = 1` at the SQL level. No schema change, as
predicted. Privacy-posture decision (below) was **resolved** pre-build: all
users were polled and consented to directory listing — decision (a).

---

## Chunk 0 — DECISIONS

- [x] **Privacy posture change — RESOLVED.** Today, per
      [[public-profile-plan]] and `CLAUDE.md`'s "Public/private profiles"
      section, opting into `is_public` means: *"other logged-in users can
      view this profile **if they know the username** (e.g. from the
      leaderboard, or a direct `/u/:username` link)."* It is opt-in but
      **not discoverable** — nothing today lets a stranger browse the full
      list of public users. A member directory changes that to **browsable**
      — every opted-in user becomes trivially enumerable by anyone signed in,
      not just people who already know their username. This was flagged as a
      real, user-facing change in exposure, not just a UI convenience, and
      raised as a question of whether existing opted-in users consented to
      being listed under the old framing.
      **Resolved 2026-08-03: user ran a poll and confirmed all users consent
      to directory listing.** Going with **(a)** — `is_public` now means
      "listed," no second opt-in flag. Update the `/profile` toggle's copy to
      say so explicitly going forward (new opt-ins should know what they're
      agreeing to, even though existing ones have separately consented via
      the poll).
- [ ] **What filters?** Role (member/student/instructor) and/or rank
      (module/room leaderboard position) were the ask. Role is trivial (one
      more `WHERE`/client filter on an already-fetched field). Rank-based
      filtering ("show me people ranked near me") is more work — recommend
      v1 ships with role filter + alphabetical/rank sort, not a rank *range*
      filter; revisit if there's demand.
- [ ] **Pagination shape**: cursor-based or simple offset/limit? Given this
      is a club-scale app (dozens to low hundreds of users, not thousands),
      recommend simple `?page=`/`limit` offset pagination — matches the
      complexity level of everything else in this codebase (no cursor
      pagination exists anywhere today).
- [ ] **Does directory inclusion require *any* activity** (e.g. must have
      completed at least one topic quiz) to avoid a directory full of
      zero-progress accounts? Recommend no special gate beyond the opt-in
      itself — an activity filter is a nice-to-have sort option
      ("Most Active"), not a listing requirement.

---

## Session learnings / project gotchas (READ FIRST)

- **The field whitelist for a public user is already strictly defined and
  tested — do not expand it.** `GET /api/user/:username` (worker.js
  ~line 2236-2259) returns exactly:
  `username, avatar, created_at, badges, rank, roomRank, isStudent`.
  It explicitly excludes `id`, `role` (raw), `is_public` itself, quiz-room
  history, and per-topic progress — enforced today by tests asserting the
  private/public response bodies never contain those fields
  ([[public-profile-plan]] section 6/7). **The member directory must reuse
  this exact whitelist for every row it returns**, not introduce a parallel
  "directory summary" shape with different fields. If a filter needs a field
  not in the whitelist (e.g. filtering by role needs `isStudent`-equivalent
  granularity — check whether `role` itself, e.g. `'instructor'`, needs
  exposing for the role filter to work, since today only the *derived*
  `isStudent` boolean is exposed, not raw `role`). This is the one place in
  this plan worth the most implementation care.
- **`is_public` alone is not enough to safely enumerate today** — the single-
  user endpoint checks `is_public` per row because it's looking up *one*
  specific username the caller already knows. A directory endpoint is
  different in kind: it's the first place in this codebase that would query
  `WHERE is_public = 1` across *all* users and return a list. Guard it exactly like every other member-
  facing list endpoint: `requireRole(request, env, 'member')` (excludes
  guests, requires auth) — same gate as `/api/announcements` and
  `/api/leaderboard`.
- **Reuse `pathwayBadges()` and `leaderboardRank()`** (~lines 946, 961) —
  exactly as `/api/user/:username` already does — for the badges/rank fields
  in each directory row. Don't reimplement.
- **`leaderboardRank()` runs one query per user it's called for** (it's
  written to answer "what's *this* user's rank," singular). Calling it in a
  loop for a paginated directory page (e.g. 20 rows) means up to 40 extra
  queries per page (rank + roomRank per row) on top of the base listing
  query. That's likely fine at this app's scale (D1, club-sized user count,
  paginated to ~20 rows), but if it becomes a bottleneck, the fix is a single
  windowed-rank query computed once per page rather than N calls to
  `leaderboardRank()` — flag as a possible follow-up, not a blocker for v1.
- **`GET /api/leaderboard` is a different endpoint with a different
  purpose** — it ranks by *points*, top 10, regardless of `is_public`
  (leaderboard visibility was explicitly decided to NOT gate on `is_public`
  per [[public-profile-plan]] — "every username links to `/u/:username`
  regardless of visibility"). The member directory is the opposite shape:
  it filters *to* `is_public` users specifically, and isn't about points
  ranking, it's about "who can I find." Don't conflate the two or reuse the
  leaderboard query — they answer different questions.
- **SQL parameterization discipline**: any role filter must use a bound
  parameter or a fixed-set lookup (`role IN ('member','student',...)` built
  from a hardcoded array of valid roles, never interpolating a raw query-
  string value into SQL) — same pattern already used for leaderboard's
  `mode` parameter (fixed lookup, never user input directly in the query
  string).
- **`noindex`**: this is an app page, gated behind login — `noindex`, not in
  the sitemap, same as `/leaderboard`/`/profile`/`/u/:username`.
- **No inline `<script>`.**

---

## Implementation checklist

### 1. Data model + migration
- [ ] None needed — reuse `is_public` as-is. No `schema.sql` change, no
      migration.

### 2. Server (`worker.js`)
- [ ] New `GET /api/members?role=&page=&limit=` — member-gated
      (`requireRole(..., 'member')`), queries
      `SELECT id, username, avatar, created_at, role FROM users WHERE
      is_public = 1 [AND role = ?] ORDER BY username ASC LIMIT ? OFFSET ?`,
      then for each row builds the exact same response shape as
      `/api/user/:username` (`username, avatar, created_at, badges, rank,
      roomRank, isStudent`) — drop `id`/`role` before returning, same as the
      single-user endpoint does implicitly by never selecting them into the
      response object in the first place. Also return a `total` count
      (separate `SELECT COUNT(*)` with the same `WHERE`) for pagination UI.
- [ ] `/profile`'s visibility toggle copy: update to describe the new,
      broader meaning of `is_public` going forward ("Public profile: viewable
      via your link and listed in the Member Directory.") so future opt-ins
      make an informed choice — existing opted-in users' consent already
      covered separately by the poll.

### 3. Client
- [ ] New `public/members.html` (or extend `leaderboard.html` with a tab —
      recommend a **separate page**, `/members`, since the leaderboard's
      whole point is ranking by points and mixing in a browse-by-role
      directory would muddy that page's purpose), `noindex`, navbar + gated
      content shell matching `announcements.html`'s
      loginGate/content-hidden-until-resolved pattern.
- [ ] `main.js`: `/members` dispatch branch, fetches `/api/members`, renders
      a card grid reusing the same profile-card visual language as
      `/leaderboard`/`/u/:username` (avatar, username linking to
      `/u/:username`, badges, rank), role filter chips, pagination controls.

### 4. Security / privacy review (this is the riskiest part of this plan)
- [ ] Directory endpoint returns **only** the established whitelist fields —
      write a test asserting the response never contains `id`, `role` (raw),
      `is_public`, `roomAttempts`, or any quiz-progress field, mirroring the
      existing `/api/user/:username` test style exactly.
- [ ] Directory query is gated to `is_public = 1` at the SQL level, not
      filtered client-side after fetching all users — never return a private
      user's row at all, not even with fields stripped.
- [ ] Guests get 401/403 from `requireRole`, same as every other member-
      gated list.

### 5. Tests (`test/worker.test.mjs`)
- [ ] `GET /api/members`: requires session, rejects guests, only returns
      `is_public` users, response shape matches the whitelist exactly
      (reuse/extend the existing `/api/user/:username` field-whitelist test
      pattern), role filter works, pagination `total`/`limit`/`page` behave
      correctly.
- [ ] Page-render test: `/members` renders 200, `noindex`.

### 6. Docs
- [ ] `README.md`: add `/members`, `/api/members` to Routes.
- [ ] `CLAUDE.md`: update the "Public/private profiles" section to note
      `is_public` now also gates inclusion in the `/members` directory, not
      just `/u/:username` visibility — so a future reader understands the
      full scope of what toggling it does.

### 7. Deploy
- [ ] No migration needed.
- [ ] Verify: directory only shows opted-in users; field whitelist holds
      under manual inspection of the raw API response, not just the rendered
      UI.

---

## Suggested build order
1. `GET /api/members` + whitelist tests (build the tests *with* the
   endpoint, not after — this is the plan where that discipline matters
   most).
2. `/members` page + role filter + pagination.
3. `/profile` toggle copy update.

Cross-reference: [[public-profile-plan]] (the existing shipped feature this
builds on), [[plan-events-page]] (cheapest social feature, for contrast),
[[plan-team-rooms]] (biggest engineering lift; this one's biggest cost is
judgment, not code).
