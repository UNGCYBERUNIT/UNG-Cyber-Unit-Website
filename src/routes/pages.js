import { addSecurityHeaders, notFoundResponse } from '../lib/http.js';
import { escapeHtml, renderContent, getTopicSVG } from '../lib/render.js';
import {
  topics,
  topicFraming,
  topicsWithCheatSheet,
  homeTopicCards,
  pathwayHtml,
  topicMetaTags,
} from '../data/topics.js';
import {
  ctfModules,
  challengeModuleMetaTags,
  renderChallengeModule,
  challengeModuleNavHtml,
  challengesHubCards,
} from '../data/challenges.js';

// HTML view routes → serve from views/ via the [assets] binding, with
// per-request SSR injection (SEO meta + server-rendered content) for
// pages that need it. Pages/Workers with [assets] in wrangler.toml serves
// public/ automatically; for these routes we explicitly pass through to
// the asset binding so we can inject content first.
export async function handlePagesRoutes(request, env, url, path, secureCookie) {
  // Map clean paths to their HTML file equivalents in the public dir.
  const viewRoutes = {
    '/': '/',
    '/resources': '/resources',
    '/about': '/about',
    '/instructor': '/instructor',
    '/admin': '/admin',
    '/quiz': '/quiz',
    '/profile': '/profile',
    '/start': '/start',
    '/leaderboard': '/leaderboard',
    '/members': '/members',
    '/announcements': '/announcements',
    '/events': '/events',
    '/contact': '/contact',
    '/student-hub': '/student-hub',
    '/log-analysis-challenge': '/log-analysis-challenge',
    '/network-traffic-challenge': '/network-traffic-challenge',
    '/challenges': '/challenges',
    '/lab/web-exploitation-portal': '/lab/web-exploitation-portal',
    '/lab/staging-notes': '/lab/staging-notes',
  };

  // topic/:id — any path matching /topic/<something>
  const topicPageMatch = path.match(/^\/topic\/\w+$/);
  // quiz/:code — any path matching /quiz/XXXX-XXXX
  const quizRoomMatch = path.match(/^\/quiz\/[A-Z0-9]{4}-[A-Z0-9]{4}$/i);
  // u/:username — public profile view; validity/privacy is resolved client-side
  // via /api/user/:username, same pattern as quiz/:code.
  const publicProfilePageMatch = path.match(/^\/u\/[a-zA-Z0-9_]+$/);
  // verify/:code — static trust page for the UNG Cyber Unit Discord bot's
  // pwn.college account-link codes (bot repo: J-Acklen/cyber_discord_bot). The
  // trailing segment is a random hex string the bot has the member paste into
  // their pwn.college profile; the bot only reads it back from pwn.college and
  // never fetches this URL. It is never read or validated here — any
  // well-formed code serves the same page. Optional trailing slash so a human
  // who fat-fingers `/verify/<code>/` still lands on the trust page, not a 404.
  const verifyPageMatch = path.match(/^\/verify\/[a-zA-Z0-9]+\/?$/);
  // challenges/:id — a generic (new-style) CTF module page. Legacy
  // modules' ids resolve via their own pageUrl (viewRoutes above), not
  // this path, so requesting a legacy id here falls through to 404 below.
  const challengeModulePageMatch = path.match(/^\/challenges\/([\w-]+)$/);

  let assetPath = null;
  if (viewRoutes[path] !== undefined) {
    assetPath = viewRoutes[path];
  } else if (topicPageMatch) {
    assetPath = '/topic';
  } else if (quizRoomMatch) {
    assetPath = '/quiz-room';
  } else if (publicProfilePageMatch) {
    assetPath = '/u';
  } else if (verifyPageMatch) {
    assetPath = '/verify';
  } else if (challengeModulePageMatch) {
    assetPath = '/challenge-module';
  } else if (path === '/sop') {
    assetPath = '/Cyber_Unit_SOP.pdf';
  } else if (path === '/feedback') {
    // Renamed to /contact — redirect any old bookmarks/links.
    return Response.redirect(`${url.origin}/contact`, 301);
  } else if (path === '/danica') {
    return new Response('I love you! <3', {
      headers: addSecurityHeaders(new Headers({ 'Content-Type': 'text/plain; charset=utf-8' })),
    });
  }

  if (assetPath === null) return null;

  // Fetch from the asset binding using the mapped path
  const assetUrl = new URL(assetPath, url.origin);
  try {
    const assetResponse = await env.ASSETS.fetch(assetUrl.toString());
    if (assetResponse.ok) {
      const headers = addSecurityHeaders(new Headers(assetResponse.headers));
      // These pages are worker-generated (SEO meta + server-rendered grids
      // are injected per request). Don't inherit the static asset's
      // cacheability, or the edge freezes a stale copy (e.g. an empty /start).
      headers.delete('ETag');
      headers.set('Cache-Control', 'no-store');

      // Inject per-topic SEO metadata AND the actual lesson content into the
      // shared topic.html shell. An unknown topic id must 404, not silently
      // serve the generic shell as a 200 (that's a soft 404 — bad for search
      // indexing). The lesson content itself must also not be left as the
      // client-rendered "Loading topic..." placeholder: a crawler that
      // doesn't run JS (or gives up before the fetch to /api/topic/:id
      // resolves) would see identical thin content on every topic page,
      // which is exactly what got /topic/02 flagged as a Soft 404.
      if (topicPageMatch) {
        const topic = topics.find(t => t.id === path.split('/').pop());
        if (!topic) return notFoundResponse();
        const framed = { ...topic, ...(topicFraming[topic.id] || {}) };
        const html = (await assetResponse.text())
          .replace('<title>CyberUnit @ UNG — Topic</title>', topicMetaTags(topic))
          .replace('<span id="breadcrumbTopic">Loading...</span>', `<span id="breadcrumbTopic">${escapeHtml(topic.title)}</span>`)
          .replace('<span class="topic-icon-large" id="topicIcon" aria-hidden="true"></span>', `<span class="topic-icon-large" id="topicIcon" aria-hidden="true">${topic.icon}</span>`)
          .replace('<h1 class="topic-title" id="topicTitle">Loading...</h1>', `<h1 class="topic-title" id="topicTitle">${escapeHtml(topic.title)}</h1>`)
          .replace('<span class="badge badge-beginner" id="topicDifficulty">Beginner</span>', `<span class="badge badge-${topic.difficulty.toLowerCase()}" id="topicDifficulty">${escapeHtml(topic.difficulty)}</span>`)
          .replace('<span class="read-time" id="topicReadTime"></span>', `<span class="read-time" id="topicReadTime">${escapeHtml(topic.readTime)}</span>`)
          .replace(
            '<a href="#" id="cheatSheetLink" class="btn btn-sm" hidden>Download Cheat-Sheet</a>',
            topicsWithCheatSheet.has(topic.id)
              ? `<a href="/cheatsheet/${topic.id}" id="cheatSheetLink" class="btn btn-sm">Download Cheat-Sheet</a>`
              : '<a href="#" id="cheatSheetLink" class="btn btn-sm" hidden>Download Cheat-Sheet</a>'
          )
          .replace('<div id="topicIllustration"></div>', `<div id="topicIllustration">${getTopicSVG(topic.id, topic.icon, topic.title)}</div>`)
          .replace(
            `<article class="topic-content" id="topicContent" aria-label="Topic content">
            <div style="color:var(--text-muted); font-family:'Share Tech Mono',monospace; padding:2rem 0; text-align:center;">
              Loading topic...
            </div>
          </article>`,
            `<article class="topic-content" id="topicContent" aria-label="Topic content">${renderContent(framed)}</article>`
          );
        headers.delete('Content-Length');
        headers.set('Content-Type', 'text/html; charset=utf-8');
        return new Response(html, { status: assetResponse.status, headers });
      }

      // Server-render the homepage topic grid + stat counts so the primary
      // content isn't dependent on a client-side fetch that crawlers may skip.
      if (path === '/') {
        const html = (await assetResponse.text())
          .replace('<!-- Populated by main.js -->', homeTopicCards())
          .replace('<strong id="statTopics">—</strong>', `<strong id="statTopics">${topics.length}</strong>`)
          .replace('<strong id="statQuizzes">—</strong>', `<strong id="statQuizzes">${topics.length}</strong>`);
        headers.delete('Content-Length');
        headers.set('Content-Type', 'text/html; charset=utf-8');
        return new Response(html, { status: assetResponse.status, headers });
      }

      // Server-render the Beginner Pathway into the /start page.
      if (path === '/start') {
        const html = (await assetResponse.text())
          .replace('<!-- PATHWAY -->', pathwayHtml());
        headers.delete('Content-Length');
        headers.set('Content-Type', 'text/html; charset=utf-8');
        return new Response(html, { status: assetResponse.status, headers });
      }

      // Server-render prev/next/hub nav into the two legacy (bespoke)
      // challenge pages — new-style pages get it as part of
      // renderChallengeModule()'s own returned content, below.
      if (path === '/log-analysis-challenge' || path === '/network-traffic-challenge') {
        const legacyModule = ctfModules.find(x => x.pageUrl === path);
        const html = (await assetResponse.text())
          .replace('<!-- CHALLENGE_MODULE_NAV -->', legacyModule ? challengeModuleNavHtml(legacyModule.id) : '');
        headers.delete('Content-Length');
        headers.set('Content-Type', 'text/html; charset=utf-8');
        return new Response(html, { status: assetResponse.status, headers });
      }

      // Server-render a generic CTF module page. An id that doesn't
      // exist, or that belongs to a legacy module (whose canonical URL
      // is elsewhere), 404s rather than serving an empty/wrong shell.
      if (challengeModulePageMatch) {
        const m = ctfModules.find(x => x.id === challengeModulePageMatch[1]);
        if (!m || m.pageUrl !== path) return notFoundResponse();
        const html = (await assetResponse.text())
          .replace('<title>CyberUnit @ UNG — Challenge</title>', challengeModuleMetaTags(m))
          .replace('data-challenge-id=""', `data-challenge-id="${m.id}"`)
          .replace('<!-- CHALLENGE_MODULE_CONTENT -->', renderChallengeModule(m));
        headers.delete('Content-Length');
        headers.set('Content-Type', 'text/html; charset=utf-8');
        return new Response(html, { status: assetResponse.status, headers });
      }

      // Server-render the CTF challenge hub grid into /challenges.
      if (path === '/challenges') {
        const html = (await assetResponse.text())
          .replace('<!-- Populated by main.js -->', challengesHubCards());
        headers.delete('Content-Length');
        headers.set('Content-Type', 'text/html; charset=utf-8');
        return new Response(html, { status: assetResponse.status, headers });
      }

      return new Response(assetResponse.body, {
        status: assetResponse.status,
        headers,
      });
    }
  } catch (_) {
    // fall through to 404
  }
  return notFoundResponse();
}
