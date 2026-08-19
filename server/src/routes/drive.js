/**
 * Google Drive sync API
 *   GET  /api/drive/status
 *   GET  /api/drive/list
 *   POST /api/drive/ingest   { fileId }
 *   POST /api/drive/sync     { limit?, folderId? }
 */

const express = require('express');
const { hasAnyDriveKey, listPdfInFolder, getFileParentIds } = require('../services/googleDrive');
const { ingestDriveFile, syncDriveFolder } = require('../services/driveIngest');
const { requireAdmin, requireSuperAdmin } = require('../middleware/requireAdmin');
const { listenSseAbort } = require('../services/sseAbort');
const { publicErrorMessage } = require('../services/publicError');
const { getFlags, getIntegrationHealth, listDriveSources, sourcesVisibleTo } = require('../services/integrations');
const { isSuperAdmin, assertCanUseCategory } = require('../services/adminAccess');

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

function assertFolderVisible(admin, folderId, sources) {
  if (isSuperAdmin(admin) || !folderId) return;
  const visible = sourcesVisibleTo(admin, sources || []);
  if (!visible.some((s) => s.folderId === folderId && s.enabled !== false)) {
    const err = new Error('Bạn không được truy cập thư mục Drive này');
    err.status = 403;
    throw err;
  }
}

router.get('/status', requireAdmin, async (_req, res, next) => {
  try {
    const health = await getIntegrationHealth();
    res.json({
      configured: health.drive.on,
      hasServiceAccount: health.drive.hasKey,
      driveEnabled: health.drive.enabled,
      n8nEnabled: health.n8n.enabled,
      googleDriveReason: health.drive.reason,
      n8nWebhookReason: health.n8n.reason,
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
    const visible = sourcesVisibleTo(req.admin, sources);
    if (folderId) assertFolderVisible(req.admin, folderId, sources);
    const ids = folderId
      ? [folderId]
      : visible.filter((s) => s.enabled).map((s) => s.folderId);
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
    if (!isSuperAdmin(req.admin)) {
      const sources = await listDriveSources();
      const parents = await getFileParentIds(fileId);
      const ok = parents.some((p) => {
        try {
          assertFolderVisible(req.admin, p, sources);
          return true;
        } catch {
          return false;
        }
      });
      if (!ok) {
        res.status(403).json({ error: 'Bạn không được số hóa file ngoài thư mục được giao' });
        return;
      }
    }
  } catch (err) {
    res.status(err.status || 400).json({ error: err.message });
    return;
  }

  initSse(res);
  const aborted = listenSseAbort(res);
  const closed = () => aborted();

  try {
    const result = await ingestDriveFile(fileId, {
      categoryId: req.body?.categoryId || null,
      onProgress: (p) => {
        if (!closed()) sendEvent(res, 'progress', p);
      },
    });
    if (!closed()) {
      sendEvent(res, 'done', { ok: true, ...result });
      res.end();
    }
  } catch (err) {
    if (!closed()) {
      sendEvent(res, 'error', { message: publicErrorMessage(err) });
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
  const aborted = listenSseAbort(res);
  const closed = () => aborted();

  try {
    const result = await syncDriveFolder({
      limit: Number(req.body?.limit) || 20,
      folderId: req.body?.folderId || null,
      categoryId: req.body?.categoryId || null,
      onProgress: (p) => {
        if (!closed()) sendEvent(res, 'progress', p);
      },
    });
    if (!closed()) {
      sendEvent(res, 'done', { ok: true, ...result });
      res.end();
    }
  } catch (err) {
    if (!closed()) {
      sendEvent(res, 'error', { message: publicErrorMessage(err) });
      res.end();
    }
  }
});

module.exports = router;
