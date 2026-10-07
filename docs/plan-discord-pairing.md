# Plan: Discord Account Pairing

**Goal:** let a member link their `ungcyberunit.org` account to their Discord
account, so the Discord bot ([`cyber_discord_bot`](https://github.com/J-Acklen/cyber_discord_bot),
a separate repo) can show their website progress on request and auto-grant a
Discord role ("Pathfinder") on completing the Beginner Pathway.

**Status:** **Done — shipped 2026-09-17.** Real Discord OAuth (`identify`
scope) linking is live end-to-end; see `CLAUDE.md`'s "Discord account
pairing" section for the current behavior. Cross-repo: this doc covers both
the website changes (this repo) and the companion bot changes (the other
repo, summarized in full at the end since its own README lives there).

---

## Why this is simpler than it might look

The bot already has two similar integrations (pwn.college, and a since-parked
Hack The Box attempt), both of which had to invent a low-trust "paste a code
into your public bio" verification trick because that Claude session didn't
control the other platform's codebase. **We control both sides here** — the
right tool is a real Discord OAuth ("Login with Discord") flow, not a code-
pasting trick. Discord proves the identity cryptographically; no scraping, no
bio fields, no manual code entry.

---

## Chunk 0 — DECISIONS

- [x] **Public vs. owner-only visibility of the Discord link:** owner-only,
      per this repo's existing privacy stance (even public profiles at
      `/u/:username` exclude quiz history) — resolved 2026-09-17. `/api/user/
      :username`'s whitelist is **not** touched by this plan at all.
- [x] **Auto-role granting:** yes — completing the Beginner Pathway
      auto-grants a Discord role named "Pathfinder" (role ID
      `1549993693438672996`, lives in the bot's `.env`, not this repo).
- [x] **"Pathfinder" completion definition:** all 6 `pathwayStages` earned
      (i.e. `pathwayBadges(doneTopics).every(b => b.earned)`) — resolved
      2026-09-17. Reuses the exact `pathwayBadges()` helper with zero new
      logic.
- [x] **Bulk vs. per-member polling for the bot's background role-check:**
      bulk — resolved 2026-09-17. A dedicated bulk endpoint (`GET
      /api/bot/pathfinder-status`) returns `{discord_id, complete}` for every
      linked account in one D1 query, rather than the bot looping `GET
      /api/bot/progress/:discord_id` once per guild member.
- [x] **Does unlinking Discord revoke a previously-granted role?** No —
      resolved 2026-09-17. Matches the pwn.college integration's existing
      behavior (additive-only, no auto-revoke).
- [x] **`DISCORD_CLIENT_ID` as a plain var or a secret?** Plain `[vars]`
      entry in `wrangler.toml` — resolved 2026-09-17. Only
      `DISCORD_CLIENT_SECRET` and the new `BOT_API_SECRET` are secrets.
- [x] **"Link Discord" UI placement:** the existing `// Account` section on
      `/profile`, alongside email verification — consistent with how that
      section already mixes identity-linking controls.

---

## Session learnings / project gotchas (READ FIRST)

- **Reuse `signJWT`/`verifyJWT` for the OAuth `state` param** (~line 1396/1410
  in `worker.js`) — don't add a new signing mechanism. A short-lived (5 min)
  signed payload `{ sub: session.sub, exp: ... }` bound to the initiating
  session is exactly what OAuth's `state` param is for (CSRF protection: it
  proves the callback belongs to the browser that started the flow, not an
  attacker's crafted callback hit). This is the same pattern pwn.college's own
  Discord-linking code uses server-side (`itsdangerous.URLSafeTimedSerializer`
  in their `dojo_plugin/pages/discord.py`, for anyone curious) — nothing novel
  here, just Cloudflare-native primitives instead of Python's.
- **`GET /api/discord/link/start` must be a real navigation, not a fetch.**
  It has to redirect the browser to `discord.com/api/oauth2/authorize`, which
  only works as a top-level navigation (`window.location.href = ...` or a
  plain `<a href>`), not an XHR/`fetch()` call — Discord's login page can't
  render inside a fetch response. Client-side, this is a plain link/button
  that navigates, not a `main.js` fetch-and-render pattern like everything
  else on `/profile`.
- **New D1 columns, not a new table.** `discord_id`/`discord_username`/
  `discord_linked_at` are 1:1 with a `users` row, same shape as the existing
  `email`/`email_verify_*` columns — add them to `users` directly, mirroring
  that pattern (including a partial unique index, since `email` already does
  exactly this: `CREATE UNIQUE INDEX ... WHERE email IS NOT NULL`).
- **The bot-facing endpoints are a new trust boundary.** `/api/bot/progress/
  :discord_id` and `/api/bot/pathfinder-status` aren't browser-session-gated
  (the bot has no user login) — they're gated by a shared secret header
  instead (new `BOT_API_SECRET`, set via `wrangler secret put` here and as
  `WEBSITE_API_SECRET` in the bot's `.env` — same value, different var names
  since each repo's naming convention differs). Compare it with a constant-
  time check, not `===`, since this is a bearer-secret comparison over the
  network (the existing JWT verification already does the crypto-safe
  equivalent via `crypto.subtle.verify` — for a raw string compare instead,
  use `crypto.subtle.timingSafeEqual` if available in the Workers runtime, or
  hash both sides with a fixed key via `crypto.subtle.sign('HMAC', ...)`
  before comparing, to sidestep the question entirely).
- **These bot-facing routes must return the SAME whitelist discipline as
  `/api/user/:username`.** Per `CLAUDE.md`'s existing warning on that
  endpoint: never return email, role, id, or anything beyond what's needed
  (username, avatar, badges, ranks, streak, and — for `pathfinder-status`
  only — the boolean completion flag). This is a second public-ish surface
  with the same leakage risk as the first; hold it to the same bar.
- **Local OAuth testing needs a second redirect URI.** Discord allows
  `http://localhost:PORT/...` as a valid OAuth redirect URI alongside the
  production one — register both
  (`https://ungcyberunit.org/api/discord/callback` and
  `http://localhost:8787/api/discord/callback`, matching `wrangler dev`'s
  default port) in the Discord Developer Portal's OAuth2 settings so this is
  fully testable locally, not just against the deployed preview.
- **`/api/discord/*` and `/api/bot/*` need no `wrangler.toml` changes.**
  `run_worker_first` is only for *static* HTML pages bypassing the worker
  (per `CLAUDE.md`) — `/api/*` paths already always hit the worker's `fetch`
  handler regardless.
- **Schema migration timing** — same rule as every other change here: run the
  `ALTER TABLE`/`CREATE INDEX` on **both** `--local` and `--remote` D1 before
  the deploy that depends on the new columns lands.

### Where this plugs into what already exists
- `pathwayBadges(doneTopicIds)` (~line 946) — reuse directly for both the
  owner's `/api/profile` response and the new bot-facing progress endpoint.
- `leaderboardRank(env, table, userId, username)` — reuse for `rank`/
  `roomRank` in the bot-facing progress endpoint, same as `/api/profile`
  already does.
- `requireRole(request, env, minRole)` — use `'member'` (excludes guests) to
  gate `/api/discord/link/start` and `/api/discord/unlink`, same pattern as
  every other member-only endpoint.
- `/api/profile`'s existing shape (~line 2261) — add `discordLinked` (bool)
  and `discordUsername` (string or null) to its response object; no other
  field changes.

---

## Architecture

```
Member clicks "Link Discord" on /profile
  → GET /api/discord/link/start (member-gated)
  → 302 to discord.com/api/oauth2/authorize?client_id=...&state=<signed JWT>&scope=identify
  → member approves on Discord's own page
  → Discord redirects to /api/discord/callback?code=...&state=...
  → verify state (signature + expiry + matches a real session.sub)
  → exchange code for a Discord access token (POST discord.com/api/oauth2/token)
  → GET discord.com/api/users/@me with that token → { id, username }
  → UPDATE users SET discord_id=?, discord_username=?, discord_linked_at=? WHERE id = <state.sub>
  → redirect to /profile?discord=linked

Discord bot, on-demand (/website stats command):
  → GET /api/bot/progress/:discord_id  (header: X-Bot-Secret)
  → { username, avatar, badges, rank, roomRank, streak } or 404 if unlinked

Discord bot, background loop (every few hours, mirrors pwncollege.py's pattern):
  → GET /api/bot/pathfinder-status  (header: X-Bot-Secret)
  → [{ discord_id, complete }, ...] for every linked, non-guest account
  → for each complete=true member without the role yet, add_roles(Pathfinder)
```

No linking-code table is needed on the bot's side at all for this feature —
unlike `pwncollege_links`, the website is the durable source of truth for the
pairing. The bot only needs to remember which Discord users it has *already
granted* the role to, to avoid redundant `add_roles` calls — a small local
set/table, detailed in the bot-side section below.

---

## Implementation checklist (this repo)

### 1. Data model + migration
- [ ] `schema.sql`, on `users`:
      ```sql
      ALTER TABLE users ADD COLUMN discord_id TEXT;
      ALTER TABLE users ADD COLUMN discord_username TEXT;
      ALTER TABLE users ADD COLUMN discord_linked_at INTEGER;
      CREATE UNIQUE INDEX IF NOT EXISTS idx_users_discord_id
        ON users(discord_id) WHERE discord_id IS NOT NULL;
      ```
      (unique index prevents two website accounts claiming the same Discord
      account — same shape as the existing `idx_users_email` index).
- [ ] Migrate local, then **remote before deploy** (standard rule here).

### 2. Secrets + config
- [ ] Discord Developer Portal (existing bot application, OAuth2 tab):
      add redirect URIs `https://ungcyberunit.org/api/discord/callback` and
      `http://localhost:8787/api/discord/callback`; copy the Client ID and
      generate/copy the Client Secret.
- [ ] `wrangler.toml`: add `[vars] DISCORD_CLIENT_ID = "..."`.
- [ ] `wrangler secret put DISCORD_CLIENT_SECRET` (local: add to `.dev.vars`).
- [ ] `wrangler secret put BOT_API_SECRET` — a fresh random long string
      (e.g. `openssl rand -hex 32`), shared with the bot's `.env` as
      `WEBSITE_API_SECRET` (same value, different name per repo convention).
- [ ] `.dev.vars.example`: document all three new vars.

### 3. Server (`worker.js`)
- [ ] `GET /api/discord/link/start` — `requireRole(request, env, 'member')`,
      builds signed state via `signJWT({ sub: session.sub, exp: now+300 },
      env.JWT_SECRET)`, 302 redirect to Discord's authorize URL
      (`response_type=code&scope=identify`).
- [ ] `GET /api/discord/callback` — verify `state` via `verifyJWT`, reject if
      invalid/expired; exchange `code` for a token (`POST
      discord.com/api/oauth2/token`, `grant_type=authorization_code`); fetch
      `GET discord.com/api/users/@me`; `UPDATE users SET discord_id=?,
      discord_username=?, discord_linked_at=? WHERE id = ?` bound to
      `state.sub` only; handle "this Discord account is already linked to a
      different website account" (unique constraint failure) with a clear
      redirect state, not a raw 500.
- [ ] `POST /api/discord/unlink` — `requireRole(request, env, 'member')`,
      clears all three columns **only for `session.sub`**.
- [ ] `/api/profile`: add `discordLinked: !!user.discord_id` and
      `discordUsername: user.discord_username ?? null` to the response;
      update the `SELECT` to include `discord_id, discord_username`.
- [ ] `GET /api/bot/progress/:discord_id` — `X-Bot-Secret` header check
      (constant-time compare against `env.BOT_API_SECRET`); look up user by
      `discord_id`; 404 if none; return `{ username, avatar, badges (via
      pathwayBadges), rank, roomRank, streak }` — same whitelist discipline
      as `/api/user/:username`.
- [ ] `GET /api/bot/pathfinder-status` — same secret check; one query joining
      `users` (non-guest, `discord_id IS NOT NULL`) against `quiz_results` to
      compute each user's `doneTopics`, then `pathwayBadges(...).every(b =>
      b.earned)` per user; return `[{ discord_id, complete }, ...]`.

### 4. Client — profile page
- [ ] `// Account` section on `/profile` (in `main.js`'s
      `loadProfileAccount()`, not baked into `profile.html`, matching the
      visibility-toggle precedent): when `!discordLinked`, a "Link Discord"
      button/link navigating to `/api/discord/link/start`; when linked, show
      `Linked as {discordUsername}` + an "Unlink" button posting to
      `/api/discord/unlink` and refreshing the section on success.
- [ ] Handle the `/profile?discord=linked` / `?discord=error` query-param
      landing state (from the callback's redirect) with a brief toast/banner,
      then strip the query param from the URL.

### 5. Tests (`test/worker.test.mjs`)
- [ ] `GET /api/discord/link/start`: requires session, rejects guests, 302 to
      a URL containing the right `client_id`/`scope`, state is a valid JWT
      encoding the caller's `sub`.
- [ ] `GET /api/discord/callback`: rejects missing/invalid/expired state,
      updates only the row matching `state.sub`, handles the duplicate-
      discord_id case without a raw 500.
- [ ] `POST /api/discord/unlink`: requires session, mutates only the caller's
      row (assert via mock DB bindings, same pattern as the visibility test).
- [ ] `GET /api/bot/progress/:discord_id`: 401 without/with wrong secret, 404
      unknown discord_id, correct whitelist shape when found (assert no
      `email`/`role`/`id` leak, mirroring the `/api/user/:username` tests).
- [ ] `GET /api/bot/pathfinder-status`: 401 without secret, correct
      `complete` boolean for a fixture user with all/some/no stages done.

### 6. Docs
- [ ] `README.md`: add the new routes to the Routes tables.
- [ ] `CLAUDE.md`: note the `discord_id` unique-index convention (parallels
      the existing `email` note) and that `/api/bot/*` is a second
      whitelist-disciplined surface alongside `/api/user/:username`.

### 7. Deploy
- [ ] Remote migration first → set all three secrets/vars on the deployed
      Worker → commit + push → verify: full link flow end-to-end against the
      live site (not just `wrangler dev`, since Discord's redirect needs a
      real reachable URL for the production check), unlink works, bot-facing
      endpoints respond correctly with `curl` + the real `BOT_API_SECRET`.

---

## Companion bot-side changes (separate repo: `cyber_discord_bot`)

Full detail belongs in that repo's own README when this is built, but
summarized here so this plan is a complete picture:

- New `WEBSITE_API_SECRET` and `WEBSITE_API_BASE` (`https://ungcyberunit.org`)
  entries in `.env`/`.env.example`, plus `PATHFINDER_ROLE_ID=1549993693438672996`.
- New `cogs/website.py`, following the exact structural conventions of
  `cogs/pwncollege.py` (aiohttp session lifecycle in `cog_load`/`cog_unload`,
  a `WebsiteError` exception class, `tasks.loop` for the background check).
- `/website stats [member]` — calls `GET /api/bot/progress/:discord_id`
  (member's own Discord ID — no linking-code step needed on the bot side at
  all, since the website already knows the pairing); shows a "not linked yet
  - visit ungcyberunit.org/profile" message on 404.
- Background `tasks.loop` (6h, matching `pwncollege.py`'s existing cadence)
  calling `GET /api/bot/pathfinder-
  status`, granting `PATHFINDER_ROLE_ID` to any `complete: true` member who
  doesn't already have it. Needs a small local table (or just check
  `role in member.roles` directly, same as `_maybe_grant_role` in
  `pwncollege.py` already does) to avoid redundant grants — no need to
  duplicate the website's own `discord_id` mapping in bot-side SQLite at all.
- No `/website link`/`/website verify` commands needed — reusing the
  pwn.college linking-code UX here would be *strictly worse* than what OAuth
  already gives us, not a feature parity gap.

---

## Suggested build order
1. Migration + secrets/config + the OAuth link/callback/unlink routes +
   minimal `/profile` UI — proves the pairing works end-to-end before
   touching the bot at all.
2. `/api/bot/progress/:discord_id` + the bot's `/website stats` command —
   proves the second leg (bot reading website data) independently.
3. `/api/bot/pathfinder-status` + the bot's background auto-role loop — the
   most novel piece (bulk cross-repo polling), saved for last once both
   simpler legs are proven.

**Biggest real risk:** the OAuth `state`/CSRF handling (#1) and the
bot-facing endpoints' whitelist discipline (#2/#3) — both are new trust
boundaries this codebase hasn't had before (every previous auth surface was
either a full browser session or nothing). Everything else here is
composition of already-shipped, already-tested helpers.
