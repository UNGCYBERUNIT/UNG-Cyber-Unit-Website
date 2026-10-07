import { jsonResponse } from '../lib/http.js';
import { signJWT, verifyJWT, requireRole, checkBotSecret } from '../lib/auth.js';
import { leaderboardRank } from '../lib/util.js';
import { pathwayBadges } from '../data/topics.js';

// Discord Account Pairing (see docs/plan-discord-pairing.md) — OAuth
// link/callback/unlink, plus the bot-secret-gated read API the Discord bot
// polls (progress lookup + bulk pathfinder-status).
export async function handleDiscordRoutes(request, env, url, path, secureCookie) {
  // GET /api/discord/link/start — begins the OAuth flow. Member-gated (no
  // guests, same as the visibility toggle). The `state` param is a
  // short-lived signed JWT binding this flow to the caller's own session —
  // standard OAuth CSRF protection, reusing signJWT/verifyJWT rather than a
  // new signing mechanism. redirect_uri is derived from the request's own
  // origin so this works unmodified in both local dev and production, as
  // long as both are registered in the Discord Developer Portal.
  if (path === '/api/discord/link/start' && request.method === 'GET') {
    if (!env.JWT_SECRET) return jsonResponse({ error: 'Server not configured' }, 503);
    if (!env.DISCORD_CLIENT_ID) return jsonResponse({ error: 'Discord linking is not configured yet' }, 503);
    const session = await requireRole(request, env, 'member');
    if (session instanceof Response) return session;

    const state = await signJWT(
      { sub: session.sub, exp: Math.floor(Date.now() / 1000) + 300 },
      env.JWT_SECRET
    );
    const redirectUri = `${url.origin}/api/discord/callback`;
    const authorizeUrl = new URL('https://discord.com/api/oauth2/authorize');
    authorizeUrl.searchParams.set('client_id', env.DISCORD_CLIENT_ID);
    authorizeUrl.searchParams.set('redirect_uri', redirectUri);
    authorizeUrl.searchParams.set('response_type', 'code');
    authorizeUrl.searchParams.set('scope', 'identify');
    authorizeUrl.searchParams.set('state', state);

    return new Response(null, { status: 302, headers: { Location: authorizeUrl.toString() } });
  }

  // GET /api/discord/callback — Discord redirects here after the member
  // approves (or denies) the OAuth prompt. Never mutates on a bare GET from
  // an untrusted party without a valid, unexpired `state` — that's the only
  // proof this callback belongs to a session we started.
  if (path === '/api/discord/callback' && request.method === 'GET') {
    if (!env.JWT_SECRET || !env.DB) return jsonResponse({ error: 'Server not configured' }, 503);
    if (!env.DISCORD_CLIENT_ID || !env.DISCORD_CLIENT_SECRET) {
      return jsonResponse({ error: 'Discord linking is not configured yet' }, 503);
    }

    const code = url.searchParams.get('code');
    const state = url.searchParams.get('state');
    if (!code || !state) return Response.redirect(`${url.origin}/profile?discord=error`, 302);

    const statePayload = await verifyJWT(state, env.JWT_SECRET);
    if (!statePayload?.sub) return Response.redirect(`${url.origin}/profile?discord=error`, 302);

    const redirectUri = `${url.origin}/api/discord/callback`;
    let discordUser;
    try {
      const tokenRes = await fetch('https://discord.com/api/oauth2/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          client_id: env.DISCORD_CLIENT_ID,
          client_secret: env.DISCORD_CLIENT_SECRET,
          grant_type: 'authorization_code',
          code,
          redirect_uri: redirectUri,
        }),
      });
      if (!tokenRes.ok) throw new Error(`token exchange failed: ${tokenRes.status}`);
      const { access_token } = await tokenRes.json();

      const meRes = await fetch('https://discord.com/api/users/@me', {
        headers: { Authorization: `Bearer ${access_token}` },
      });
      if (!meRes.ok) throw new Error(`fetching discord identity failed: ${meRes.status}`);
      discordUser = await meRes.json();
    } catch (err) {
      console.error('Discord OAuth exchange failed:', err);
      return Response.redirect(`${url.origin}/profile?discord=error`, 302);
    }

    try {
      await env.DB.prepare(
        'UPDATE users SET discord_id = ?, discord_username = ?, discord_linked_at = ? WHERE id = ?'
      ).bind(discordUser.id, discordUser.username, Date.now(), statePayload.sub).run();
    } catch (err) {
      // Most likely the partial-unique-index rejecting a discord_id already
      // claimed by a different account — a clear, specific redirect state
      // beats a raw 500 for something a member can actually understand.
      console.error('Discord link DB update failed:', err);
      return Response.redirect(`${url.origin}/profile?discord=duplicate`, 302);
    }

    return Response.redirect(`${url.origin}/profile?discord=linked`, 302);
  }

  // POST /api/discord/unlink — mutates only the caller's own row, same
  // ownership pattern as the visibility toggle above. Does not touch any
  // Discord role the bot may have already granted (see plan doc: no
  // auto-revoke on unlink, by design).
  if (path === '/api/discord/unlink' && request.method === 'POST') {
    if (!env.JWT_SECRET || !env.DB) return jsonResponse({ error: 'Server not configured' }, 503);
    const session = await requireRole(request, env, 'member');
    if (session instanceof Response) return session;

    await env.DB.prepare(
      'UPDATE users SET discord_id = NULL, discord_username = NULL, discord_linked_at = NULL WHERE id = ?'
    ).bind(session.sub).run();
    return jsonResponse({ discordLinked: false });
  }

  // GET /api/bot/progress/:discord_id — read-only progress lookup for the
  // Discord bot's /website stats command. Same whitelist discipline as
  // /api/user/:username: only username/avatar/badges/ranks/streak, never
  // email/role/id. Gated by checkBotSecret, not a browser session.
  const botProgressMatch = path.match(/^\/api\/bot\/progress\/(\d{1,25})$/);
  if (botProgressMatch && request.method === 'GET') {
    if (!env.DB) return jsonResponse({ error: 'Server not configured' }, 503);
    const secretError = checkBotSecret(request, env);
    if (secretError) return secretError;

    const target = await env.DB.prepare(
      'SELECT id, username, role, avatar, streak FROM users WHERE discord_id = ?'
    ).bind(botProgressMatch[1]).first();
    if (!target || target.role === 'guest') return jsonResponse({ error: 'No linked account found' }, 404);

    const { results: prog } = await env.DB.prepare(
      'SELECT topic_id FROM quiz_results WHERE user_id = ?'
    ).bind(target.id).all();
    const doneTopics = new Set((prog ?? []).map(r => String(r.topic_id)));

    return jsonResponse({
      username: target.username,
      avatar: target.avatar ?? null,
      streak: target.streak ?? 0,
      badges: pathwayBadges(doneTopics),
      rank: await leaderboardRank(env, 'quiz_results', target.id, target.username),
      roomRank: await leaderboardRank(env, 'quiz_room_attempts', target.id, target.username),
    });
  }

  // GET /api/bot/pathfinder-status — bulk completion check for the bot's
  // background auto-role loop (docs/plan-discord-pairing.md: bulk beats
  // per-member polling). One row per linked, non-guest account. N+1 queries
  // (one per linked user) rather than a single complex join — this club's
  // membership is small enough that this is simpler and more maintainable
  // than replicating pathwayBadges()'s logic in raw SQL.
  if (path === '/api/bot/pathfinder-status' && request.method === 'GET') {
    if (!env.DB) return jsonResponse({ error: 'Server not configured' }, 503);
    const secretError = checkBotSecret(request, env);
    if (secretError) return secretError;

    const { results: linked } = await env.DB.prepare(
      "SELECT id, discord_id FROM users WHERE discord_id IS NOT NULL AND role != 'guest'"
    ).all();

    const statuses = [];
    for (const u of (linked ?? [])) {
      const { results: prog } = await env.DB.prepare(
        'SELECT topic_id FROM quiz_results WHERE user_id = ?'
      ).bind(u.id).all();
      const doneTopics = new Set((prog ?? []).map(r => String(r.topic_id)));
      statuses.push({
        discord_id: u.discord_id,
        complete: pathwayBadges(doneTopics).every(b => b.earned),
      });
    }

    return jsonResponse({ users: statuses });
  }

  return null;
}
