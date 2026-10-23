import { jsonResponse, addSecurityHeaders, parseCookies, clientIP } from '../lib/http.js';
import { escapeHtml } from '../lib/render.js';
import {
  hashPassword,
  verifyPassword,
  randomTokenHex,
  sha256Hex,
  signJWT,
  getSession,
  sessionCookie,
  deviceCookie,
  refreshRoleIfStale,
  requireRole,
  authActionPageResponse,
  GUEST_SESSION_SECONDS,
} from '../lib/auth.js';
import {
  checkSignupLimit,
  recordSignup,
  checkEmailActionLimit,
  recordEmailAction,
  checkLoginLimit,
  recordLoginFailure,
} from '../lib/ratelimit.js';
import { sendResendEmail } from '../lib/email.js';
import { dateStrUTC, nextStreak, summarizeUserAgent } from '../lib/util.js';
import { topics } from '../data/topics.js';

// Cap on how many email addresses one account can have linked at once
// (user_emails in schema.sql) — a small fixed number, enforced here rather
// than in the DB, same app-level-cap pattern as the Kanban CSV import's
// row limit.
const MAX_EMAILS_PER_USER = 3;

// Auth & Progress API — register/login/logout/sign-out-everywhere/guest/
// upgrade/me/verify-email/forgot-password/reset-password/forgot-username,
// plus per-topic quiz progress. See CLAUDE.md's auth-related sections.
export async function handleAuthRoutes(request, env, url, path, secureCookie) {
  if (!(path.startsWith('/api/auth/') || path.startsWith('/api/progress'))) return null;

  if (!env.JWT_SECRET) return jsonResponse({ error: 'Server not configured' }, 503);

  // POST /api/auth/register
  if (path === '/api/auth/register' && request.method === 'POST') {
    if (!env.DB) return jsonResponse({ error: 'Database not configured' }, 503);
    const limited = await checkSignupLimit(env, request);
    if (limited) return limited;
    let body;
    try { body = await request.json(); } catch { return jsonResponse({ error: 'Invalid request body' }, 400); }
    const { username, password } = body ?? {};
    if (!username || !password) return jsonResponse({ error: 'Username and password required' }, 400);
    if (!/^[a-zA-Z0-9_]{3,20}$/.test(username)) return jsonResponse({ error: 'Username must be 3–20 alphanumeric characters or underscores' }, 400);
    if (typeof password !== 'string' || password.length < 8) return jsonResponse({ error: 'Password must be at least 8 characters' }, 400);
    if (password.length > 128) return jsonResponse({ error: 'Password too long' }, 400);

    const existing = await env.DB.prepare('SELECT id FROM users WHERE username = ?').bind(username).first();
    if (existing) return jsonResponse({ error: 'Username already taken' }, 409);

    const hash = await hashPassword(password);
    const result = await env.DB.prepare(
      'INSERT INTO users (username, password_hash, role, created_at) VALUES (?, ?, \'member\', ?)'
    ).bind(username, hash, Date.now()).run();

    const token = await signJWT(
      { sub: result.meta.last_row_id, username, role: 'member', ver: 0, exp: Math.floor(Date.now() / 1000) + 7 * 24 * 3600 },
      env.JWT_SECRET
    );
    await recordSignup(env, request);
    return jsonResponse({ id: result.meta.last_row_id, username, role: 'member' }, 201, { 'Set-Cookie': sessionCookie(token, 7 * 24 * 3600, secureCookie) });
  }

  // POST /api/auth/login
  if (path === '/api/auth/login' && request.method === 'POST') {
    if (!env.DB) return jsonResponse({ error: 'Database not configured' }, 503);
    const limited = await checkLoginLimit(env, request);
    if (limited) return limited;
    let body;
    try { body = await request.json(); } catch { return jsonResponse({ error: 'Invalid request body' }, 400); }
    const { username, password } = body ?? {};
    if (!username || !password) return jsonResponse({ error: 'Username and password required' }, 400);

    const user = await env.DB.prepare(
      'SELECT id, username, password_hash, role, token_version, email_reminder_dismissed FROM users WHERE username = ?'
    ).bind(username).first();
    const valid = user && await verifyPassword(String(password), user.password_hash);
    // Always return the same error to prevent username enumeration
    if (!valid) {
      await recordLoginFailure(env, request);
      return jsonResponse({ error: 'Invalid username or password' }, 401);
    }

    const role = user.role ?? 'member';
    const token = await signJWT(
      { sub: user.id, username: user.username, role, ver: user.token_version ?? 0, exp: Math.floor(Date.now() / 1000) + 7 * 24 * 3600 },
      env.JWT_SECRET
    );
    // Nudge to link a recovery email — same condition verify-email/request's
    // 403 would hit for a guest (never reachable here anyway, since guests
    // have no password to log in with) plus "already has one" and the
    // user's own opt-out. Checked fresh every login rather than cached in
    // the JWT, since linking/dismissing shouldn't require a re-login to
    // take effect.
    const hasConfirmedEmail = !!(await env.DB.prepare(
      'SELECT 1 FROM user_emails WHERE user_id = ? AND email IS NOT NULL LIMIT 1'
    ).bind(user.id).first());
    const showEmailReminder = !hasConfirmedEmail && !user.email_reminder_dismissed;

    // New-device detection + alert (see known_devices in schema.sql and
    // deviceCookie() in src/lib/auth.js). Guests never reach this route (no
    // password to log in with), so this always applies to a real account.
    // No device_id cookie, or one we don't recognize for THIS account, both
    // count as "new" — generating a fresh token in the former case so
    // there's always one to set below.
    const cookies = parseCookies(request.headers.get('Cookie'));
    const deviceToken = cookies.device_id || randomTokenHex(24);
    const deviceTokenHash = await sha256Hex(deviceToken);
    const now = Date.now();
    const knownDevice = await env.DB.prepare(
      'SELECT 1 FROM known_devices WHERE user_id = ? AND device_token_hash = ?'
    ).bind(user.id, deviceTokenHash).first();

    if (knownDevice) {
      await env.DB.prepare(
        'UPDATE known_devices SET last_seen_at = ? WHERE user_id = ? AND device_token_hash = ?'
      ).bind(now, user.id, deviceTokenHash).run();
    } else {
      await env.DB.prepare(`
        INSERT INTO known_devices (user_id, device_token_hash, user_agent, first_seen_at, last_seen_at)
        VALUES (?, ?, ?, ?, ?)
      `).bind(user.id, deviceTokenHash, request.headers.get('User-Agent') ?? null, now, now).run();

      // Alert every verified email on file (same "every verified address,
      // no designated primary" pattern as Kanban's notifications, not a
      // security-relevant choice either way — there's nothing to pick).
      // Best-effort: a failed send never blocks the login response.
      if (hasConfirmedEmail && env.RESEND_API_KEY) {
        const { results: emailRows } = await env.DB.prepare(
          'SELECT email FROM user_emails WHERE user_id = ? AND email IS NOT NULL'
        ).bind(user.id).all();
        const recipients = (emailRows ?? []).map(r => r.email);
        if (recipients.length) {
          const when = new Date(now).toLocaleString('en-US', { timeZone: 'UTC', dateStyle: 'medium', timeStyle: 'short' });
          const deviceSummary = summarizeUserAgent(request.headers.get('User-Agent'));
          const ip = clientIP(request);
          try {
            await sendResendEmail(env, {
              from: 'CyberUnit @ UNG <security@ungcyberunit.org>',
              to: recipients,
              subject: 'New sign-in to your account — CyberUnit @ UNG',
              text: `We noticed a new sign-in to your CyberUnit @ UNG account (${user.username}) on ${when} UTC, from ${deviceSummary}, IP ${ip}.\n\nIf this was you, no action is needed — this is just a security notice for a browser we haven't seen before.\n\nIf you don't recognize this, go to ${url.origin} and use "Forgot password?" to reset it immediately, then use "Sign out everywhere" from your profile to end any other active sessions.`,
              html: `<p>We noticed a new sign-in to your CyberUnit @ UNG account (<strong>${escapeHtml(user.username)}</strong>) on ${when} UTC, from ${escapeHtml(deviceSummary)}, IP ${escapeHtml(ip)}.</p><p>If this was you, no action is needed — this is just a security notice for a browser we haven't seen before.</p><p>If you don't recognize this, go to <a href="${url.origin}">${escapeHtml(url.origin)}</a> and use "Forgot password?" to reset it immediately, then use "Sign out everywhere" from your profile to end any other active sessions.</p>`,
            });
          } catch (err) {
            console.error('new-device alert send failed', err.message);
          }
        }
      }
    }

    return jsonResponse(
      { id: user.id, username: user.username, role, showEmailReminder },
      200,
      { 'Set-Cookie': [sessionCookie(token, 7 * 24 * 3600, secureCookie), deviceCookie(deviceToken, secureCookie)] },
    );
  }

  // POST /api/auth/logout
  if (path === '/api/auth/logout' && request.method === 'POST') {
    return jsonResponse({ ok: true }, 200, { 'Set-Cookie': sessionCookie('', 0, secureCookie) });
  }

  // POST /api/auth/sign-out-everywhere — self-service session revocation.
  // Bumps token_version, instantly invalidating every outstanding JWT for
  // this account (including the one making this very request) — the
  // deliberate response to "I think my session cookie got copied
  // somewhere" (shared computer, a friend's browser, etc.), since there's
  // no way to tell which specific outstanding token is the stolen copy
  // and which is legitimate. Also clears the current cookie so this
  // browser prompts a fresh login immediately rather than failing on its
  // next request. See CLAUDE.md's "Session revocation" section.
  if (path === '/api/auth/sign-out-everywhere' && request.method === 'POST') {
    if (!env.DB) return jsonResponse({ error: 'Server not configured' }, 503);
    const session = await getSession(request, env);
    if (!session) return jsonResponse({ error: 'Not authenticated' }, 401);
    await env.DB.prepare('UPDATE users SET token_version = token_version + 1 WHERE id = ?').bind(session.sub).run();
    // Same rationale as reset-password's known_devices wipe above — a
    // shared/stolen browser may have gotten silently remembered as
    // "known" before this point, which would otherwise keep skipping the
    // new-sign-in alert on its next login.
    await env.DB.prepare('DELETE FROM known_devices WHERE user_id = ?').bind(session.sub).run();
    return jsonResponse({ ok: true }, 200, { 'Set-Cookie': sessionCookie('', 0, secureCookie) });
  }

  // POST /api/auth/guest — create a temporary, permissionless guest account.
  // Guests get their own throwaway user row (role 'guest', below member) so
  // profile/progress work normally, but they can never reach instructor/admin.
  if (path === '/api/auth/guest' && request.method === 'POST') {
    if (!env.DB) return jsonResponse({ error: 'Database not configured' }, 503);
    const limited = await checkSignupLimit(env, request);
    if (limited) return limited;
    // Hyphenated name can't collide with real usernames (register allows [a-zA-Z0-9_] only).
    const suffix = Array.from(crypto.getRandomValues(new Uint8Array(6)))
      .map(b => b.toString(16).padStart(2, '0')).join('');
    const username = `guest-${suffix}`;
    // Random unguessable password hash — guests never log in by password.
    const hash = await hashPassword(username + crypto.randomUUID());
    const result = await env.DB.prepare(
      'INSERT INTO users (username, password_hash, role, created_at) VALUES (?, ?, \'guest\', ?)'
    ).bind(username, hash, Date.now()).run();

    const token = await signJWT(
      { sub: result.meta.last_row_id, username, role: 'guest', ver: 0, exp: Math.floor(Date.now() / 1000) + GUEST_SESSION_SECONDS },
      env.JWT_SECRET
    );
    await recordSignup(env, request);
    return jsonResponse(
      { id: result.meta.last_row_id, username, role: 'guest' },
      201,
      { 'Set-Cookie': sessionCookie(token, GUEST_SESSION_SECONDS, secureCookie) },
    );
  }

  // POST /api/auth/upgrade — convert the caller's own guest account into a
  // real member account in place (same row, same id), so quiz_results and
  // streak carry over automatically with no separate data-migration step.
  if (path === '/api/auth/upgrade' && request.method === 'POST') {
    if (!env.DB) return jsonResponse({ error: 'Database not configured' }, 503);
    const session = await getSession(request, env);
    if (!session) return jsonResponse({ error: 'Not authenticated' }, 401);
    if (session.role !== 'guest') return jsonResponse({ error: 'Only guest accounts can be upgraded' }, 403);

    const limited = await checkSignupLimit(env, request);
    if (limited) return limited;

    let body;
    try { body = await request.json(); } catch { return jsonResponse({ error: 'Invalid request body' }, 400); }
    const { username, password } = body ?? {};
    if (!username || !password) return jsonResponse({ error: 'Username and password required' }, 400);
    if (!/^[a-zA-Z0-9_]{3,20}$/.test(username)) return jsonResponse({ error: 'Username must be 3–20 alphanumeric characters or underscores' }, 400);
    if (typeof password !== 'string' || password.length < 8) return jsonResponse({ error: 'Password must be at least 8 characters' }, 400);
    if (password.length > 128) return jsonResponse({ error: 'Password too long' }, 400);

    const existing = await env.DB.prepare('SELECT id FROM users WHERE username = ? AND id != ?').bind(username, session.sub).first();
    if (existing) return jsonResponse({ error: 'Username already taken' }, 409);

    const hash = await hashPassword(password);
    const info = await env.DB.prepare(
      `UPDATE users SET username = ?, password_hash = ?, role = 'member' WHERE id = ? AND role = 'guest'`
    ).bind(username, hash, session.sub).run();
    if (info.meta.changes === 0) return jsonResponse({ error: 'Guest session no longer valid' }, 409);

    const token = await signJWT(
      { sub: session.sub, username, role: 'member', ver: session.ver ?? 0, exp: Math.floor(Date.now() / 1000) + 7 * 24 * 3600 },
      env.JWT_SECRET
    );
    await recordSignup(env, request);
    return jsonResponse({ id: session.sub, username, role: 'member' }, 200, { 'Set-Cookie': sessionCookie(token, 7 * 24 * 3600, secureCookie) });
  }

  // GET /api/auth/me
  if (path === '/api/auth/me' && request.method === 'GET') {
    const session = await getSession(request, env);
    if (!session) return jsonResponse({ error: 'Not authenticated' }, 401);
    let avatar = null;
    let hasUnreadAnnouncements = false;
    let role = session.role ?? 'member';
    let extraHeaders = {};
    if (env.DB) {
      const row = await env.DB.prepare('SELECT avatar, last_seen_announcements, role FROM users WHERE id = ?').bind(session.sub).first();
      avatar = row?.avatar ?? null;
      const refreshed = await refreshRoleIfStale(env, session, row?.role, secureCookie);
      role = refreshed.role;
      if (refreshed.cookie) extraHeaders = { 'Set-Cookie': refreshed.cookie };
      // Guests can't view /announcements at all, so never flag them as unread.
      if (role !== 'guest') {
        const latest = await env.DB.prepare('SELECT MAX(created_at) AS latest FROM announcements').first();
        hasUnreadAnnouncements = !!latest?.latest && (row?.last_seen_announcements ?? 0) < latest.latest;
      }
    }
    return jsonResponse({ id: session.sub, username: session.username, role, avatar, hasUnreadAnnouncements }, 200, extraHeaders);
  }

  // POST /api/auth/verify-email/request — any signed-in non-guest member
  // can link up to MAX_EMAILS_PER_USER addresses on their account (see
  // user_emails in schema.sql). Confirming does NOT grant any role by
  // itself — 'student' (and any future role) is admin-assigned only
  // (PATCH /api/admin/users/:id). This is purely an identity/recovery
  // marker, also used by forgot-password/-username below, which look up
  // by whichever address the requester types in, not "the" account email.
  if (path === '/api/auth/verify-email/request' && request.method === 'POST') {
    if (!env.DB) return jsonResponse({ error: 'Server not configured' }, 503);
    const session = await requireRole(request, env, 'member');
    if (session instanceof Response) return session;

    let body;
    try { body = await request.json(); } catch { return jsonResponse({ error: 'Invalid request body' }, 400); }
    const email = (body?.email ?? '').toString().trim().toLowerCase();
    if (!email || email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return jsonResponse({ error: 'Please enter a valid email address' }, 400);
    }

    const existingForThisUser = await env.DB.prepare(
      'SELECT id, email, verify_last_sent_at FROM user_emails WHERE user_id = ? AND (email = ? OR pending_email = ?)'
    ).bind(session.sub, email, email).first();
    if (existingForThisUser?.email) return jsonResponse({ error: 'This email is already verified on your account' }, 409);

    const takenByOther = await env.DB.prepare(
      'SELECT id FROM user_emails WHERE (email = ? OR pending_email = ?) AND user_id != ?'
    ).bind(email, email, session.sub).first();
    if (takenByOther) return jsonResponse({ error: 'This email is already linked to another account' }, 409);

    const cooldownMs = 2 * 60 * 1000;
    if (existingForThisUser?.verify_last_sent_at && Date.now() - existingForThisUser.verify_last_sent_at < cooldownMs) {
      return jsonResponse({ error: 'Please wait a couple minutes before requesting another email' }, 429);
    }

    // Re-requesting the same still-pending address (e.g. the "Resend"
    // button) reuses its existing slot rather than counting a new one —
    // only a genuinely new address consumes one of the 3.
    if (!existingForThisUser) {
      const { count } = await env.DB.prepare('SELECT COUNT(*) AS count FROM user_emails WHERE user_id = ?').bind(session.sub).first();
      if (count >= MAX_EMAILS_PER_USER) {
        return jsonResponse({ error: `You can link at most ${MAX_EMAILS_PER_USER} email addresses` }, 409);
      }
    }

    const token = randomTokenHex();
    const tokenHash = await sha256Hex(token);
    const now = Date.now();
    if (existingForThisUser) {
      await env.DB.prepare(`
        UPDATE user_emails SET verify_token_hash = ?, verify_expires_at = ?, verify_last_sent_at = ?
        WHERE id = ?
      `).bind(tokenHash, now + 60 * 60 * 1000, now, existingForThisUser.id).run();
    } else {
      await env.DB.prepare(`
        INSERT INTO user_emails (user_id, pending_email, verify_token_hash, verify_expires_at, verify_last_sent_at, created_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `).bind(session.sub, email, tokenHash, now + 60 * 60 * 1000, now, now).run();
    }

    if (env.RESEND_API_KEY) {
      const confirmUrl = `${url.origin}/api/auth/verify-email/confirm?token=${token}`;
      try {
        await sendResendEmail(env, {
          // Not the shared noreply@ default — see KANBAN_FROM's comment in
          // src/routes/kanban.js for why ("noreply@" is itself a spam-score
          // signal at some mail gateways). Confirmed via a live UNG O365/
          // Proofpoint test: a kanban@ send arrived clean (spamscore=0,
          // SCL:1) while noreply@ verify-email sends to the same inbox were
          // never found, in junk or otherwise.
          from: 'CyberUnit @ UNG <email-verification@ungcyberunit.org>',
          to: email,
          // Subject/body deliberately avoid "confirm"/"verify your email" —
          // that exact phrase is one of the most commonly impersonated
          // phishing lures (account-verification scams), so content-based
          // spam scoring can flag it independent of sender reputation or
          // link structure. The otherwise near-identical reset-password
          // email (same link shape, same brand-new sender) went through
          // fine, which points at this wording rather than the link itself.
          subject: 'Finish linking your email — CyberUnit @ UNG',
          text: `You started linking this email address to your CyberUnit @ UNG account. Finish the process by opening this link (expires in 1 hour):\n\n${confirmUrl}\n\nIf you didn't request this, you can ignore this email.`,
          html: `<p>You started linking this email address to your CyberUnit @ UNG account. Finish the process by clicking the link below (expires in 1 hour):</p><p><a href="${confirmUrl}">${confirmUrl}</a></p><p>If you didn't request this, you can ignore this email.</p>`,
        });
      } catch (err) {
        console.error('verify-email send failed', err.message);
        return jsonResponse({ error: 'Failed to send verification email, please try again shortly' }, 502);
      }
    }

    return jsonResponse({ ok: true });
  }

  // GET /api/auth/verify-email/confirm — clicked directly from the emailed
  // link, so it can't require the requesting browser's own session; the
  // high-entropy token itself is the credential. Renders a confirm page
  // only — does NOT mutate (see the authActionPageResponse comment for
  // why). The actual confirmation happens on the POST below.
  if (path === '/api/auth/verify-email/confirm' && request.method === 'GET') {
    if (!env.DB) return jsonResponse({ error: 'Server not configured' }, 503);
    const token = url.searchParams.get('token') ?? '';
    const tokenHash = token ? await sha256Hex(token) : '';
    const match = tokenHash && await env.DB.prepare(
      'SELECT id, pending_email AS email_pending FROM user_emails WHERE verify_token_hash = ? AND verify_expires_at > ?'
    ).bind(tokenHash, Date.now()).first();

    if (!match) return Response.redirect(`${url.origin}/profile?verify_error=1`, 302);

    return authActionPageResponse({
      title: 'Confirm Email',
      heading: '// Confirm Your Email',
      message: `Click below to confirm <strong>${escapeHtml(match.email_pending)}</strong> for your account.`,
      formHtml: `<form method="POST" action="/api/auth/verify-email/confirm">
        <input type="hidden" name="token" value="${escapeHtml(token)}">
        <button type="submit" class="btn btn-primary">Confirm Email</button>
      </form>`,
    });
  }

  // POST /api/auth/verify-email/confirm — the actual mutation, only
  // reachable by submitting the form from the GET page above (a real
  // user click), never by an automated link-prefetcher (GET-only).
  if (path === '/api/auth/verify-email/confirm' && request.method === 'POST') {
    if (!env.DB) return jsonResponse({ error: 'Server not configured' }, 503);
    let form;
    try { form = await request.formData(); } catch { return Response.redirect(`${url.origin}/profile?verify_error=1`, 302); }
    const token = (form.get('token') ?? '').toString();
    const tokenHash = token ? await sha256Hex(token) : '';
    const match = tokenHash && await env.DB.prepare(
      'SELECT id FROM user_emails WHERE verify_token_hash = ? AND verify_expires_at > ?'
    ).bind(tokenHash, Date.now()).first();

    if (!match) return Response.redirect(`${url.origin}/profile?verify_error=1`, 302);

    try {
      await env.DB.prepare(`
        UPDATE user_emails SET email = pending_email, pending_email = NULL, verify_token_hash = NULL, verify_expires_at = NULL
        WHERE id = ?
      `).bind(match.id).run();
    } catch (err) {
      // idx_user_emails_email unique-constraint race: someone else
      // verified the exact same address a moment earlier.
      console.error('verify-email confirm failed', err.message);
      return Response.redirect(`${url.origin}/profile?verify_error=1`, 302);
    }

    return Response.redirect(`${url.origin}/profile?verified=1`, 302);
  }

  // DELETE /api/auth/emails/:id — unlink one of the signed-in user's own
  // email addresses (verified or still-pending). No re-auth prompt, same
  // as every other self-service profile mutation here (avatar, visibility,
  // Discord unlink). "Replace an address" is this plus a fresh
  // verify-email/request from the client — no separate replace endpoint.
  const emailIdMatch = path.match(/^\/api\/auth\/emails\/(\d+)$/);
  if (emailIdMatch && request.method === 'DELETE') {
    if (!env.DB) return jsonResponse({ error: 'Server not configured' }, 503);
    const session = await requireRole(request, env, 'member');
    if (session instanceof Response) return session;

    const existing = await env.DB.prepare('SELECT user_id FROM user_emails WHERE id = ?').bind(emailIdMatch[1]).first();
    if (!existing || existing.user_id !== session.sub) return jsonResponse({ error: 'Email not found' }, 404);

    await env.DB.prepare('DELETE FROM user_emails WHERE id = ?').bind(emailIdMatch[1]).run();
    return jsonResponse({ ok: true });
  }

  // POST /api/auth/forgot-password — unauthenticated (that's the whole
  // point). Always responds { ok: true } regardless of whether the email
  // matched an account, same anti-enumeration principle as login's
  // generic "Invalid username or password". Only works for accounts with
  // a confirmed email on file — there's no other way to prove identity.
  if (path === '/api/auth/forgot-password' && request.method === 'POST') {
    if (!env.DB) return jsonResponse({ error: 'Server not configured' }, 503);
    const limited = await checkEmailActionLimit(env, request);
    if (limited) return limited;
    await recordEmailAction(env, request);

    let body;
    try { body = await request.json(); } catch { return jsonResponse({ error: 'Invalid request body' }, 400); }
    const email = (body?.email ?? '').toString().trim().toLowerCase();
    if (!email || email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return jsonResponse({ error: 'Please enter a valid email address' }, 400);
    }

    const user = await env.DB.prepare(`
      SELECT u.id, u.password_reset_last_sent_at
      FROM user_emails ue JOIN users u ON u.id = ue.user_id
      WHERE ue.email = ?
    `).bind(email).first();
    const cooldownMs = 2 * 60 * 1000;
    const inCooldown = user?.password_reset_last_sent_at && Date.now() - user.password_reset_last_sent_at < cooldownMs;

    if (user && !inCooldown) {
      const token = randomTokenHex();
      const tokenHash = await sha256Hex(token);
      const now = Date.now();
      await env.DB.prepare(`
        UPDATE users
        SET password_reset_token_hash = ?, password_reset_expires_at = ?, password_reset_last_sent_at = ?
        WHERE id = ?
      `).bind(tokenHash, now + 60 * 60 * 1000, now, user.id).run();

      if (env.RESEND_API_KEY) {
        const resetUrl = `${url.origin}/api/auth/reset-password?token=${token}`;
        try {
          await sendResendEmail(env, {
            // See the comment on verify-email/request's send above — same
            // noreply@ spam-score reasoning, same fix.
            from: 'CyberUnit @ UNG <account-recovery@ungcyberunit.org>',
            to: email,
            subject: 'Reset your password — CyberUnit @ UNG',
            text: `Reset your password by opening this link (expires in 1 hour):\n\n${resetUrl}\n\nIf you didn't request this, you can ignore this email.`,
            html: `<p>Reset your password by clicking the link below (expires in 1 hour):</p><p><a href="${resetUrl}">${resetUrl}</a></p><p>If you didn't request this, you can ignore this email.</p>`,
          });
        } catch (err) {
          console.error('forgot-password send failed', err.message);
          // Still return ok:true below — a distinguishable error here
          // would leak whether the account exists.
        }
      }
    }

    return jsonResponse({ ok: true });
  }

  function resetPasswordFormHtml(token) {
    return `<form method="POST" action="/api/auth/reset-password">
      <input type="hidden" name="token" value="${escapeHtml(token)}">
      <div class="form-group">
        <label for="password">New password</label>
        <input type="password" id="password" name="password" minlength="8" maxlength="128" required autocomplete="new-password">
      </div>
      <div class="form-group">
        <label for="passwordConfirm">Confirm password</label>
        <input type="password" id="passwordConfirm" name="passwordConfirm" minlength="8" maxlength="128" required autocomplete="new-password">
      </div>
      <button type="submit" class="btn btn-primary">Reset Password</button>
    </form>`;
  }

  const resetLinkInvalidPage = () => authActionPageResponse({
    title: 'Reset Link Invalid',
    heading: '// Link Expired or Invalid',
    message: 'This password reset link is invalid or has expired. Request a new one from the Sign In screen.',
    formHtml: `<a href="/" class="btn">← Return to Home</a>`,
  }, 400);

  // GET /api/auth/reset-password — same no-mutation-on-GET discipline as
  // verify-email/confirm, though setting a password requires a form
  // either way, so this route was never at risk of link-prefetch abuse.
  if (path === '/api/auth/reset-password' && request.method === 'GET') {
    if (!env.DB) return jsonResponse({ error: 'Server not configured' }, 503);
    const token = url.searchParams.get('token') ?? '';
    const tokenHash = token ? await sha256Hex(token) : '';
    const match = tokenHash && await env.DB.prepare(
      'SELECT id FROM users WHERE password_reset_token_hash = ? AND password_reset_expires_at > ?'
    ).bind(tokenHash, Date.now()).first();

    if (!match) return resetLinkInvalidPage();

    return authActionPageResponse({
      title: 'Reset Password',
      heading: '// Set a New Password',
      message: 'Choose a new password for your account.',
      formHtml: resetPasswordFormHtml(token),
    });
  }

  // POST /api/auth/reset-password — the actual mutation, then auto-login
  // (same signJWT/sessionCookie pattern as register/login) for good UX.
  if (path === '/api/auth/reset-password' && request.method === 'POST') {
    if (!env.DB) return jsonResponse({ error: 'Server not configured' }, 503);
    let form;
    try { form = await request.formData(); } catch { return resetLinkInvalidPage(); }
    const token = (form.get('token') ?? '').toString();
    const password = (form.get('password') ?? '').toString();
    const passwordConfirm = (form.get('passwordConfirm') ?? '').toString();

    const tokenHash = token ? await sha256Hex(token) : '';
    const match = tokenHash && await env.DB.prepare(
      'SELECT id, username, role FROM users WHERE password_reset_token_hash = ? AND password_reset_expires_at > ?'
    ).bind(tokenHash, Date.now()).first();
    if (!match) return resetLinkInvalidPage();

    if (password.length < 8 || password.length > 128) {
      return authActionPageResponse({
        title: 'Reset Password',
        heading: '// Set a New Password',
        message: 'Password must be at least 8 characters.',
        formHtml: resetPasswordFormHtml(token),
      }, 400);
    }
    if (password !== passwordConfirm) {
      return authActionPageResponse({
        title: 'Reset Password',
        heading: '// Set a New Password',
        message: 'Passwords did not match. Try again.',
        formHtml: resetPasswordFormHtml(token),
      }, 400);
    }

    const hash = await hashPassword(password);
    // Bumping token_version here invalidates every previously-issued
    // session for this account the instant a password reset completes —
    // the whole point of a reset is "I think someone else has access,"
    // so any copied/stolen cookie from before this moment must stop
    // working too, not just log the resetter back in. See
    // CLAUDE.md's "Session revocation" section.
    const updated = await env.DB.prepare(`
      UPDATE users SET password_hash = ?, token_version = token_version + 1,
        password_reset_token_hash = NULL, password_reset_expires_at = NULL
      WHERE id = ? RETURNING token_version
    `).bind(hash, match.id).first();
    // Forget every known_devices row too, same "someone else may have had
    // access" rationale as the token_version bump above — otherwise an
    // attacker's browser that got silently remembered before the reset
    // would keep skipping the new-sign-in alert afterward. The resetter's
    // own next explicit login will look "new" once more and send one
    // extra (harmless) alert — an acceptable trade for not leaving a
    // stale trusted device behind.
    await env.DB.prepare('DELETE FROM known_devices WHERE user_id = ?').bind(match.id).run();

    const sessionToken = await signJWT(
      { sub: match.id, username: match.username, role: match.role ?? 'member', ver: updated?.token_version ?? 0, exp: Math.floor(Date.now() / 1000) + 7 * 24 * 3600 },
      env.JWT_SECRET
    );
    return new Response(null, {
      status: 302,
      headers: addSecurityHeaders(new Headers({
        'Location': `${url.origin}/profile?reset=1`,
        'Set-Cookie': sessionCookie(sessionToken, 7 * 24 * 3600, secureCookie),
      })),
    });
  }

  // POST /api/auth/forgot-username — unauthenticated, same anti-
  // enumeration principle as forgot-password. Usernames aren't secret,
  // so this just emails a reminder — no token/link needed.
  if (path === '/api/auth/forgot-username' && request.method === 'POST') {
    if (!env.DB) return jsonResponse({ error: 'Server not configured' }, 503);
    const limited = await checkEmailActionLimit(env, request);
    if (limited) return limited;
    await recordEmailAction(env, request);

    let body;
    try { body = await request.json(); } catch { return jsonResponse({ error: 'Invalid request body' }, 400); }
    const email = (body?.email ?? '').toString().trim().toLowerCase();
    if (!email || email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return jsonResponse({ error: 'Please enter a valid email address' }, 400);
    }

    const user = await env.DB.prepare(`
      SELECT u.username
      FROM user_emails ue JOIN users u ON u.id = ue.user_id
      WHERE ue.email = ?
    `).bind(email).first();
    if (user && env.RESEND_API_KEY) {
      try {
        await sendResendEmail(env, {
          // Same noreply@ spam-score reasoning as verify-email/request above.
          from: 'CyberUnit @ UNG <account-recovery@ungcyberunit.org>',
          to: email,
          subject: 'Your username — CyberUnit @ UNG',
          text: `Your username is: ${user.username}\n\nIf you didn't request this, you can ignore this email.`,
          html: `<p>Your username is: <strong>${escapeHtml(user.username)}</strong></p><p>If you didn't request this, you can ignore this email.</p>`,
        });
      } catch (err) {
        console.error('forgot-username send failed', err.message);
      }
    }

    return jsonResponse({ ok: true });
  }

  // GET /api/progress  — returns [] if not authenticated (graceful for logged-out users)
  if (path === '/api/progress' && request.method === 'GET') {
    if (!env.DB) return jsonResponse({ results: [] });
    const session = await getSession(request, env);
    if (!session) return jsonResponse({ results: [] });
    const { results } = await env.DB.prepare(
      'SELECT topic_id, score, total FROM quiz_results WHERE user_id = ?'
    ).bind(session.sub).all();
    // Current daily streak — only valid if the user was active today or
    // yesterday; otherwise the streak is broken and reads as 0.
    const u = await env.DB.prepare('SELECT streak, last_active FROM users WHERE id = ?').bind(session.sub).first();
    const streak = (u && (u.last_active === dateStrUTC(0) || u.last_active === dateStrUTC(-1))) ? (u.streak ?? 0) : 0;
    return jsonResponse({ results: results ?? [], streak });
  }

  // DELETE /api/progress/:topicId
  const progressMatch = path.match(/^\/api\/progress\/(\w+)$/);
  if (progressMatch && request.method === 'DELETE') {
    if (!env.DB) return jsonResponse({ error: 'Database not configured' }, 503);
    const session = await getSession(request, env);
    if (!session) return jsonResponse({ error: 'Not authenticated' }, 401);
    await env.DB.prepare(
      'DELETE FROM quiz_results WHERE user_id = ? AND topic_id = ?'
    ).bind(session.sub, progressMatch[1]).run();
    return jsonResponse({ ok: true });
  }

  // POST /api/progress/:topicId
  if (progressMatch && request.method === 'POST') {
    if (!env.DB) return jsonResponse({ error: 'Database not configured' }, 503);
    const session = await getSession(request, env);
    if (!session) return jsonResponse({ error: 'Not authenticated' }, 401);
    let body;
    try { body = await request.json(); } catch { return jsonResponse({ error: 'Invalid request body' }, 400); }
    const topicId = progressMatch[1];
    const topic = topics.find(t => t.id === topicId);
    if (!topic || !Array.isArray(topic.quiz) || topic.quiz.length === 0) {
      return jsonResponse({ error: 'Unknown topic' }, 404);
    }
    const { answers } = body ?? {};
    if (!Array.isArray(answers) || answers.length !== topic.quiz.length) {
      return jsonResponse({ error: 'Invalid answers data' }, 400);
    }
    const total = topic.quiz.length;
    const score = topic.quiz.reduce(
      (sum, q, i) => sum + (Number.isInteger(answers[i]) && answers[i] === q.correct ? 1 : 0),
      0
    );
    // Upsert: keep the best (highest) score the user has achieved
    await env.DB.prepare(`
      INSERT INTO quiz_results (user_id, topic_id, score, total, updated_at)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(user_id, topic_id) DO UPDATE SET
        score      = MAX(score, excluded.score),
        total      = excluded.total,
        updated_at = excluded.updated_at
    `).bind(session.sub, topicId, score, total, Date.now()).run();

    // Update the user's daily learning streak.
    const today = dateStrUTC(0);
    const u = await env.DB.prepare('SELECT streak, last_active FROM users WHERE id = ?').bind(session.sub).first();
    const streak = nextStreak(u?.streak, u?.last_active, today, dateStrUTC(-1));
    await env.DB.prepare('UPDATE users SET streak = ?, last_active = ? WHERE id = ?')
      .bind(streak, today, session.sub).run();

    return jsonResponse({ ok: true, streak });
  }

  return null;
}
