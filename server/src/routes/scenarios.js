/**
 * Kho tình huống đặc thù mẫu.
 * GET    /api/scenarios
 * POST   /api/scenarios
 * DELETE /api/scenarios/:id
 * POST   /api/scenarios/:id/use
 */

const express = require('express');
const {
  listScenarios,
  createScenario,
  deleteScenario,
  bumpUse,
} = require('../services/knowledgeStore');

const router = express.Router();

router.get('/', async (req, res) => {
  const q = String(req.query.q || '').trim();
  const limit = Math.min(Number(req.query.limit) || 100, 200);
  const result = await listScenarios({ q, limit });
  res.json(result);
});

router.post('/', async (req, res) => {
  const result = await createScenario(req.body || {});
  if (!result.ok) {
    res.status(400).json(result);
    return;
  }
  res.status(201).json(result);
});

router.delete('/:id', async (req, res) => {
  const result = await deleteScenario(req.params.id);
  res.json(result);
});

router.post('/:id/use', async (req, res) => {
  const listed = await listScenarios({ limit: 200 });
  const item = (listed.items || []).find((s) => s.id === req.params.id);
  if (!item) {
    res.status(404).json({ ok: false, error: 'Không tìm thấy tình huống' });
    return;
  }
  await bumpUse(req.params.id);
  res.json({
    ok: true,
    item,
    ask: item.suggested_question || item.title,
  });
});

module.exports = router;
