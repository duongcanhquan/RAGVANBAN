/**
 * GET /api/admin/stats — tổng câu hỏi + tổng tài liệu.
 */

const express = require('express');
const fs = require('fs');
const path = require('path');
const { countChatLogs, countDocuments, isConfigured } = require('../services/supabase');
const { listPdfFiles } = require('../ingestion/listPdfs');

const router = express.Router();

function countLocalPdfs() {
  const dirs = [
    path.resolve(__dirname, '../../data'),
    path.resolve(__dirname, '../../../data'),
    path.resolve(__dirname, '../../data/uploads'),
  ];
  let total = 0;
  for (const dir of dirs) {
    try {
      if (!fs.existsSync(dir)) continue;
      total += listPdfFiles(dir).length;
    } catch {
      // ignore
    }
  }
  return total;
}

router.get('/stats', async (_req, res) => {
  const chats = await countChatLogs();
  const docs = await countDocuments();
  const localPdfs = countLocalPdfs();

  res.json({
    supabaseConfigured: isConfigured(),
    totalQuestions: chats.count || 0,
    totalDocuments: docs.ok ? docs.count : localPdfs,
    localPdfFallback: localPdfs,
    timestamp: new Date().toISOString(),
  });
});

module.exports = router;
