/**
 * Google Drive sync API
 *   GET  /api/drive/status
 *   GET  /api/drive/list
 *   POST /api/drive/ingest   { fileId }
 *   POST /api/drive/sync     { limit?, folderId? }
 */

const express = require('express');
const { hasAnyDriveKey, listPdfInFolder } = require('../services/googleDrive');
const { ingestDriveFile, syncDriveFolder } = require('../services/driveIngest');
const { requireAdmin, requireSuperAdmin } = require('../middleware/requireAdmin');
const { getFlags, listDriveSources } = require('../services/integrations');
const { assertCanUseCategory } = require('../services/adminAccess');

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

router.get('/status', requireAdmin, async (_req, res, next) => {
  try {
    const [flags, hasKey] = await Promise.all([getFlags(), hasAnyDriveKey()]);
    res.json({
      configured: hasKey && flags.driveEnabled,
      hasServiceAccount: hasKey,
      driveEnabled: flags.driveEnabled,
      n8nEnabled: flags.n8nEnabled,
    });
  } catch (err) {
    next(err);
  }
});

router.get('/list', requireAdmin, async (req, res) => {
  try {
    if (!(await hasAnyDriveKey())) {
      res.status(400).json({ error: 'Chưa dán Google service account trong Cài đặt' });
      return;
    }
    const flags = await getFlags();
    if (!flags.driveEnabled) {
      res.status(403).json({ error: 'Google Drive đang tắt trong Cài đặt' });
      return;
    }
    const folderId = String(req.query.folderId || '').trim();
    const sources = await listDriveSources();
    const ids = folderId
      ? [folderId]
      : sources.filter((s) => s.enabled).map((s) => s.folderId);
    const files = [];
    for (const id of ids) {
      const listed = await listPdfInFolder(id);
      files.push(...listed.map((f) => ({ ...f, folderId: id })));
    }
    res.json({ files });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/ingest', requireAdmin, async (req, res) => {
  const fileId = String(req.body?.fileId || '').trim();
  if (!fileId) {
    res.status(400).json({ error: 'Thiếu fileId' });
    return;
  }

  try {
    const flags = await getFlags();
    if (!flags.driveEnabled) {
      res.status(403).json({ error: 'Google Drive đang tắt trong Cài đặt' });
      return;
    }
    const categoryId = req.body?.categoryId || null;
    assertCanUseCategory(req.admin, categoryId);
  } catch (err) {
    res.status(err.status || 400).json({ error: err.message });
    return;
  }

  initSse(res);
  let closed = false;
  req.on('close', () => {
    closed = true;
  });

  try {
    const result = await ingestDriveFile(fileId, {
      categoryId: req.body?.categoryId || null,
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
  try {
    const flags = await getFlags();
    if (!flags.driveEnabled) {
      res.status(403).json({ error: 'Google Drive đang tắt trong Cài đặt' });
      return;
    }
  } catch (err) {
    res.status(err.status || 400).json({ error: err.message });
    return;
  }

  initSse(res);
  let closed = false;
  req.on('close', () => {
    closed = true;
  });

  try {
    const result = await syncDriveFolder({
      limit: Number(req.body?.limit) || 20,
      folderId: req.body?.folderId || null,
      categoryId: req.body?.categoryId || null,
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
