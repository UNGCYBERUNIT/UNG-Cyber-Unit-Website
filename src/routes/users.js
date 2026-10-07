import { jsonResponse, notFoundResponse } from '../lib/http.js';
import { getSession, requireRole, ROLE_RANK } from '../lib/auth.js';
import { leaderboardRank } from '../lib/util.js';
import { pathwayBadges } from '../data/topics.js';
import { CHALLENGE_PARTS, CHALLENGE_PART_POINTS } from '../data/challenges.js';

// Public user lookup, member directory, and the module/room/CTF leaderboards.
export async function handleUserRoutes(request, env, url, path, secureCookie) {
  // GET /api/user/:username — the public subset of a profile, for other
  // logged-in users viewing /u/:username. Whitelisted fields only, and only
  // when the target has opted in via is_public — except for admins, who can
  // open any profile from the admin panel regardless of that toggle. Never
  // exposes quiz-room history, per-topic quiz progress, or the verified
  // email address itself — only the resulting isStudent badge — even to admins.
  const publicUserMatch = path.match(/^\/api\/user\/([a-zA-Z0-9_]{3,20})$/);
  if (publicUserMatch && request.method === 'GET') {
    if (!env.DB) return jsonResponse({ error: 'Server not configured' }, 503);
    const target = await env.DB.prepare(
      'SELECT id, username, role, avatar, created_at, is_public FROM users WHERE username = ?'
    ).bind(publicUserMatch[1]).first();
    if (!target || target.role === 'guest') return jsonResponse({ error: 'User not found' }, 404);
    const viewer = await getSession(request, env);
    if (!target.is_public && viewer?.role !== 'admin') return jsonResponse({ error: 'This profile is private' }, 403);

    const { results: prog } = await env.DB.prepare(
      'SELECT topic_id FROM quiz_results WHERE user_id = ?'
    ).bind(target.id).all();
    const doneTopics = new Set((prog ?? []).map(r => String(r.topic_id)));

    return jsonResponse({
      username: target.username,
      avatar: target.avatar ?? null,
      created_at: target.created_at,
      badges: pathwayBadges(doneTopics),
      rank: await leaderboardRank(env, 'quiz_results', target.id, target.username),
      roomRank: await leaderboardRank(env, 'quiz_room_attempts', target.id, target.username),
      isStudent: (ROLE_RANK[target.role] ?? 0) >= ROLE_RANK.student,
    });
  }

  // GET /api/members?role=&page=&limit= — browsable directory of opted-in
  // public profiles. Different in kind from /api/user/:username (which
  // looks up one already-known username): this is the first endpoint that
  // enumerates every is_public user, so it's gated the same way every other
  // member-facing list is (requireRole 'member', excludes guests) and the
  // query filters to is_public = 1 at the SQL level — never fetched then
  // filtered client-side. Reuses /api/user/:username's exact field
  // whitelist (username, avatar, created_at, badges, rank, roomRank,
  // isStudent) for every row — no parallel "directory summary" shape.
  if (path === '/api/members' && request.method === 'GET') {
    if (!env.JWT_SECRET || !env.DB) return jsonResponse({ error: 'Server not configured' }, 503);
    const session = await requireRole(request, env, 'member');
    if (session instanceof Response) return session;

    const VALID_ROLES = ['member', 'student', 'instructor', 'admin'];
    const roleFilter = url.searchParams.get('role');
    if (roleFilter && !VALID_ROLES.includes(roleFilter)) {
      return jsonResponse({ error: 'Invalid role filter' }, 400);
    }
    const limit = Math.min(Math.max(parseInt(url.searchParams.get('limit'), 10) || 20, 1), 50);
    const page = Math.max(parseInt(url.searchParams.get('page'), 10) || 1, 1);
    const offset = (page - 1) * limit;

    const roleClause = roleFilter ? 'AND role = ?' : '';
    const roleBind = roleFilter ? [roleFilter] : [];

    const { results: rows } = await env.DB.prepare(
      `SELECT id, username, avatar, created_at, role FROM users WHERE is_public = 1 ${roleClause} ORDER BY username ASC LIMIT ? OFFSET ?`
    ).bind(...roleBind, limit, offset).all();

    const totalRow = await env.DB.prepare(
      `SELECT COUNT(*) AS total FROM users WHERE is_public = 1 ${roleClause}`
    ).bind(...roleBind).first();

    const members = await Promise.all((rows ?? []).map(async u => {
      const { results: prog } = await env.DB.prepare(
        'SELECT topic_id FROM quiz_results WHERE user_id = ?'
      ).bind(u.id).all();
      const doneTopics = new Set((prog ?? []).map(r => String(r.topic_id)));
      return {
        username: u.username,
        avatar: u.avatar ?? null,
        created_at: u.created_at,
        badges: pathwayBadges(doneTopics),
        rank: await leaderboardRank(env, 'quiz_results', u.id, u.username),
        roomRank: await leaderboardRank(env, 'quiz_room_attempts', u.id, u.username),
        isStudent: (ROLE_RANK[u.role] ?? 0) >= ROLE_RANK.student,
      };
    }));

    return jsonResponse({ members, total: totalRow?.total ?? 0, page, limit });
  }

  // GET /api/leaderboard?mode=modules|rooms — top performers. "modules" ranks
  // by topic-quiz points, "rooms" by quiz-room points. Guests are excluded.
  if (path === '/api/leaderboard' && request.method === 'GET') {
    if (!env.JWT_SECRET || !env.DB) return jsonResponse({ error: 'Server not configured' }, 503);
    const session = await getSession(request, env);
    if (!session) return jsonResponse({ error: 'Not authenticated' }, 401);

    const mode = url.searchParams.get('mode') === 'rooms' ? 'rooms' : 'modules';
    const src = mode === 'rooms'
      ? { table: 'quiz_room_attempts', join: 'a.user_id', score: 'a.score', total: 'a.total', unit: 'a.id' }
      : { table: 'quiz_results', join: 'q.user_id', score: 'q.score', total: 'q.total', unit: 'q.topic_id' };
    const t = mode === 'rooms' ? 'a' : 'q';

    const { results: top } = await env.DB.prepare(`
      SELECT u.username,
             u.avatar,
             SUM(${src.score}) AS points,
             COUNT(${src.unit}) AS count,
             SUM(CASE WHEN ${src.score} = ${src.total} THEN 1 ELSE 0 END) AS perfect
      FROM users u
      JOIN ${src.table} ${t} ON ${src.join} = u.id
      WHERE u.role != 'guest'
      GROUP BY u.id
      ORDER BY points DESC, count DESC, u.username ASC
      LIMIT 10
    `).all();

    const meRow = await env.DB.prepare(
      `SELECT SUM(score) AS points, COUNT(*) AS count FROM ${src.table} WHERE user_id = ?`
    ).bind(session.sub).first();

    return jsonResponse({
      mode,
      top: (top ?? []).map((r, i) => ({
        rank: i + 1, username: r.username, avatar: r.avatar ?? null, points: r.points ?? 0, count: r.count ?? 0, perfect: r.perfect ?? 0,
      })),
      me: {
        username: session.username,
        points: meRow?.points ?? 0,
        count: meRow?.count ?? 0,
        isGuest: (session.role ?? 'member') === 'guest',
      },
    });
  }

  // GET /api/ctf-leaderboard — top performers across all CTF challenge
  // modules, difficulty-weighted points (CHALLENGE_PART_POINTS). Same
  // auth/guest-exclusion shape as /api/leaderboard above, but
  // challenge_completions has no score column, so points are computed
  // here in JS rather than summed in SQL. Powers the leaderboard shown on
  // the /challenges hub.
  if (path === '/api/ctf-leaderboard' && request.method === 'GET') {
    if (!env.JWT_SECRET || !env.DB) return jsonResponse({ error: 'Server not configured' }, 503);
    const session = await getSession(request, env);
    if (!session) return jsonResponse({ error: 'Not authenticated' }, 401);

    const { results: rows } = await env.DB.prepare(`
      SELECT u.id AS user_id, u.username, u.avatar, cc.challenge_id, cc.part_id
      FROM challenge_completions cc
      JOIN users u ON u.id = cc.user_id
      WHERE u.role != 'guest'
    `).all();

    const byUser = new Map();
    for (const r of rows ?? []) {
      const points = CHALLENGE_PART_POINTS[r.challenge_id]?.[r.part_id] ?? 0;
      if (!byUser.has(r.user_id)) {
        byUser.set(r.user_id, { username: r.username, avatar: r.avatar ?? null, points: 0, count: 0 });
      }
      const entry = byUser.get(r.user_id);
      entry.points += points;
      entry.count += 1;
    }

    const ranked = [...byUser.values()].sort((a, b) =>
      b.points - a.points || b.count - a.count || a.username.localeCompare(b.username)
    );
    const myIndex = ranked.findIndex(r => r.username === session.username);

    return jsonResponse({
      top: ranked.slice(0, 10).map((r, i) => ({ rank: i + 1, ...r })),
      me: {
        username: session.username,
        points: myIndex === -1 ? 0 : ranked[myIndex].points,
        count: myIndex === -1 ? 0 : ranked[myIndex].count,
        rank: myIndex === -1 ? null : myIndex + 1,
        isGuest: (session.role ?? 'member') === 'guest',
      },
    });
  }

  // GET /api/challenges/:id/leaderboard — top performers for a single CTF
  // module. Ranked by parts completed, not points — within one module
  // every player is racing the same fixed part set, so a simple "how much
  // of it have you cleared" count is the honest metric; ties broken by
  // who most recently completed a part first (earliest finisher wins).
  const ctfModuleLeaderboardMatch = path.match(/^\/api\/challenges\/([a-z0-9-]+)\/leaderboard$/);
  if (ctfModuleLeaderboardMatch && request.method === 'GET') {
    if (!env.JWT_SECRET || !env.DB) return jsonResponse({ error: 'Server not configured' }, 503);
    const session = await getSession(request, env);
    if (!session) return jsonResponse({ error: 'Not authenticated' }, 401);

    const challengeId = ctfModuleLeaderboardMatch[1];
    const totalParts = CHALLENGE_PARTS[challengeId]?.length ?? 0;
    if (!totalParts) return notFoundResponse();

    const { results: rows } = await env.DB.prepare(`
      SELECT u.username, u.avatar, COUNT(*) AS count, MAX(cc.completed_at) AS last_at
      FROM challenge_completions cc
      JOIN users u ON u.id = cc.user_id
      WHERE cc.challenge_id = ? AND u.role != 'guest'
      GROUP BY u.id
      ORDER BY count DESC, last_at ASC, u.username ASC
      LIMIT 10
    `).bind(challengeId).all();

    const meRow = await env.DB.prepare(
      'SELECT COUNT(*) AS count FROM challenge_completions WHERE user_id = ? AND challenge_id = ?'
    ).bind(session.sub, challengeId).first();

    return jsonResponse({
      challengeId,
      totalParts,
      top: (rows ?? []).map((r, i) => ({
        rank: i + 1, username: r.username, avatar: r.avatar ?? null, count: r.count, complete: r.count >= totalParts,
      })),
      me: {
        username: session.username,
        count: meRow?.count ?? 0,
        complete: (meRow?.count ?? 0) >= totalParts,
        isGuest: (session.role ?? 'member') === 'guest',
      },
    });
  }

  return null;
}
