# Plan: Topic Difficulty Tags (Badge Fix + Homepage Filter)

**Goal:** make the existing `difficulty` field actually mean something on the
homepage grid (right now every topic shows an identical green "Beginner"
badge regardless of its real value), and add a filter so learners can narrow
the grid once [[plan-intermediate-track]] adds non-Beginner topics.

**Status:** **Done — shipped 2026-09-23.** Fixed the latent bug (grid card's
3 call sites hardcoded `badge-beginner` regardless of real difficulty) and
added the All/Beginner/Intermediate/Advanced filter chips.

---

## Chunk 0 — DECISIONS

- [ ] **Filter UI shape:** a row of toggle chips above the grid (All /
      Beginner / Intermediate / Advanced), client-side only (no server
      round-trip — `topics` is already fully delivered via `/api/topics`).
      Recommend this over a `<select>` — matches the site's existing
      chip/badge visual language.
- [ ] **Does the filter need a URL param** (e.g. `/?difficulty=intermediate`)
      so it's linkable/bookmarkable? Recommend yes, it's cheap
      (`URLSearchParams`) and lets `/start-advanced` deep-link "see all
      Advanced topics" back to `/`.
- [ ] **`badge-advanced` CSS:** doesn't exist yet (only `.badge-beginner` and
      `.badge-intermediate` are defined in `style.css`) — needs a color choice.
      Recommend reusing `--danger` (already in the palette, used elsewhere for
      warnings) at low opacity, matching the `.badge-intermediate` pattern.

---

## Session learnings / project gotchas (READ FIRST)

- **This is smaller than it looks — most of the plumbing already exists:**
  - `topics[].difficulty` is already a real field (`'Beginner'` on all 11
    topics today).
  - `/topic.html`'s per-topic difficulty badge is **already wired
    correctly** — `worker.js` line ~3202 does
    `.replace('<span class="badge badge-beginner" id="topicDifficulty">Beginner</span>', 
    `<span class="badge badge-${topic.difficulty.toLowerCase()}" ...>`)`,
    so individual topic pages already render the right badge class/text for
    whatever `difficulty` says. **Nothing to fix there.**
  - The bug is only in the **grid card component**, which has three
    hand-synced copies, all hardcoding the class:
    - `worker.js` `topicCard()` (~line 1220, server-rendered homepage grid +
      pathway cards)
    - `public/js/main.js` line 133 (client-side homepage grid re-render)
    - `public/js/main.js` line 2691 (a third copy — the `/profile` page's
      "Topic Quiz Progress" grid renderer, confirmed by reading the
      surrounding function)
  - Fix: in all three, replace the literal `badge badge-beginner` with
    `` badge badge-${t.difficulty.toLowerCase()} `` (worker.js already has
    `escapeHtml`/`escHtml` around the *text*; the class itself should stay
    unescaped-but-safe since `difficulty` is fixed internal data, never user
    input — same reasoning as the existing topic.html replace).
- **Three-copy duplication is itself worth noting**: this is exactly the
  "hand-synced copies drift" problem `CLAUDE.md` calls out for
  `topic-render.js` (`c205807` regression). `topicCard()` in `worker.js` is
  *not* currently in the isomorphic `topic-render.js` module — it's
  worker-only, and the client re-fetches via `/api/topics` rather than
  sharing the renderer (per `CLAUDE.md`'s "Homepage topic grid" section).
  Fixing the badge class in three places is in scope for this plan; moving
  `topicCard()` into the shared module to eliminate the duplication entirely
  is a larger refactor — flag it as a follow-up, not bundled here.
- **No inline `<script>`** — the filter chips' click handling goes in
  `main.js`, no new page needed.

---

## Implementation checklist

### 1. CSS
- [ ] Add `.badge-advanced` to `public/css/style.css`, matching the existing
      `.badge-beginner`/`.badge-intermediate` pattern (background/color/border
      trio at the established opacity).

### 2. Badge class fix (3 call sites)
- [ ] `worker.js` `topicCard()`: `badge badge-${escapeHtml(t.difficulty.toLowerCase())}`
      — note `difficulty` is internal data (not user input) so this is safe,
      but keep consistent with how the file already treats topic data.
- [ ] `public/js/main.js` line ~133 (homepage grid).
- [ ] `public/js/main.js` line ~2691 (`/profile` "Topic Quiz Progress" grid).

### 3. Filter UI
- [ ] `index.html`: add a chip row inside/above `<section id="topics">`
      (`All` / `Beginner` / `Intermediate` / `Advanced`), `aria-pressed` on the
      active chip for accessibility.
- [ ] `main.js`: on chip click, filter the already-fetched `topics` array
      client-side and re-render the grid (reuse the existing card-building
      code, just gate the `.map()` input through `.filter()`); update
      `?difficulty=` in the URL via `history.replaceState` (per Chunk 0).
- [ ] On page load, read `?difficulty=` (if present) and pre-select that chip
      before first render, so deep links work.
- [ ] Server-rendered grid (`homeTopicCards()`) stays unfiltered — the filter
      is a progressive-enhancement layer on top, consistent with how progress
      badges already work (`CLAUDE.md`: "leave the server-rendered cards
      intact if that fetch fails").

### 4. Tests (`test/worker.test.mjs`)
- [ ] Update/add a `topicCard()` unit test asserting the badge class matches
      `difficulty.toLowerCase()` for a mocked Intermediate/Advanced topic
      object (not just the current all-Beginner data).
- [ ] No API contract change — `/api/topics` already includes `difficulty`,
      no new test needed there.

### 5. Docs
- [ ] `README.md`/`CLAUDE.md`: minor note that difficulty badges are
      data-driven and the grid supports filtering, if either doc gets a
      features list refresh.

### 6. Deploy
- [ ] No schema/migration — pure code change.
- [ ] Verify: with at least one non-Beginner topic present (coordinate with
      [[plan-intermediate-track]], or temporarily flip one existing topic's
      `difficulty` locally to test), confirm the badge renders the right
      color/text in all three card locations and the filter chips correctly
      narrow the grid.

---

## Suggested build order
1. CSS class + 3-site badge fix (small, independently shippable, fixes a
   latent bug even before any Intermediate/Advanced topic exists).
2. Filter UI, once step 1 is verified.

This plan has no hard dependency on [[plan-intermediate-track]] — it can ship
first and just have no visible effect until non-Beginner topics exist, or
ship together in the same PR as the first new topic.
