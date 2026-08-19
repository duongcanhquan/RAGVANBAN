/**
 * Google Drive sync API
 *   GET  /api/drive/status
 *   GET  /api/drive/list
 *   POST /api/drive/ingest   { fileId }  — SSE
 *   POST /api/drive/sync     { limit? }  — SSE
 */

const express = require('express');
const { isDriveConfigured, listPdfInFolder } = require('../services/googleDrive');
const { ingestDriveFile, syncDriveFolder } = require('../services/driveIngest');
const { requireSuperAdmin } = require('../middleware/requireAdmin');

const router = express.Router();

function initSse(res) {
  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  if (typeof res.flushHeaders === 'function') res.flushHeaders();
}

function sendEvent(res, event, data) {
  res.write(`event: ${event}\n`);
  res.write(`data: ${JSON.stringify(data)}\n\n`);
}

router.get('/status', (_req, res) => {
  res.json({
    configured: isDriveConfigured(),
    folderId: process.env.GOOGLE_DRIVE_FOLDER_ID || null,
  });
});

router.get('/list', requireSuperAdmin, async (_req, res) => {
  try {
    if (!isDriveConfigured()) {
      res.status(400).json({ error: 'Google Drive chưa cấu hình' });
      return;
    }
    const files = await listPdfInFolder();
    res.json({ files });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/ingest', requireSuperAdmin, async (req, res) => {
  const fileId = String(req.body?.fileId || '').trim();
  if (!fileId) {
    res.status(400).json({ error: 'Thiếu fileId' });
    return;
  }

  initSse(res);
  let closed = false;
  req.on('close', () => {
    closed = true;
  });

  try {
    const result = await ingestDriveFile(fileId, {
      onProgress: (p) => {
        if (!closed) sendEvent(res, 'progress', p);
      },
    });
    if (!closed) {
      sendEvent(res, 'done', { ok: true, ...result });
      res.end();
    }
  } catch (err) {
    if (!closed) {
      sendEvent(res, 'error', { message: err.message });
      res.end();
    }
  }
});

router.post('/sync', requireSuperAdmin, async (req, res) => {
  initSse(res);
  let closed = false;
  req.on('close', () => {
    closed = true;
  });

  try {
    const limit = Number(req.body?.limit) || 20;
    const result = await syncDriveFolder({
      limit,
      onProgress: (p) => {
        if (!closed) sendEvent(res, 'progress', p);
      },
    });
    if (!closed) {
      sendEvent(res, 'done', { ok: true, ...result });
      res.end();
    }
  } catch (err) {
    if (!closed) {
      sendEvent(res, 'error', { message: err.message });
      res.end();
    }
  }
});

module.exports = router;
