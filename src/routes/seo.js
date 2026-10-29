import { addSecurityHeaders } from '../lib/http.js';
import { topics } from '../data/topics.js';
import { ctfModules } from '../data/challenges.js';

// /robots.txt and /sitemap.xml. Served from the worker so they're
// version-controlled and get the same security headers as everything else.
export async function handleSeoRoutes(request, env, url, path, secureCookie) {
  // robots.txt — deliberately does NOT Disallow private routes (/admin,
  // /instructor, /profile): robots.txt is public, so listing them would only
  // advertise them. Those pages are protected by auth, not by robots rules.
  if (path === '/robots.txt') {
    const body = [
      'User-agent: *',
      'Allow: /',
      'Disallow: /api/',
      // The PDF is also reachable at its raw static-asset path, which duplicates
      // the canonical /sop URL with no way to signal a canonical (PDFs can't
      // carry a <link rel="canonical">). Keep crawlers off the raw file.
      'Disallow: /Cyber_Unit_SOP.pdf',
      // Downloadable workshop assets (zip/pdf/pptx/pcapng) under
      // public/challenges/<id>/<file> — not standalone content pages worth
      // indexing. Wildcard requires a *further* "/" after the module id,
      // so it matches asset paths (.../<id>/<file>) but not the canonical
      // hub (/challenges) or a generic module page (/challenges/<id>)
      // itself — both of those should stay indexed.
      'Disallow: /challenges/*/',
      // Same reasoning as the SOP PDF above — the raw per-topic cheat-sheet
      // files are reachable at their static path but only the canonical
      // /cheatsheet/:id route should be indexed.
      'Disallow: /cheatsheets/',
      '',
      'Sitemap: https://ungcyberunit.org/sitemap.xml',
      '',
    ].join('\n');
    const headers = addSecurityHeaders(new Headers({ 'Content-Type': 'text/plain; charset=utf-8' }));
    return new Response(body, { headers });
  }

  // XML sitemap for search engines. Generated from the topics list so it
  // stays in sync as topics are added.
  if (path === '/sitemap.xml') {
    const base = 'https://ungcyberunit.org';
    // New-style module URLs (/challenges/:id) derive from ctfModules so a
    // future module doesn't need a manual sitemap addition; the two
    // legacy pages stay hardcoded like every other one-off page here.
    const paths = ['/', '/start', '/about', '/resources', '/sop', '/log-analysis-challenge', '/network-traffic-challenge', '/challenges', '/announcements', '/events', ...topics.map(t => `/topic/${t.id}`), ...ctfModules.filter(m => m.pageUrl.startsWith('/challenges/')).map(m => m.pageUrl)];
    const body = `<?xml version="1.0" encoding="UTF-8"?>\n`
      + `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n`
      + paths.map(p => `  <url><loc>${base}${p}</loc></url>`).join('\n')
      + `\n</urlset>\n`;
    const headers = addSecurityHeaders(new Headers({ 'Content-Type': 'application/xml; charset=utf-8' }));
    return new Response(body, { headers });
  }

  return null;
}
