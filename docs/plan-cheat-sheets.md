# Plan: Downloadable Topic Cheat-Sheets

**Goal:** a one-page PDF quick-reference per topic (or per pathway stage),
downloadable from the topic page, reusing the existing `/sop` static-PDF
pattern rather than building a PDF generator.

**Status:** **Done — shipped 2026-09-23.** `/cheatsheet/:id` delivery
mechanism is live, following the `/sop` pattern. The "Download Cheat-Sheet"
button only shows for topic ids in the `topicsWithCheatSheet` set in
worker.js — see `CLAUDE.md`'s "Adding a topic" section.

---

## Chunk 0 — DECISIONS

- [ ] **One cheat-sheet per topic, or one per pathway stage?** Per-topic is
      more files (11+) but matches learners' mental model ("I'm on this topic,
      give me its cheat-sheet"); per-stage is fewer files (6, from
      `pathwayStages`) but stages bundle 1–2 topics each, so a stage sheet
      would cover more ground per download. **Recommend per-topic** — simpler
      1:1 mapping, easiest to keep in sync as topics are added
      ([[plan-intermediate-track]] adds more later).
- [ ] **Who authors the PDFs?** This plan only covers the *delivery*
      mechanism (route, link, sitemap/robots hygiene) — actual PDF content
      creation is manual design work outside code, same as `Cyber_Unit_SOP.pdf`
      today. Confirm that's understood before scoping "done."
- [ ] **Placement on the topic page:** a "Download Cheat-Sheet" button in the
      `topic-header` meta row (next to the difficulty badge / read-time — see
      `public/topic.html` line 47), or inside the sticky TOC sidebar. Recommend
      the header — highest visibility, matches where `/sop`'s equivalent
      "SOP" link would conceptually sit if the site had one per topic.
- [ ] **Should missing cheat-sheets be tolerated?** Not every topic will have
      one on day one. Recommend the download link/button simply doesn't render
      when no sheet exists for that topic id (checked via a small lookup, not
      a 404-on-click) — cleaner UX than a broken link.

---

## Session learnings / project gotchas (READ FIRST)

- **`/sop` is the exact template to copy**, already in `worker.js`:
  - Static asset lives at `public/Cyber_Unit_SOP.pdf`.
  - `worker.js`'s dispatch (~line 3161) maps the friendly route `/sop` →
    `assetPath = '/Cyber_Unit_SOP.pdf'`, then fetches it through
    `env.ASSETS.fetch()` like any other view route.
  - `robots.txt` (~line 3080) explicitly `Disallow`s the raw
    `/Cyber_Unit_SOP.pdf` path so crawlers only index the canonical `/sop`
    URL (PDFs can't carry `<link rel="canonical">`). **Any new per-topic PDF
    needs the same treatment** — disallow the raw `/cheatsheets/*.pdf` path
    prefix, allow the friendly route.
  - `/sitemap.xml` includes `/sop` in its `paths` array manually (it's not
    derived from `topics`, since it's a single one-off page).
- **Per-topic version needs a *dynamic* route**, not N manual entries like
  `/sop`: something like `/cheatsheet/:id` matched with the same
  `path.match(/^\/cheatsheet\/(\w+)$/)` pattern already used for
  `/api/topic/:id` (~line 3111), validated against `topics.find(t => t.id
  === id)` before serving — an unknown id should 404, not silently serve
  nothing (matches the existing "unknown topic id must 404" comment at
  ~line 3186 for the topic page itself).
- **File naming convention**: store as `public/cheatsheets/<topicId>.pdf`
  (new directory) so the route handler can build the asset path
  programmatically (`` /cheatsheets/${id}.pdf ``) instead of a hardcoded
  per-topic map — one line of code covers all current and future topics.
- **Static files bypass the worker** unless routed — but this is *already*
  handled by putting the dynamic match inside the worker's existing
  dispatch (same mechanism as `/topic/:id`, `/quiz/:code`), so no
  `run_worker_first` entry is needed (that's only for *static* pages, per
  `CLAUDE.md` — dynamic paths already hit the worker).
- **Cache-Control**: unlike the HTML view routes, a cheat-sheet PDF is
  genuinely static per topic (no per-request server rendering), so it's fine
  to let it keep normal asset caching — don't strip `Cache-Control`/`ETag`
  the way the HTML-injection routes do (~line 3182); that stripping exists
  specifically because those responses have *worker-injected* per-request
  content, which a served-as-is PDF doesn't have.

---

## Implementation checklist

### 1. Assets
- [ ] Create `public/cheatsheets/` directory.
- [ ] Produce (or placeholder) PDFs for the first batch of topics —
      out-of-band design work, not blocked on code.

### 2. Server route (`worker.js`)
- [ ] Add a route match: `path.match(/^\/cheatsheet\/(\w+)$/)`, validate the
      id against `topics`, 404 if unknown, else fetch
      `` /cheatsheets/${id}.pdf `` via `env.ASSETS.fetch()` (mirroring `/sop`'s
      pattern, not the SEO-injection routes' pattern — no HTML rewriting
      needed for a PDF).
- [ ] `robots.txt`: add `Disallow: /cheatsheets/` (directory-level, covers all
      current and future files, cheaper than listing each one).
- [ ] `/sitemap.xml`: **do not** add `/cheatsheet/:id` URLs — these are
      downloadable assets linked *from* indexed topic pages, not separate
      content pages worth ranking on their own (same reasoning as `/sop`
      being manually curated rather than auto-derived).
- [ ] Gracefully skip topics with no PDF: either check file existence at
      request time (an extra `env.ASSETS.fetch` HEAD, adds latency) or
      maintain a small `topicsWithCheatSheet` Set/array literal in `worker.js`
      next to the `topics` array — recommend the latter, it's simpler and the
      list only changes when a PDF is actually added.

### 3. Client (topic page)
- [ ] `public/topic.html`: no static markup change needed if the button is
      generated client-side (consistent with how other topic-page chrome is
      built in `main.js`'s `renderTopicPage()`), or add a static placeholder
      `<a id="cheatSheetLink" ...>` in the header meta row that JS
      shows/hides — either works; recommend the static-placeholder approach
      since it's a plain `<a href>` (no click handler needed, so no CSP
      concern either way) and keeps `main.js` simpler (toggle `display`
      instead of building DOM).
- [ ] `main.js`'s `renderTopicPage()`: after fetching `/api/topic/:id`, if
      the current topic id is in the "has cheat sheet" set (exposed via
      `/api/topics`/`/api/topic/:id` as a new boolean field, e.g.
      `hasCheatSheet`), set the link's `href="/cheatsheet/${id}"` and reveal
      it; otherwise leave it hidden. This also needs `topic-render.js` or the
      `topics` array to carry that flag through to the API response — small,
      additive field, no migration (topics are in-code data).

### 4. Tests (`test/worker.test.mjs`)
- [ ] `GET /cheatsheet/:id` for a known id with a sheet → 200,
      `Content-Type: application/pdf` (mock `env.ASSETS.fetch` the same way
      existing page-render tests do).
- [ ] `GET /cheatsheet/:id` for an unknown id → 404.
- [ ] `GET /cheatsheet/:id` for a known id *without* a sheet → 404 (not a
      500 or an empty 200).
- [ ] `robots.txt` test (if one exists) asserts the new `Disallow` line.

### 5. Docs
- [ ] `README.md`: add `/cheatsheet/:id` to the Routes table, one line.
- [ ] `CLAUDE.md`: not strictly required — this follows the existing `/sop`
      pattern closely enough that a future reader can infer it, but a
      one-line pointer ("per-topic cheat-sheets follow the same pattern as
      `/sop` — see `plan-cheat-sheets.md`") would save re-discovery time.

### 6. Deploy
- [ ] No schema/migration — cheat-sheet availability can be either in-code
      data (recommended) or, if you want it toggleable without a code deploy,
      a `has_cheat_sheet` marker... but that's unnecessary complexity for a
      handful of static files; keep it in code.
- [ ] Verify: download link appears only for topics with a sheet, PDF opens
      correctly, `/cheatsheet/<bad-id>` 404s, raw `/cheatsheets/<file>.pdf`
      path still technically fetchable (like `Cyber_Unit_SOP.pdf` today) but
      excluded from robots/sitemap.

---

## Suggested build order
1. Route + robots handling for one real PDF (proves the pattern end-to-end).
2. `hasCheatSheet` field + client link toggle.
3. Batch-add PDFs for remaining topics as they're designed — no further code
   changes needed per topic, just drop a file matching `<topicId>.pdf` into
   `public/cheatsheets/` and add the id to the in-code "has sheet" list.

**Lowest-risk of the three content-depth plans** — no schema change, no new
page, entirely additive to the existing topic page.
