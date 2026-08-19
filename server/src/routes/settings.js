/**
 * Cài đặt công khai (từ khóa tìm nhanh, giọng nói).
 */

const express = require('express');
const { getQuickKeywords } = require('../services/appSettings');
const { listDocuments } = require('../services/supabase');
const { mergePublicQuickKeywords } = require('../services/quickSuggest');
const { getTalk, publicTalkPayload } = require('../services/voiceTalk');
const { getRagConfig, publicRagPayload } = require('../services/ragConfig');

const router = express.Router();

router.get('/quick-keywords', async (_req, res, next) => {
  try {
    const saved = await getQuickKeywords();
    const listed = await listDocuments({ limit: 80 });
    const items = mergePublicQuickKeywords({
      catalogItems: listed.ok === false ? [] : listed.items || [],
      savedItems: saved.items || [],
    });
    res.json({ ok: true, source: 'catalog', items });
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
