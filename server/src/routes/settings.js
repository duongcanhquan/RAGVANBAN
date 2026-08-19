/**
 * Cài đặt công khai (từ khóa tìm nhanh trên chat).
 */

const express = require('express');
const { getQuickKeywords } = require('../services/appSettings');

const router = express.Router();

router.get('/quick-keywords', async (_req, res, next) => {
  try {
    res.json(await getQuickKeywords());
  } catch (err) {
    next(err);
  }
});

module.exports = router;
