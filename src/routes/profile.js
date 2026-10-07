import { jsonResponse, base64ImageMatchesType } from '../lib/http.js';
import { getSession, refreshRoleIfStale } from '../lib/auth.js';
import { leaderboardRank } from '../lib/util.js';
import { pathwayBadges } from '../data/topics.js';

// Profile API — account details + visibility toggle (GET/POST /api/profile*).
export async function handleProfileRoutes(request, env, url, path, secureCookie) {
  // GET /api/profile — account details + quiz room attempt history
  if (path === '/api/profile' && request.method === 'GET') {
    if (!env.JWT_SECRET || !env.DB) return jsonResponse({ error: 'Server not configured' }, 503);
    const session = await getSession(request, env);
    if (!session) return jsonResponse({ error: 'Not authenticated' }, 401);

    const user = await env.DB.prepare(
      'SELECT id, username, role, avatar, created_at, is_public, email, email_pending, discord_id, discord_username FROM users WHERE id = ?'
    ).bind(session.sub).first();
    if (!user) return jsonResponse({ error: 'Not authenticated' }, 401);

    const { role, cookie } = await refreshRoleIfStale(env, session, user.role, secureCookie);
    const profileExtraHeaders = cookie ? { 'Set-Cookie': cookie } : {};

    const { results: roomAttempts } = await env.DB.prepare(`
      SELECT r.title, r.code, a.score, a.total, a.completed_at,
             (SELECT COUNT(*) FROM quiz_room_answers ans
               WHERE ans.attempt_id = a.id AND ans.is_correct IS NULL) AS pending
      FROM quiz_room_attempts a
      JOIN quiz_rooms r ON r.id = a.room_id
      WHERE a.user_id = ?
      ORDER BY a.completed_at DESC
    `).bind(session.sub).all();

    // Pathway badges: a stage's badge is earned once all its topics are done.
    const { results: prog } = await env.DB.prepare(
      'SELECT topic_id FROM quiz_results WHERE user_id = ?'
    ).bind(session.sub).all();
    const doneTopics = new Set((prog ?? []).map(r => String(r.topic_id)));

    // Leaderboard ranks (module completion + quiz rooms). Guests are unranked.
    const isGuest = role === 'guest';
    const rank = isGuest ? null : await leaderboardRank(env, 'quiz_results', session.sub, user.username);
    const roomRank = isGuest ? null : await leaderboardRank(env, 'quiz_room_attempts', session.sub, user.username);

    return jsonResponse({
      id: user.id,
      username: user.username,
      role,
      avatar: user.avatar ?? null,
      created_at: user.created_at,
      isPublic: !!user.is_public,
      email: user.email ?? null,
      emailPending: user.email_pending ?? null,
      roomAttempts: roomAttempts ?? [],
      badges: pathwayBadges(doneTopics),
      rank,
      roomRank,
      discordLinked: !!user.discord_id,
      discordUsername: user.discord_username ?? null,
    }, 200, profileExtraHeaders);
  }

  // POST /api/profile/visibility — toggle whether other logged-in users can
  // view this profile at /u/:username. Mutates only the caller's own row.
  if (path === '/api/profile/visibility' && request.method === 'POST') {
    if (!env.JWT_SECRET || !env.DB) return jsonResponse({ error: 'Server not configured' }, 503);
    const session = await getSession(request, env);
    if (!session) return jsonResponse({ error: 'Not authenticated' }, 401);
    if (session.role === 'guest') return jsonResponse({ error: 'Guests cannot have a public profile' }, 403);

    let body;
    try { body = await request.json(); } catch { return jsonResponse({ error: 'Invalid request body' }, 400); }
    const { isPublic } = body ?? {};
    if (typeof isPublic !== 'boolean') return jsonResponse({ error: 'isPublic (boolean) required' }, 400);

    await env.DB.prepare('UPDATE users SET is_public = ? WHERE id = ?')
      .bind(isPublic ? 1 : 0, session.sub).run();
    return jsonResponse({ isPublic });
  }

  // POST /api/profile/avatar — set profile picture (small data-URL image)
  // DELETE /api/profile/avatar — reset to default
  if (path === '/api/profile/avatar' && (request.method === 'POST' || request.method === 'DELETE')) {
    if (!env.JWT_SECRET || !env.DB) return jsonResponse({ error: 'Server not configured' }, 503);
    const session = await getSession(request, env);
    if (!session) return jsonResponse({ error: 'Not authenticated' }, 401);

    if (request.method === 'DELETE') {
      await env.DB.prepare('UPDATE users SET avatar = NULL WHERE id = ?').bind(session.sub).run();
      return jsonResponse({ ok: true, avatar: null });
    }

    let body;
    try { body = await request.json(); } catch { return jsonResponse({ error: 'Invalid request body' }, 400); }
    const { avatar } = body ?? {};
    if (typeof avatar !== 'string') return jsonResponse({ error: 'Avatar image required' }, 400);
    if (avatar.length > 150_000) return jsonResponse({ error: 'Image too large' }, 400);
    const avatarMatch = avatar.match(/^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/]+={0,2})$/);
    if (!avatarMatch) {
      return jsonResponse({ error: 'Invalid image format' }, 400);
    }
    // Verify the decoded bytes really are the declared image type — reject any
    // non-image content smuggled under an image MIME label.
    if (!base64ImageMatchesType(avatarMatch[2], avatarMatch[1])) {
      return jsonResponse({ error: 'File is not a valid image' }, 400);
    }

    await env.DB.prepare('UPDATE users SET avatar = ? WHERE id = ?').bind(avatar, session.sub).run();
    return jsonResponse({ ok: true, avatar });
  }

  return null;
}
