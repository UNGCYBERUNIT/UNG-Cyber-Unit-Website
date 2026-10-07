import { jsonResponse } from '../lib/http.js';
import { requireRole } from '../lib/auth.js';

// Instructor Analytics: site-wide topic-quiz completion. Aggregate-only,
// instructor+ (not member-visible — internal usage data). Site-wide rather
// than per-class: quiz_results has no "class" concept (just
// user_id/topic_id/score, global across the site), and there's no roster
// to scope it to. Don't "fix" this into a per-instructor filter without
// first modeling a real class/roster concept.
export async function handleInstructorRoutes(request, env, url, path, secureCookie) {
  if (path !== '/api/instructor/topic-completion' || request.method !== 'GET') return null;

  if (!env.JWT_SECRET || !env.DB) return jsonResponse({ error: 'Server not configured' }, 503);
  const session = await requireRole(request, env, 'instructor');
  if (session instanceof Response) return session;

  const { results } = await env.DB.prepare(`
    SELECT topic_id, COUNT(DISTINCT user_id) AS completions, AVG(score * 1.0 / total) AS avg_pct
    FROM quiz_results
    GROUP BY topic_id
  `).all();
  return jsonResponse({ results: results ?? [] });
}
