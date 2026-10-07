// This file is the `main` entry Cloudflare Workers loads (see wrangler.toml) —
// it stays at this path/name so wrangler.toml, package.json, and
// test/worker.test.mjs's imports all keep working unchanged. All actual
// implementation now lives under src/: shared helpers in src/lib/*.js,
// content data in src/data/*.js. This file is just fetch()/scheduled() plus
// a re-export block so existing unit-test imports keep resolving. See
// CLAUDE.md's opening section and README.md's "Project Structure" for the
// full module map.

import {
  jsonResponse,
  addSecurityHeaders,
  notFoundResponse,
  parseCookies,
  clientIP,
  timingSafeEqual,
  base64ImageMatchesType,
} from './src/lib/http.js';

import { escapeHtml, renderContent, getTopicSVG } from './src/lib/render.js';

import {
  hashPassword,
  verifyPassword,
  signJWT,
  verifyJWT,
  GUEST_SESSION_SECONDS,
} from './src/lib/auth.js';

import {
  ROOM_RL_WINDOW_MS,
  FEEDBACK_RL_WINDOW_MS,
  EMAIL_ACTION_RL_WINDOW_MS,
  SIGNUP_RL_WINDOW_MS,
  CHALLENGE_SUBMIT_RL_WINDOW_MS,
  WEBEXPLOIT_LOGIN_RL_WINDOW_MS,
} from './src/lib/ratelimit.js';

import { handleAuthRoutes } from './src/routes/auth.js';
import { handleProfileRoutes } from './src/routes/profile.js';
import { handleDiscordRoutes } from './src/routes/discord.js';
import { handleUserRoutes } from './src/routes/users.js';
import { handleAdminRoutes } from './src/routes/admin.js';
import { handleAnnouncementsRoutes } from './src/routes/announcements.js';
import { handleEventsRoutes } from './src/routes/events.js';
import { handleFeedbackRoutes } from './src/routes/feedback.js';
import { handleRoomsRoutes } from './src/routes/rooms.js';
import { handleQuestionBankRoutes } from './src/routes/question-bank.js';
import { handleInstructorRoutes } from './src/routes/instructor.js';
import { handleSeoRoutes } from './src/routes/seo.js';
import { handleTopicsRoutes } from './src/routes/topics.js';
import { handleChallengesRoutes } from './src/routes/challenges.js';
import { handleWebExploitationRoutes } from './src/routes/web-exploitation.js';
import { handlePagesRoutes } from './src/routes/pages.js';

import {
  dateStrUTC,
  nextStreak,
  generateRoomCode,
  parseCSVLine,
  parseCSV,
  validateJSONQuestions,
  computeMissRates,
} from './src/lib/util.js';

import {
  topics,
  topicFraming,
  topicsWithCheatSheet,
  pathwayStages,
  pathwayStageTopics,
  pathwayBadges,
  topicCard,
  pathwayHtml,
  topicMetaTags,
} from './src/data/topics.js';

import {
  ctfModules,
  CHALLENGE_PARTS,
  challengeModuleMetaTags,
  renderChallengeModule,
  challengeModuleNavHtml,
  challengeCard,
  challengesHubCards,
} from './src/data/challenges.js';

// ─── Test Exports ─────────────────────────────────────────────────────────────
// Named exports for unit testing. The Workers runtime uses only `export default`
// below and ignores these; they let test/worker.test.mjs import pure helpers.
// Every name re-exported here now actually lives in src/ — see the imports
// above for exactly where.
export {
  base64ImageMatchesType,
  parseCookies,
  timingSafeEqual,
  hashPassword,
  verifyPassword,
  signJWT,
  verifyJWT,
  generateRoomCode,
  parseCSVLine,
  parseCSV,
  validateJSONQuestions,
  escapeHtml,
  renderContent,
  getTopicSVG,
  addSecurityHeaders,
  clientIP,
  jsonResponse,
  dateStrUTC,
  nextStreak,
  topics,
  topicsWithCheatSheet,
  pathwayStages,
  pathwayStageTopics,
  pathwayBadges,
  topicFraming,
  topicCard,
  pathwayHtml,
  topicMetaTags,
  computeMissRates,
  ctfModules,
  CHALLENGE_PARTS,
  challengeCard,
  challengesHubCards,
  challengeModuleMetaTags,
  renderChallengeModule,
  challengeModuleNavHtml,
};

// ─── Worker Entry Point ───────────────────────────────────────────────────────

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;
    // Cookies get the Secure flag whenever the request itself arrived over
    // HTTPS (always true in prod; `wrangler dev` defaults to plain HTTP, so
    // this keeps local login working without a Secure cookie the browser
    // would silently refuse to store).
    const secureCookie = url.protocol === 'https:';

    // ── Auth & Progress API ──────────────────────────────────────────────────
    {
      const r = await handleAuthRoutes(request, env, url, path, secureCookie);
      if (r) return r;
    }

    // ── Profile API ──────────────────────────────────────────────────────────
    {
      const r = await handleProfileRoutes(request, env, url, path, secureCookie);
      if (r) return r;
    }

    // ─── Discord Account Pairing (see docs/plan-discord-pairing.md) ─────────
    {
      const r = await handleDiscordRoutes(request, env, url, path, secureCookie);
      if (r) return r;
    }

    // ── Public user lookup, member directory, leaderboards ───────────────────
    {
      const r = await handleUserRoutes(request, env, url, path, secureCookie);
      if (r) return r;
    }

    // ── Admin API ────────────────────────────────────────────────────────────
    {
      const r = await handleAdminRoutes(request, env, url, path, secureCookie);
      if (r) return r;
    }

    // ── Announcements API ────────────────────────────────────────────────────
    {
      const r = await handleAnnouncementsRoutes(request, env, url, path, secureCookie);
      if (r) return r;
    }

    // ── Events API ────────────────────────────────────────────────────────────
    {
      const r = await handleEventsRoutes(request, env, url, path, secureCookie);
      if (r) return r;
    }

    // ── Feedback API ─────────────────────────────────────────────────────────
    {
      const r = await handleFeedbackRoutes(request, env, url, path, secureCookie);
      if (r) return r;
    }

    // ── Quiz Rooms API ───────────────────────────────────────────────────────
    {
      const r = await handleRoomsRoutes(request, env, url, path, secureCookie);
      if (r) return r;
    }

    // ── Question Bank API ─────────────────────────────────────────────────────
    {
      const r = await handleQuestionBankRoutes(request, env, url, path, secureCookie);
      if (r) return r;
    }

    // ── Instructor Analytics: site-wide topic-quiz completion ────────────────
    {
      const r = await handleInstructorRoutes(request, env, url, path, secureCookie);
      if (r) return r;
    }

    // ── robots.txt / sitemap.xml ──────────────────────────────────────────────
    {
      const r = await handleSeoRoutes(request, env, url, path, secureCookie);
      if (r) return r;
    }

    // ── API: topics list / single topic ───────────────────────────────────────
    {
      const r = await handleTopicsRoutes(request, env, url, path, secureCookie);
      if (r) return r;
    }

    // ── API: challenge answer-keys / progress / submit ────────────────────────
    {
      const r = await handleChallengesRoutes(request, env, url, path, secureCookie);
      if (r) return r;
    }

    // ── Web Exploitation Lab ──────────────────────────────────────────────────
    {
      const r = await handleWebExploitationRoutes(request, env, url, path, secureCookie);
      if (r) return r;
    }

    // ── HTML view routes → SSR injection, served via the [assets] binding ────
    {
      const r = await handlePagesRoutes(request, env, url, path, secureCookie);
      if (r) return r;
    }

    // ── Everything else: try the asset binding directly (css, js, images) ────
    try {
      const assetResponse = await env.ASSETS.fetch(request);
      if (assetResponse.ok) {
        const headers = addSecurityHeaders(new Headers(assetResponse.headers));
        return new Response(assetResponse.body, {
          status: assetResponse.status,
          headers,
        });
      }
    } catch (_) {
      // fall through
    }

    return notFoundResponse();
  },

  // Cron Trigger: prune expired brute-force rate-limit rows and abandoned
  // guest accounts. Rate-limit tables already self-prune on write, so that
  // part just clears residual rows once traffic stops. Schedule is defined
  // in wrangler.toml ([triggers] crons).
  async scheduled(event, env, ctx) {
    if (!env.DB) return;
    ctx.waitUntil(
      env.DB.prepare('DELETE FROM room_lookup_failures WHERE ts < ?')
        .bind(Date.now() - ROOM_RL_WINDOW_MS)
        .run()
    );
    ctx.waitUntil(
      env.DB.prepare('DELETE FROM feedback_rate_limit WHERE ts < ?')
        .bind(Date.now() - FEEDBACK_RL_WINDOW_MS)
        .run()
    );
    ctx.waitUntil(
      env.DB.prepare('DELETE FROM email_action_rate_limit WHERE ts < ?')
        .bind(Date.now() - EMAIL_ACTION_RL_WINDOW_MS)
        .run()
    );
    ctx.waitUntil(
      env.DB.prepare('DELETE FROM signup_rate_limit WHERE ts < ?')
        .bind(Date.now() - SIGNUP_RL_WINDOW_MS)
        .run()
    );
    ctx.waitUntil(
      env.DB.prepare('DELETE FROM challenge_submit_rate_limit WHERE ts < ?')
        .bind(Date.now() - CHALLENGE_SUBMIT_RL_WINDOW_MS)
        .run()
    );
    if (env.WEBEXPLOIT_DB) {
      ctx.waitUntil(
        env.WEBEXPLOIT_DB.prepare('DELETE FROM webexploit_login_rate_limit WHERE ts < ?')
          .bind(Date.now() - WEBEXPLOIT_LOGIN_RL_WINDOW_MS)
          .run()
      );
    }

    // Guest accounts that never upgraded (see /api/auth/upgrade) are dead
    // weight once their session has expired — nothing can log back into
    // them (guests have no password), so they'd otherwise sit in the DB
    // forever. Batched (one transaction, ordered child-tables-first) so a
    // guest mid-upgrade can't be deleted out from under that request — by
    // the time this runs their role is already 'member' and the WHERE
    // excludes them regardless.
    const guestCutoff = Date.now() - GUEST_SESSION_SECONDS * 1000;
    ctx.waitUntil(
      env.DB.batch([
        env.DB.prepare(`
          DELETE FROM quiz_room_answers WHERE attempt_id IN (
            SELECT id FROM quiz_room_attempts WHERE user_id IN (
              SELECT id FROM users WHERE role = 'guest' AND created_at < ?
            )
          )
        `).bind(guestCutoff),
        env.DB.prepare(`
          DELETE FROM quiz_room_attempts WHERE user_id IN (
            SELECT id FROM users WHERE role = 'guest' AND created_at < ?
          )
        `).bind(guestCutoff),
        env.DB.prepare(`
          DELETE FROM quiz_results WHERE user_id IN (
            SELECT id FROM users WHERE role = 'guest' AND created_at < ?
          )
        `).bind(guestCutoff),
        env.DB.prepare(`
          DELETE FROM challenge_completions WHERE user_id IN (
            SELECT id FROM users WHERE role = 'guest' AND created_at < ?
          )
        `).bind(guestCutoff),
        env.DB.prepare(`
          DELETE FROM challenge_submit_rate_limit WHERE user_id IN (
            SELECT id FROM users WHERE role = 'guest' AND created_at < ?
          )
        `).bind(guestCutoff),
        env.DB.prepare(`DELETE FROM users WHERE role = 'guest' AND created_at < ?`).bind(guestCutoff),
      ])
    );
  },
};
