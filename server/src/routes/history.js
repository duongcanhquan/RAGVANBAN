/**
 * GET  /api/history?sessionId=&limit=  — chỉ quản trị (không lộ log người khác)
 * GET  /api/history/:id
 * POST /api/history/:id/mark-knowledge
 * POST /api/history/save
 */

const express = require('express');
const { listChatLogs, getChatLog, markChatKnowledge, insertChatLog } = require('../services/supabase');
const { requireAdmin } = require('../middleware/requireAdmin');
const { createScenario } = require('../services/knowledgeStore');

const router = express.Router();

router.get('/', requireAdmin, async (req, res, next) => {
  try {
    const sessionId = String(req.query.sessionId || '').trim();
    const limit = Math.min(Number(req.query.limit) || 40, 100);
    const knowledgeOnly = req.query.knowledge === '1' || req.query.knowledge === 'true';
    const result = await listChatLogs({
      sessionId: sessionId || undefined,
      limit,
      knowledgeOnly,
    });
    res.json(result);
  } catch (err) {
    next(err);
  }
});

router.get('/:id', requireAdmin, async (req, res) => {
  const result = await getChatLog(req.params.id);
  if (!result.ok) {
    res.status(404).json(result);
    return;
  }
  res.json(result);
});

router.post('/save', requireAdmin, async (req, res) => {
  const { sessionId, question, answer, citationsUsed, markKnowledge } = req.body || {};
  if (!question) {
    res.status(400).json({ error: 'Thiếu question' });
    return;
  }
  const inserted = await insertChatLog({
    userSession: sessionId || 'anonymous',
    question,
    answer: answer || '',
    citationsUsed: citationsUsed || [],
  });
  if (markKnowledge && inserted.id) {
    await markChatKnowledge(inserted.id, true);
  }
  res.json(inserted);
});

router.post('/:id/mark-knowledge', requireAdmin, (req, res, next) => {
  markAndMaybeScenario(req, res).catch(next);
});

async function markAndMaybeScenario(req, res) {
  const marked = req.body?.marked !== false;
  const result = await markChatKnowledge(req.params.id, marked);

  if (marked && req.body?.asScenario) {
    const log = await getChatLog(req.params.id);
    if (log.ok && log.item) {
      await createScenario({
        title: String(log.item.question || '').slice(0, 120),
        situation: `Từ lịch sử chat: ${log.item.question}`,
        suggested_question: log.item.question,
        sample_answer: log.item.answer || '',
        tags: ['từ-chat'],
        created_by: log.item.user_session || 'anonymous',
      });
    }
  }

  res.json(result);
}

module.exports = router;
