import { jsonResponse } from '../lib/http.js';
import { requireRole } from '../lib/auth.js';
import { validateJSONQuestions } from '../lib/util.js';

// Question Bank API — reusable question templates, private per-instructor
// (no shared/department bank for v1 — see docs/plan-question-bank.md's
// Chunk 0). Same ownership pattern as Quiz Rooms: requireRole('instructor')
// then a created_by === session.sub || admin check on every read/write.
export async function handleQuestionBankRoutes(request, env, url, path, secureCookie) {
  if (!path.startsWith('/api/question-bank')) return null;

  if (!env.JWT_SECRET || !env.DB) return jsonResponse({ error: 'Server not configured' }, 503);
  const session = await requireRole(request, env, 'instructor');
  if (session instanceof Response) return session;

  // POST /api/question-bank — save a new template from posted JSON.
  // Reuses validateJSONQuestions() rather than reimplementing the shape
  // checks — same { question, type, answers, correct, explanation }
  // shape quiz_room_questions already stores.
  if (path === '/api/question-bank' && request.method === 'POST') {
    let body;
    try { body = await request.json(); } catch { return jsonResponse({ error: 'Invalid request body' }, 400); }
    const title = (body?.title ?? '').toString().trim();
    if (!title) return jsonResponse({ error: 'Title is required' }, 400);
    if (title.length > 200) return jsonResponse({ error: 'Title must be 200 characters or fewer' }, 400);

    const parseResult = validateJSONQuestions(body?.questions);
    if (parseResult.error) return jsonResponse({ error: parseResult.error }, 400);
    const { questions } = parseResult;

    const now = Date.now();
    const bankResult = await env.DB.prepare(
      'INSERT INTO question_bank (title, created_by, created_at) VALUES (?, ?, ?)'
    ).bind(title, session.sub, now).run();
    const bankId = bankResult.meta.last_row_id;

    await env.DB.batch(questions.map((q, i) =>
      env.DB.prepare(
        'INSERT INTO question_bank_items (bank_id, sort_order, type, question, answers, correct, explanation) VALUES (?, ?, ?, ?, ?, ?, ?)'
      ).bind(bankId, i, q.type ?? 'multiple_choice', q.question, JSON.stringify(q.answers), q.correct ?? null, q.explanation)
    ));

    return jsonResponse({ id: bankId, title, questionCount: questions.length, created_at: now }, 201);
  }

  // GET /api/question-bank — instructor lists their own banks only. No
  // ?all=1 admin escape hatch (unlike /api/rooms) — that's a shared-bank
  // decision this plan deliberately deferred.
  if (path === '/api/question-bank' && request.method === 'GET') {
    const { results } = await env.DB.prepare(`
      SELECT b.id, b.title, b.created_at, COUNT(i.id) AS question_count
      FROM question_bank b
      LEFT JOIN question_bank_items i ON i.bank_id = b.id
      WHERE b.created_by = ?
      GROUP BY b.id ORDER BY b.created_at DESC
    `).bind(session.sub).all();
    return jsonResponse({ results: results ?? [] });
  }

  const idMatch = path.match(/^\/api\/question-bank\/(\d+)$/);

  // GET /api/question-bank/:id — bank detail with items, ownership-checked.
  if (idMatch && request.method === 'GET') {
    const bank = await env.DB.prepare('SELECT id, title, created_by, created_at FROM question_bank WHERE id = ?').bind(idMatch[1]).first();
    if (!bank) return jsonResponse({ error: 'Question bank not found' }, 404);
    if (bank.created_by !== session.sub && session.role !== 'admin') {
      return jsonResponse({ error: 'Forbidden' }, 403);
    }

    const { results: items } = await env.DB.prepare(
      'SELECT id, sort_order, type, question, answers, correct, explanation FROM question_bank_items WHERE bank_id = ? ORDER BY sort_order'
    ).bind(bank.id).all();

    return jsonResponse({
      id: bank.id, title: bank.title, created_at: bank.created_at,
      questions: (items ?? []).map(q => ({
        id: q.id, sort_order: q.sort_order, type: q.type, question: q.question,
        answers: JSON.parse(q.answers), correct: q.correct, explanation: q.explanation,
      })),
    });
  }

  // DELETE /api/question-bank/:id — ownership-checked, cascades to items.
  if (idMatch && request.method === 'DELETE') {
    const bank = await env.DB.prepare('SELECT id, created_by FROM question_bank WHERE id = ?').bind(idMatch[1]).first();
    if (!bank) return jsonResponse({ error: 'Question bank not found' }, 404);
    if (bank.created_by !== session.sub && session.role !== 'admin') {
      return jsonResponse({ error: 'Forbidden' }, 403);
    }

    await env.DB.batch([
      env.DB.prepare('DELETE FROM question_bank_items WHERE bank_id = ?').bind(bank.id),
      env.DB.prepare('DELETE FROM question_bank WHERE id = ?').bind(bank.id),
    ]);
    return jsonResponse({ ok: true });
  }

  return jsonResponse({ error: 'Not found' }, 404);
}
