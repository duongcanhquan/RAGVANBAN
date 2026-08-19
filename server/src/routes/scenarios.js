/**
 * Kho tình huống Q&A theo hạng mục — admin nhập sẵn, trang ngoài chỉ xem/tìm.
 * GET    /api/scenarios?q=&categoryId=
 * POST   /api/scenarios
 * PATCH  /api/scenarios/:id
 * DELETE /api/scenarios/:id
 * POST   /api/scenarios/:id/use
 */

const express = require('express');
const {
  listScenarios,
  getScenario,
  createScenario,
  updateScenario,
  deleteScenario,
  bumpUse,
} = require('../services/knowledgeStore');
const { requireAdmin } = require('../middleware/requireAdmin');
const { assertCanUseCategory, isSuperAdmin } = require('../services/adminAccess');

const router = express.Router();

function categoryFromBody(body = {}) {
  return String(body.categoryId || body.category_id || '').trim();
}

function assertWriteAccess(admin, categoryId) {
  if (isSuperAdmin(admin)) return;
  assertCanUseCategory(admin, categoryId);
}

router.get('/', async (req, res, next) => {
  try {
    const q = String(req.query.q || '').trim();
    const categoryId = String(req.query.categoryId || req.query.category_id || '').trim();
    const limit = Math.min(Number(req.query.limit) || 200, 400);
    const result = await listScenarios({ q, categoryId, limit });
    res.json(result);
  } catch (err) {
    next(err);
  }
});

router.post('/', requireAdmin, async (req, res, next) => {
  try {
    const categoryId = categoryFromBody(req.body);
    assertWriteAccess(req.admin, categoryId);
    const question = String(req.body?.question || req.body?.suggested_question || '').trim();
    const answer = String(req.body?.answer || req.body?.sample_answer || '').trim();
    if (!question || !answer) {
      res.status(400).json({ ok: false, error: 'Cần câu hỏi và câu trả lời sẵn' });
      return;
    }
    const result = await createScenario({
      ...req.body,
      suggested_question: question,
      sample_answer: answer,
      situation: req.body?.situation || question,
      title: req.body?.title || question.slice(0, 120),
      category_id: categoryId || null,
      created_by: req.admin?.email || req.admin?.id || 'admin',
    });
    if (!result.ok) {
      res.status(400).json(result);
      return;
    }
    res.status(201).json(result);
  } catch (err) {
    if (err.status) {
      res.status(err.status).json({ ok: false, error: err.message });
      return;
    }
    next(err);
  }
});

router.patch('/:id', requireAdmin, async (req, res, next) => {
  try {
    const current = await getScenario(req.params.id);
    if (!current.ok) {
      res.status(404).json(current);
      return;
    }
    const categoryId = categoryFromBody(req.body) || current.item.category_id || '';
    assertWriteAccess(req.admin, current.item.category_id);
    assertWriteAccess(req.admin, categoryId);
    const question = String(
      req.body?.question || req.body?.suggested_question || current.item.suggested_question || ''
    ).trim();
    const answer = String(
      req.body?.answer || req.body?.sample_answer || current.item.sample_answer || ''
    ).trim();
    if (!question || !answer) {
      res.status(400).json({ ok: false, error: 'Cần câu hỏi và câu trả lời sẵn' });
      return;
    }
    const result = await updateScenario(req.params.id, {
      ...current.item,
      ...req.body,
      suggested_question: question,
      sample_answer: answer,
      situation: req.body?.situation || current.item.situation || question,
      title: req.body?.title || current.item.title || question.slice(0, 120),
      category_id: categoryId || null,
    });
    if (!result.ok) {
      res.status(400).json(result);
      return;
    }
    res.json(result);
  } catch (err) {
    if (err.status) {
      res.status(err.status).json({ ok: false, error: err.message });
      return;
    }
    next(err);
  }
});

router.delete('/:id', requireAdmin, async (req, res, next) => {
  try {
    const current = await getScenario(req.params.id);
    if (!current.ok) {
      res.status(404).json(current);
      return;
    }
    assertWriteAccess(req.admin, current.item.category_id);
    const result = await deleteScenario(req.params.id);
    res.json(result);
  } catch (err) {
    if (err.status) {
      res.status(err.status).json({ ok: false, error: err.message });
      return;
    }
    next(err);
  }
});

router.post('/:id/use', async (req, res) => {
  const current = await getScenario(req.params.id);
  if (!current.ok) {
    res.status(404).json(current);
    return;
  }
  await bumpUse(req.params.id);
  res.json({
    ok: true,
    item: current.item,
    ask: current.item.question || current.item.suggested_question || current.item.title,
  });
});

module.exports = router;
