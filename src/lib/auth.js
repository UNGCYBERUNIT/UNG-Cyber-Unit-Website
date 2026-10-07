// ─── Auth & Session ───────────────────────────────────────────────────────────
// Password hashing, JWT sign/verify, session reads, role checks, and the
// standalone email-action (verify-email/reset-password) confirmation page.
// Everything here is the REAL auth path — see lib/lab-auth.js for the
// deliberately-broken lookalike used only by the Web Exploitation Lab, kept
// in a separate file on purpose so the two are never confusable.

import { jsonResponse, addSecurityHeaders, parseCookies, timingSafeEqual } from './http.js';

export async function hashPassword(password) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const key = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits']
  );
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt, iterations: 100000, hash: 'SHA-256' }, key, 256
  );
  const hex = arr => Array.from(arr).map(b => b.toString(16).padStart(2, '0')).join('');
  return `${hex(salt)}:${hex(new Uint8Array(bits))}`;
}

export async function verifyPassword(password, stored) {
  const [saltHex, hashHex] = stored.split(':');
  const salt = Uint8Array.from(saltHex.match(/.{2}/g), b => parseInt(b, 16));
  const key = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits']
  );
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt, iterations: 100000, hash: 'SHA-256' }, key, 256
  );
  const computed = Array.from(new Uint8Array(bits)).map(b => b.toString(16).padStart(2, '0')).join('');
  return timingSafeEqual(computed, hashHex);
}

// Single-use email-verification tokens are stored hashed (never raw) so a
// database leak alone can't be used to confirm arbitrary pending emails —
// same rationale as hashing passwords.
export function randomTokenHex(byteLen = 32) {
  return Array.from(crypto.getRandomValues(new Uint8Array(byteLen)))
    .map(b => b.toString(16).padStart(2, '0')).join('');
}

export async function sha256Hex(text) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest)).map(b => b.toString(16).padStart(2, '0')).join('');
}

export async function signJWT(payload, secret) {
  const b64u = obj => btoa(JSON.stringify(obj)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
  const header = b64u({ alg: 'HS256', typ: 'JWT' });
  const body   = b64u(payload);
  const data   = `${header}.${body}`;
  const key = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(data));
  const sigB64 = btoa(String.fromCharCode(...new Uint8Array(sig)))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
  return `${data}.${sigB64}`;
}

export async function verifyJWT(token, secret) {
  try {
    const [h, p, s] = token.split('.');
    if (!h || !p || !s) return null;
    const key = await crypto.subtle.importKey(
      'raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['verify']
    );
    const sig = Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0));
    const valid = await crypto.subtle.verify('HMAC', key, sig, new TextEncoder().encode(`${h}.${p}`));
    if (!valid) return null;
    const payload = JSON.parse(atob(p.replace(/-/g, '+').replace(/_/g, '/')));
    if (payload.exp && Date.now() / 1000 > payload.exp) return null;
    return payload;
  } catch { return null; }
}

// Revocable sessions: after verifying the JWT's signature/expiry, compare
// its `ver` claim against the user's current token_version in D1. Bumped on
// password reset and POST /api/auth/sign-out-everywhere, so a copied/stolen
// cookie stops working the instant either happens — not just at the
// token's natural 7-day expiry. See CLAUDE.md's "Session revocation"
// section for the full rationale (this used to be a purely stateless JWT
// check with no DB read at all; that's a deliberate trade-off reversal).
export async function getSession(request, env) {
  const cookies = parseCookies(request.headers.get('Cookie'));
  if (!cookies.session) return null;
  const payload = await verifyJWT(cookies.session, env.JWT_SECRET);
  if (!payload) return null;
  if (!env.DB) return null; // can't verify revocation without DB — fail closed
  const row = await env.DB.prepare('SELECT token_version FROM users WHERE id = ?').bind(payload.sub).first();
  if (!row || (row.token_version ?? 0) !== (payload.ver ?? 0)) return null;
  return payload;
}

export function sessionCookie(token, maxAge, secure = true) {
  return `session=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${maxAge}${secure ? '; Secure' : ''}`;
}

// Guest sessions are short-lived (capped well below members' 7d) since guest
// accounts are throwaway, permissionless, and created with no rate limit
// beyond the shared signup limiter — bounding their lifetime bounds the
// window any one of them can pollute the leaderboard/DB.
export const GUEST_SESSION_SECONDS = 2 * 3600;

// Role lives in the JWT, not re-checked against the DB on every request. If a
// DB role change (e.g. a student email just got verified) has moved past what
// this session's cookie was issued with, transparently reissue the cookie —
// called from the two endpoints every page already polls on load
// (/api/auth/me, /api/profile) so sessions self-heal without a re-login.
export async function refreshRoleIfStale(env, session, dbRole, secure = true) {
  if (!dbRole || dbRole === session.role) return { role: session.role ?? 'member', cookie: null };
  // Never self-heal a guest token into a longer-lived non-guest cookie. A
  // guest JWT is only ever meant to live for its original short window
  // (GUEST_SESSION_SECONDS) — if this account was since upgraded via
  // /api/auth/upgrade, the browser that did the upgrade already got a fresh
  // member cookie directly from that response. This path is only reachable
  // by a *stale* copy of the old guest token (e.g. one captured before the
  // upgrade), so minting it a fresh 7-day cookie here would let a stolen
  // throwaway guest session outlive its cap by riding the account's later
  // upgrade. Keep it pinned at guest until it naturally expires.
  if (session.role === 'guest') return { role: 'guest', cookie: null };
  const token = await signJWT(
    { sub: session.sub, username: session.username, role: dbRole, ver: session.ver ?? 0, exp: Math.floor(Date.now() / 1000) + 7 * 24 * 3600 },
    env.JWT_SECRET
  );
  return { role: dbRole, cookie: sessionCookie(token, 7 * 24 * 3600, secure) };
}

// ─── Role Helpers ─────────────────────────────────────────────────────────────

export const ROLE_RANK = { guest: -1, member: 0, student: 1, instructor: 2, admin: 3 };

export async function requireRole(request, env, minRole) {
  const session = await getSession(request, env);
  if (!session) return jsonResponse({ error: 'Not authenticated' }, 401);
  if ((ROLE_RANK[session.role] ?? 0) < (ROLE_RANK[minRole] ?? 0)) {
    return jsonResponse({ error: 'Forbidden' }, 403);
  }
  return session;
}

// ─── Discord Bot API Auth ─────────────────────────────────────────────────────
// Shared-secret gate for the /api/bot/* endpoints the Discord bot calls
// server-to-server (it has no browser session, so getSession/requireRole
// don't apply here). Returns an error Response, or null if the secret checks
// out. See docs/plan-discord-pairing.md.
export function checkBotSecret(request, env) {
  if (!env.BOT_API_SECRET) return jsonResponse({ error: 'Server not configured' }, 503);
  const provided = request.headers.get('X-Bot-Secret') || '';
  if (!timingSafeEqual(provided, env.BOT_API_SECRET)) return jsonResponse({ error: 'Unauthorized' }, 401);
  return null;
}

// ─── Auth action pages (email confirm / password reset) ───────────────────────
// Minimal server-rendered pages for links clicked directly out of an email —
// no JS, so a plain <form method="POST"> is the actual state-changing step.
// This is deliberate: mail security gateways commonly pre-fetch every link in
// an inbound email automatically, before a human opens it. A GET here must
// never mutate anything, or an automated crawler silently burns the user's
// token before they ever see the message. Only the POST (triggered by an
// explicit click) is allowed to change state.
export function authActionPageResponse({ title, heading, message, formHtml }, status = 200) {
  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta name="robots" content="noindex">
  <title>${title} — CyberUnit @ UNG</title>
  <link rel="icon" href="/favicon.ico" type="image/x-icon">
  <link rel="stylesheet" href="/css/style.css">
</head>
<body>
  <nav class="navbar" role="navigation" aria-label="Main navigation">
    <div class="container">
      <a href="/" class="navbar-logo"><img src="/images/CyberUnitLogo_Transparent.png" alt="CyberUnit @ UNG" class="navbar-logo-img"><span class="navbar-logo-text">[ CyberUnit @ UNG ]</span></a>
      <ul class="navbar-links"><li><a href="/">Home</a></li></ul>
    </div>
  </nav>
  <main class="page-body">
    <div class="container" style="max-width: 480px; padding: 3rem 1rem;">
      <div class="card" style="padding: 2rem;">
        <h1 style="font-family:'Share Tech Mono',monospace;color:var(--accent);font-size:1.3rem;margin:0 0 0.75rem;">${heading}</h1>
        <p style="color:var(--text-soft);margin:0 0 1.25rem;">${message}</p>
        ${formHtml}
      </div>
    </div>
  </main>
</body>
</html>`;
  const headers = addSecurityHeaders(new Headers({ 'Content-Type': 'text/html; charset=utf-8' }));
  return new Response(html, { status, headers });
}
