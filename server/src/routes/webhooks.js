/**
 * Webhook cho n8n.
 *
 * POST /api/webhooks/n8n
 * Header: X-N8N-Secret
 * Body: { fileId } | { fileUrl } | { action: "sync_folder", folderId? }
 */

const express = require('express');
const { ingestDriveFile, syncDriveFolder } = require('../services/driveIngest');
const { ingestSingleFile } = require('../services/ingestFile');
const { storeUploadedOriginal } = require('../services/originalStore');
const { parseDriveResource, getFileParentIds } = require('../services/googleDrive');
const { getFlags, getN8nSecret, findSourceForFolder } = require('../services/integrations');

const router = express.Router();

async function assertSecret(req, res) {
  const flags = await getFlags();
  if (!flags.n8nEnabled) {
    res.status(403).json({ error: 'Webhook n8n đang tắt trong Cài đặt' });
    return false;
  }
  const stored = await getN8nSecret();
  if (!stored.secret) {
    res.status(503).json({
      error: 'Chưa có secret n8n. Super-admin mở Cài đặt → n8n → Tạo secret rồi copy.',
    });
    return false;
  }
  const got = req.headers['x-n8n-secret'] || req.headers['x-webhook-secret'] || req.body?.secret;
  if (got !== stored.secret) {
    res.status(401).json({ error: 'Unauthorized — sai secret' });
    return false;
  }
  return true;
}

async function categoryForFile(fileId, folderIdHint) {
  if (folderIdHint) {
    const src = await findSourceForFolder(folderIdHint);
    if (src?.categoryId) return src.categoryId;
  }
  try {
    const parents = await getFileParentIds(fileId);
    for (const pid of parents) {
      const src = await findSourceForFolder(pid);
      if (src?.categoryId) return src.categoryId;
    }
  } catch {
    /* public file, no API */
  }
  return null;
}

router.post('/n8n', async (req, res) => {
  if (!(await assertSecret(req, res))) return;

  try {
    const action = String(req.body?.action || 'ingest_file').trim();
    const flags = await getFlags();

    if (action === 'sync_folder') {
      if (!flags.driveEnabled) {
        res.status(403).json({ error: 'Google Drive đang tắt trong Cài đặt' });
        return;
      }
      const result = await syncDriveFolder({
        limit: Number(req.body?.limit) || 10,
        folderId: req.body?.folderId || null,
        categoryId: req.body?.categoryId || null,
      });
      res.json({ ok: true, action, ...result });
      return;
    }

    if (req.body?.fileId) {
      if (!flags.driveEnabled) {
        res.status(403).json({ error: 'Google Drive đang tắt trong Cài đặt' });
        return;
      }
      const fileId = String(req.body.fileId);
      const categoryId =
        req.body?.categoryId || (await categoryForFile(fileId, req.body?.folderId));
      const result = await ingestDriveFile(fileId, { categoryId });
      res.json({ ok: true, action: 'ingest_file', ...result });
      return;
    }

    if (req.body?.fileUrl) {
      const url = String(req.body.fileUrl);
      const driveParsed = parseDriveResource(url);
      if (driveParsed && !flags.driveEnabled) {
        res.status(403).json({ error: 'Google Drive đang tắt trong Cài đặt' });
        return;
      }
      if (driveParsed?.type === 'folder') {
        const src = await findSourceForFolder(driveParsed.id);
        const result = await syncDriveFolder({
          folderId: driveParsed.id,
          limit: Number(req.body?.limit) || 10,
          categoryId: req.body?.categoryId || src?.categoryId || null,
        });
        res.json({ ok: true, action: 'ingest_drive_folder', ...result });
        return;
      }
      if (driveParsed?.id) {
        const categoryId =
          req.body?.categoryId || (await categoryForFile(driveParsed.id, req.body?.folderId));
        const result = await ingestDriveFile(driveParsed.id, { categoryId });
        res.json({ ok: true, action: 'ingest_drive', ...result });
        return;
      }

      const resp = await fetch(url);
      if (!resp.ok) throw new Error(`Không tải được fileUrl: HTTP ${resp.status}`);
      const buffer = Buffer.from(await resp.arrayBuffer());
      const fileName = String(req.body.fileName || 'n8n-upload.pdf');
      let publicUrl = url;
      let storagePath = '';
      const stored = await storeUploadedOriginal(
        buffer,
        fileName,
        resp.headers.get('content-type') || 'application/pdf'
      );
      if (stored.ok) {
        publicUrl = stored.publicUrl || publicUrl;
        storagePath = stored.path || '';
      }
      const result = await ingestSingleFile(buffer, {
        fileName,
        publicUrl,
        storagePath,
        source: stored.source || 'upload',
        categoryId: req.body?.categoryId || null,
      });
      res.json({ ok: true, action: 'ingest_url', ...result });
      return;
    }

    res.status(400).json({
      error: 'Body cần fileId, fileUrl, hoặc action=sync_folder',
      examples: [
        { fileId: '1abc...' },
        { action: 'sync_folder', limit: 10 },
        { fileUrl: 'https://...', fileName: 'vb.pdf' },
      ],
    });
  } catch (err) {
    console.error('[n8n webhook]', err);
    res.status(500).json({ ok: false, error: err.message });
  }
});

router.get('/n8n/health', async (_req, res) => {
  const [flags, secret] = await Promise.all([getFlags(), getN8nSecret()]);
  res.json({
    ok: true,
    webhook: '/api/webhooks/n8n',
    enabled: flags.n8nEnabled,
    secretConfigured: Boolean(secret.secret),
  });
});

module.exports = router;
