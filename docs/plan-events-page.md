# Plan: Club Events Page

**Goal:** a member-facing page listing upcoming (and past) club events —
meetings, CTF competitions, guest talks — authored by admins, with the same
trust model as the existing Announcements feature.

**Status:** **Done — shipped 2026-09-23.** Near-verbatim clone of
Announcements (same public-read/admin-write model) plus `location` and
`event_date` columns, split into Upcoming/Past client-side.

---

## Chunk 0 — DECISIONS

- [ ] **Date field granularity:** a single `event_date` (date, no time) is
      enough for "what day is it," or do events need a start time too (for a
      "starts in 2 hours" feel)? Recommend a single `event_date` stored as a
      Unix timestamp (seconds), same convention as `created_at`/`updated_at`
      elsewhere in `schema.sql` — if a specific time matters, encode it in the
      timestamp and let the client format it; no separate time column needed.
- [ ] **Location/link field?** A short optional `location` text field (room
      number, Discord link, "TBD") adds real value for near-zero cost — worth
      adding alongside `title`/`description`/`event_date`, or keep it minimal
      like Announcements and fold location into the description body.
      Recommend adding it — it's the one thing Announcements doesn't need
      that Events clearly does.
- [ ] **Past-event retention:** keep past events visible in a "Past" section
      indefinitely, or auto-hide/archive after some window? Recommend keep
      indefinitely (simplest, consistent with Announcements never expiring) —
      a "Past" divider is a display-order concern, not a deletion policy.
- [ ] **Should events also show on `/announcements`** (merged feed) or stay a
      fully separate `/events` page? Recommend fully separate — mixing a
      strictly-reverse-chronological feed (Announcements) with a
      date-forward-sorted one (Events) would complicate `renderAnnouncements`
      for no real benefit; two small pages beat one page with two sort modes.

---

## Session learnings / project gotchas (READ FIRST)

- **This is the cheapest of the three social-feature plans, and deliberately
  so** — it is close to a verbatim clone of the Announcements feature, which
  is already a shipped, tested, gated pattern in this codebase. Read
  `worker.js`'s `/api/announcements` block (~line 2389) before writing a
  single line here; almost everything below is "do what that block does, with
  one new column and a different sort."
- **Auth gate to copy exactly:**
  ```js
  if (path.startsWith('/api/events')) {
    if (!env.JWT_SECRET || !env.DB) return jsonResponse({ error: 'Server not configured' }, 503);
    const session = await requireRole(request, env, 'member');
    if (session instanceof Response) return session;
    ...
  }
  ```
  `requireRole(request, env, 'member')` (defined at ~line 1453) already
  excludes guests (`ROLE_RANK.guest = -1 < ROLE_RANK.member = 0`) and rejects
  unauthenticated requests with 401 — this is the *exact* gate Announcements
  uses ("signed-in non-guest member"), no new logic needed.
- **Write gate**: Announcements' `POST`/`PATCH`/`DELETE` all check
  `session.role !== 'admin'` inline (not a `requireRole(..., 'admin')` call,
  since the outer block already established a session) — match that, and
  match the "any admin can manage any post, no per-creator ownership check"
  design note in `worker.js`'s comment at ~line 2386. Do **not** copy Quiz
  Rooms' per-creator ownership check (`created_by !== session.sub`) — that's
  a different trust model for a different feature; Announcements' "shared
  unit-wide content" reasoning applies equally to club events.
- **Validation to copy verbatim**: title required, ≤200 chars; body/
  description required, ≤5000 chars (Announcements' exact caps, ~line
  2420-2425) — no reason for events to have different limits.
- **`last_seen_announcements`-style unread badge**: Announcements has one
  (`/api/auth/me`'s `hasUnreadAnnouncements`, driven by
  `users.last_seen_announcements`). Decide whether Events needs an equivalent
  nav badge — recommend **not** bundling this into v1; it doubles the schema
  surface (`last_seen_events` column) for a feature whose value is unproven
  until the page itself ships. Revisit once Events has real usage.
- **Static page, needs `run_worker_first`.** `/events` is a *static* page
  (like `/announcements` today), so per `CLAUDE.md`'s "Adding a new HTML
  page" section, it must be added to `run_worker_first` in `wrangler.toml`,
  or it skips the worker's CSP/security headers.
- **No inline `<script>`** — `public/js/events.js` (new file) or logic folded
  into `main.js`, loaded via `<script src="/js/events.js">` (classic) or as
  part of `main.js`'s existing page-dispatch (`main.js` already branches by
  path for `/announcements`, `/u/...`, etc. — adding an `/events` branch
  there avoids a whole new file). Recommend following `main.js`'s existing
  dispatch pattern rather than a new file, since the page's interactivity
  (fetch list, admin inline create/edit/delete) is small enough to not
  justify its own module.
- **Announcements page markup to clone**: `public/announcements.html`'s
  skeleton IDs — `#loginGate`/`#loginGateMsg`/`#loginGateBtn` (guest gate),
  `#announcementsContent` (hidden until session resolves),
  `#announcementFormWrap` (admin-only inline create form, hidden for
  non-admins), `#announcementSearch`, `#announcementSortBtn`,
  `#announcementsList`. `public/events.html` should mirror this structure 1:1
  with an `#eventsList` split into an "Upcoming" and "Past" section instead
  of a single flat list.

---

## Implementation checklist

### 1. Data model + migration
- [ ] `schema.sql`: new table
      ```sql
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
      ```
      (index added because, unlike announcements, this table will be queried
      sorted/filtered by date, not just insertion order).
- [ ] Migrate local: `npx wrangler d1 execute DB --local --command "<CREATE TABLE ...>"`.
      **Remote migration must run before the deploy that ships this** (same
      rule as every other schema change in this repo).

### 2. Server (`worker.js`)
- [ ] `GET /api/events` — member-gated, returns all events with
      `event_date >= now` and `event_date < now` split into `upcoming`
      (ascending by date) and `past` (descending, most-recent-past first) —
      or return one flat array sorted by date and let the client split, to
      keep the query simple (single `ORDER BY event_date ASC`, client buckets
      by comparing to `Date.now()`). Recommend client-side split — avoids two
      queries and keeps "now" evaluated once, consistently, at render time.
- [ ] `POST /api/events` — admin only, validates title/description caps
      (mirror Announcements exactly), also validates `event_date` is a valid
      date (reuse the `isNaN(new Date(...).getTime())` check already used for
      Quiz Room `expires_at` at ~line 2545-2546).
- [ ] `PATCH /api/events/:id` — admin only, same shape as
      `PATCH /api/announcements/:id`.
- [ ] `DELETE /api/events/:id` — admin only, same shape.
- [ ] No `/api/events/seen` equivalent for v1 (per Chunk 0 decision).

### 3. Client
- [ ] New `public/events.html`, cloned from `announcements.html`'s structure
      (see gotchas above), `<meta name="robots" content="noindex">` (app
      page, not indexed content — matches Announcements).
- [ ] `main.js`: new `/events` dispatch branch → `initEventsPage()` (mirror
      `initAnnouncementsPage()`/whatever the existing function is named —
      confirm exact name when implementing), rendering upcoming/past sections
      with a divider, admin inline create/edit/delete form reusing the same
      UI pattern as Announcements' admin form.
- [ ] Nav link: add "Events" to the hamburger menu (`navLinks`), matching
      where Announcements/Contact currently live — confirm placement with the
      user, since nav ordering has been actively curated (see recent commits
      moving Announcements to top, Feedback into the hamburger).

### 4. Tests (`test/worker.test.mjs`)
- [ ] `GET /api/events`: requires session, rejects guests, returns events.
- [ ] `POST /api/events`: admin-only (403 for non-admin members), validates
      title/description length caps, validates `event_date`.
- [ ] `PATCH`/`DELETE /api/events/:id`: admin-only, 404 for unknown id
      (assert via mock DB's `changes === 0` handling, same pattern as
      Announcements' tests).
- [ ] Page-render test: `/events` renders 200, no leftover placeholders.

### 5. Docs
- [ ] `README.md`: add `/events`, `/api/events` to the Routes tables; add a
      one-line feature blurb near the Announcements description.
- [ ] `CLAUDE.md`: not required — this plan itself documents the pattern, and
      it's explicitly "copy Announcements," which `CLAUDE.md` doesn't need to
      restate.

### 6. Deploy
- [ ] Remote migration first (new `events` table) → commit + push → verify:
      admin can create/edit/delete an event, non-admin members see the list
      read-only, guests are gated out, upcoming/past split renders correctly
      around the current date.

---

## Suggested build order
1. Migration + `GET`/`POST /api/events` + minimal list UI (no admin edit yet)
   — smallest shippable slice, proves the pattern.
2. `PATCH`/`DELETE` + admin inline edit UI.
3. Upcoming/past visual split + location field polish.

**Cheapest of the three social-community plans** — see [[plan-team-rooms]]
(biggest lift) and [[plan-member-directory]] (privacy-sensitive, needs a
decision before building) for contrast. This one has no new privacy surface,
no new auth pattern, and one small table with an index — it is almost pure
duplication of a feature that's already in production and already tested.
