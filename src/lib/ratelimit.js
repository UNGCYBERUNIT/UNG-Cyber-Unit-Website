// ─── Rate Limiting ────────────────────────────────────────────────────────────
// Eight sliding-window check/record pairs, one per abuse surface. Each `check*`
// returns a 429 Response when the caller is over the limit (otherwise null),
// EXCEPT isNewDeviceAlertLimited (see its own comment) which returns a plain
// boolean instead, since the action it guards is a side-effect email, not
// the HTTP request itself. Each `record*` inserts a row and opportunistically
// prunes expired ones so its backing table stays small. All D1-backed except
// the webexploit pair, which deliberately uses env.WEBEXPLOIT_DB only — see
// its own comment below.

import { jsonResponse, clientIP } from './http.js';

// ─── Room Lookup Rate Limiting ────────────────────────────────────────────────
// Throttle brute-force guessing of room codes. We count only *failed* lookups
// (unknown/closed/expired codes) per client IP in a sliding window, so ordinary
// use — joining rooms you have a valid code for — is never throttled.
export const ROOM_RL_WINDOW_MS = 10 * 60 * 1000; // 10 minutes
export const ROOM_RL_MAX_FAILURES = 20;          // failed code lookups per IP per window

// Returns a 429 Response when this IP is over the limit, otherwise null.
export async function checkRoomLookupLimit(env, request) {
  if (!env.DB) return null;
  const cutoff = Date.now() - ROOM_RL_WINDOW_MS;
  const row = await env.DB.prepare(
    'SELECT COUNT(*) AS n FROM room_lookup_failures WHERE ip = ? AND ts > ?'
  ).bind(clientIP(request), cutoff).first();
  if ((row?.n ?? 0) >= ROOM_RL_MAX_FAILURES) {
    return jsonResponse({ error: 'Too many room attempts. Please wait a few minutes and try again.' }, 429);
  }
  return null;
}

export async function recordRoomLookupFailure(env, request) {
  if (!env.DB) return;
  const now = Date.now();
  await env.DB.prepare('INSERT INTO room_lookup_failures (ip, ts) VALUES (?, ?)')
    .bind(clientIP(request), now).run();
  // Opportunistically prune expired rows so the table stays small.
  await env.DB.prepare('DELETE FROM room_lookup_failures WHERE ts < ?').bind(now - ROOM_RL_WINDOW_MS).run();
}

export const CHALLENGE_SUBMIT_RL_WINDOW_MS = 10 * 60 * 1000; // 10 minutes
export const CHALLENGE_SUBMIT_RL_MAX = 15;                   // failed submissions per user per window

// Returns a 429 Response when this user is over the limit, otherwise null.
// Only *wrong* submissions count (mirrors checkRoomLookupLimit), so working
// through several challenges normally never gets throttled.
export async function checkChallengeSubmitLimit(env, userId) {
  if (!env.DB) return null;
  const cutoff = Date.now() - CHALLENGE_SUBMIT_RL_WINDOW_MS;
  const row = await env.DB.prepare(
    'SELECT COUNT(*) AS n FROM challenge_submit_rate_limit WHERE user_id = ? AND ts > ?'
  ).bind(userId, cutoff).first();
  if ((row?.n ?? 0) >= CHALLENGE_SUBMIT_RL_MAX) {
    return jsonResponse({ error: 'Too many attempts. Please wait a few minutes and try again.' }, 429);
  }
  return null;
}

export async function recordChallengeSubmitFailure(env, userId) {
  if (!env.DB) return;
  const now = Date.now();
  await env.DB.prepare('INSERT INTO challenge_submit_rate_limit (user_id, ts) VALUES (?, ?)')
    .bind(userId, now).run();
  await env.DB.prepare('DELETE FROM challenge_submit_rate_limit WHERE ts < ?').bind(now - CHALLENGE_SUBMIT_RL_WINDOW_MS).run();
}

export const FEEDBACK_RL_WINDOW_MS = 60 * 60 * 1000; // 1 hour
export const FEEDBACK_RL_MAX = 5;                    // submissions per IP per window

// Returns a 429 Response when this IP is over the limit, otherwise null.
export async function checkFeedbackLimit(env, request) {
  if (!env.DB) return null;
  const cutoff = Date.now() - FEEDBACK_RL_WINDOW_MS;
  const row = await env.DB.prepare(
    'SELECT COUNT(*) AS n FROM feedback_rate_limit WHERE ip = ? AND ts > ?'
  ).bind(clientIP(request), cutoff).first();
  if ((row?.n ?? 0) >= FEEDBACK_RL_MAX) {
    return jsonResponse({ error: 'Too many messages submitted recently. Please wait a while and try again.' }, 429);
  }
  return null;
}

export async function recordFeedbackSubmission(env, request) {
  if (!env.DB) return;
  const now = Date.now();
  await env.DB.prepare('INSERT INTO feedback_rate_limit (ip, ts) VALUES (?, ?)')
    .bind(clientIP(request), now).run();
  // Opportunistically prune expired rows so the table stays small.
  await env.DB.prepare('DELETE FROM feedback_rate_limit WHERE ts < ?').bind(now - FEEDBACK_RL_WINDOW_MS).run();
}

export const WEBEXPLOIT_LOGIN_RL_WINDOW_MS = 10 * 60 * 1000; // 10 minutes
export const WEBEXPLOIT_LOGIN_RL_MAX = 30;                   // attempts per IP per window — generous enough
// for a student manually iterating on injection payloads, still caps a scripted flood.
// Uses env.WEBEXPLOIT_DB exclusively (own table in webexploit-schema.sql) — this endpoint
// must never have a reason to touch env.DB, not even for bookkeeping like this.

// Returns a 429 Response when this IP is over the limit, otherwise null.
export async function checkWebexploitLoginLimit(env, request) {
  if (!env.WEBEXPLOIT_DB) return null;
  const cutoff = Date.now() - WEBEXPLOIT_LOGIN_RL_WINDOW_MS;
  const row = await env.WEBEXPLOIT_DB.prepare(
    'SELECT COUNT(*) AS n FROM webexploit_login_rate_limit WHERE ip = ? AND ts > ?'
  ).bind(clientIP(request), cutoff).first();
  if ((row?.n ?? 0) >= WEBEXPLOIT_LOGIN_RL_MAX) {
    return jsonResponse({ success: false, message: 'Too many attempts. Please wait a while and try again.' }, 429);
  }
  return null;
}

export async function recordWebexploitLoginAttempt(env, request) {
  if (!env.WEBEXPLOIT_DB) return;
  const now = Date.now();
  await env.WEBEXPLOIT_DB.prepare('INSERT INTO webexploit_login_rate_limit (ip, ts) VALUES (?, ?)')
    .bind(clientIP(request), now).run();
  // Opportunistically prune expired rows so the table stays small.
  await env.WEBEXPLOIT_DB.prepare('DELETE FROM webexploit_login_rate_limit WHERE ts < ?').bind(now - WEBEXPLOIT_LOGIN_RL_WINDOW_MS).run();
}

export const LOGIN_RL_WINDOW_MS = 10 * 60 * 1000; // 10 minutes
export const LOGIN_RL_MAX_FAILURES = 10;          // failed login attempts per IP per window

// Throttle brute-force/credential-stuffing against POST /api/auth/login. We
// count only *failed* attempts per client IP in a sliding window (mirrors
// checkRoomLookupLimit), so a user who simply mistypes their own password
// isn't blocked, and legitimate logins are never throttled.
export async function checkLoginLimit(env, request) {
  if (!env.DB) return null;
  const cutoff = Date.now() - LOGIN_RL_WINDOW_MS;
  const row = await env.DB.prepare(
    'SELECT COUNT(*) AS n FROM login_failures WHERE ip = ? AND ts > ?'
  ).bind(clientIP(request), cutoff).first();
  if ((row?.n ?? 0) >= LOGIN_RL_MAX_FAILURES) {
    return jsonResponse({ error: 'Too many login attempts. Please wait a few minutes and try again.' }, 429);
  }
  return null;
}

export async function recordLoginFailure(env, request) {
  if (!env.DB) return;
  const now = Date.now();
  await env.DB.prepare('INSERT INTO login_failures (ip, ts) VALUES (?, ?)')
    .bind(clientIP(request), now).run();
  // Opportunistically prune expired rows so the table stays small.
  await env.DB.prepare('DELETE FROM login_failures WHERE ts < ?').bind(now - LOGIN_RL_WINDOW_MS).run();
}

export const SIGNUP_RL_WINDOW_MS = 60 * 60 * 1000; // 1 hour
export const SIGNUP_RL_MAX = 10;                   // account creations (register + guest) per IP per window

// Returns a 429 Response when this IP is over the limit, otherwise null.
export async function checkSignupLimit(env, request) {
  if (!env.DB) return null;
  const cutoff = Date.now() - SIGNUP_RL_WINDOW_MS;
  const row = await env.DB.prepare(
    'SELECT COUNT(*) AS n FROM signup_rate_limit WHERE ip = ? AND ts > ?'
  ).bind(clientIP(request), cutoff).first();
  if ((row?.n ?? 0) >= SIGNUP_RL_MAX) {
    return jsonResponse({ error: 'Too many accounts created recently. Please wait a while and try again.' }, 429);
  }
  return null;
}

export async function recordSignup(env, request) {
  if (!env.DB) return;
  const now = Date.now();
  await env.DB.prepare('INSERT INTO signup_rate_limit (ip, ts) VALUES (?, ?)')
    .bind(clientIP(request), now).run();
  // Opportunistically prune expired rows so the table stays small.
  await env.DB.prepare('DELETE FROM signup_rate_limit WHERE ts < ?').bind(now - SIGNUP_RL_WINDOW_MS).run();
}

export const EMAIL_ACTION_RL_WINDOW_MS = 60 * 60 * 1000; // 1 hour
export const EMAIL_ACTION_RL_MAX = 5;                    // forgot-password/-username requests per IP per window

// Shared IP limiter for the unauthenticated recovery endpoints (forgot
// password/username) — these have no account to rate-limit against until
// after a lookup, unlike verify-email/request which is behind a login.
export async function checkEmailActionLimit(env, request) {
  if (!env.DB) return null;
  const cutoff = Date.now() - EMAIL_ACTION_RL_WINDOW_MS;
  const row = await env.DB.prepare(
    'SELECT COUNT(*) AS n FROM email_action_rate_limit WHERE ip = ? AND ts > ?'
  ).bind(clientIP(request), cutoff).first();
  if ((row?.n ?? 0) >= EMAIL_ACTION_RL_MAX) {
    return jsonResponse({ error: 'Too many requests. Please wait a while and try again.' }, 429);
  }
  return null;
}

export async function recordEmailAction(env, request) {
  if (!env.DB) return;
  const now = Date.now();
  await env.DB.prepare('INSERT INTO email_action_rate_limit (ip, ts) VALUES (?, ?)')
    .bind(clientIP(request), now).run();
  await env.DB.prepare('DELETE FROM email_action_rate_limit WHERE ts < ?').bind(now - EMAIL_ACTION_RL_WINDOW_MS).run();
}

export const NEW_DEVICE_ALERT_RL_WINDOW_MS = 60 * 60 * 1000; // 1 hour
export const NEW_DEVICE_ALERT_RL_MAX = 3;                    // new-device alert emails per account per window

// Unlike every check*/record* pair above, this does NOT return a 429
// Response — POST /api/auth/login must still succeed for valid credentials
// regardless of this limit; only the side-effect alert email gets skipped
// once an account is over the cap. Protects against a trivial email-bomb /
// Resend-quota-exhaustion attack: without it, anyone who already has valid
// credentials could trigger unlimited alert sends just by never sending
// the device_id cookie, since checkLoginLimit/recordLoginFailure only
// throttle FAILED logins, not successful ones. Keyed by user_id, not IP —
// the attacker's IP is irrelevant to the victim's inbox/this site's shared
// send quota being what's under attack. See new_device_alert_rate_limit in
// schema.sql.
export async function isNewDeviceAlertLimited(env, userId) {
  if (!env.DB) return false;
  const cutoff = Date.now() - NEW_DEVICE_ALERT_RL_WINDOW_MS;
  const row = await env.DB.prepare(
    'SELECT COUNT(*) AS n FROM new_device_alert_rate_limit WHERE user_id = ? AND ts > ?'
  ).bind(userId, cutoff).first();
  return (row?.n ?? 0) >= NEW_DEVICE_ALERT_RL_MAX;
}

export async function recordNewDeviceAlert(env, userId) {
  if (!env.DB) return;
  const now = Date.now();
  await env.DB.prepare('INSERT INTO new_device_alert_rate_limit (user_id, ts) VALUES (?, ?)')
    .bind(userId, now).run();
  await env.DB.prepare('DELETE FROM new_device_alert_rate_limit WHERE ts < ?').bind(now - NEW_DEVICE_ALERT_RL_WINDOW_MS).run();
}
