import { addSecurityHeaders } from '../lib/http.js';
import { topics, topicFraming, topicsWithCheatSheet } from '../data/topics.js';

// GET /api/topics (summary list) and GET /api/topic/:id (single topic).
export async function handleTopicsRoutes(request, env, url, path, secureCookie) {
  if (path === '/api/topics') {
    const summary = topics.map(({ id, title, icon, shortDesc, image, difficulty, readTime }) => ({
      id, title, icon, shortDesc, image, difficulty, readTime,
      hasCheatSheet: topicsWithCheatSheet.has(id),
    }));
    const headers = addSecurityHeaders(new Headers({ 'Content-Type': 'application/json' }));
    return new Response(JSON.stringify(summary), { headers });
  }

  const topicMatch = path.match(/^\/api\/topic\/(\w+)$/);
  if (topicMatch) {
    const topic = topics.find(t => t.id === topicMatch[1]);
    if (!topic) {
      const headers = addSecurityHeaders(new Headers({ 'Content-Type': 'application/json' }));
      return new Response(JSON.stringify({ error: 'Topic not found' }), { status: 404, headers });
    }
    const headers = addSecurityHeaders(new Headers({ 'Content-Type': 'application/json' }));
    return new Response(JSON.stringify({
      ...topic,
      ...(topicFraming[topic.id] || {}),
      hasCheatSheet: topicsWithCheatSheet.has(topic.id),
    }), { headers });
  }

  return null;
}
