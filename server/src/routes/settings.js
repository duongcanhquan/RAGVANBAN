/**
 * Cài đặt công khai (từ khóa tìm nhanh, giọng nói).
 */

const express = require('express');
const { getQuickKeywords } = require('../services/appSettings');
const { getTalk, publicTalkPayload } = require('../services/voiceTalk');
const { getRagConfig, publicRagPayload } = require('../services/ragConfig');

const router = express.Router();

router.get('/quick-keywords', async (_req, res, next) => {
  try {
    res.json(await getQuickKeywords());
  } catch (err) {
    next(err);
  }
});

router.get('/voice-talk', async (_req, res, next) => {
  try {
    const talk = await getTalk();
    res.json({ ok: true, ...publicTalkPayload(talk) });
  } catch (err) {
    next(err);
  }
});

router.get('/rag', async (_req, res, next) => {
  try {
    const rag = await getRagConfig();
    res.json({ ok: true, ...publicRagPayload(rag) });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
