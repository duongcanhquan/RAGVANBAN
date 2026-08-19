/**
 * Webhook cho n8n (và automation khác).
 *
 * POST /api/webhooks/n8n
 * Header: X-N8N-Secret: <N8N_WEBHOOK_SECRET>
 * Body JSON:
 *   { "fileId": "google-drive-file-id" }
 *   hoặc { "action": "sync_folder", "limit": 10 }
 *   hoặc { "fileUrl": "https://..." }  — tải PDF từ URL công khai
 *
 * Trả JSON (không SSE) để n8n dễ parse.
 */

const express = require('express');
const { ingestDriveFile, syncDriveFolder } = require('../services/driveIngest');
const { ingestSingleFile } = require('../services/ingestFile');
const { storeUploadedOriginal } = require('../services/originalStore');
const { parseDriveResource } = require('../services/googleDrive');

const router = express.Router();

function assertSecret(req, res) {
  const expected = process.env.N8N_WEBHOOK_SECRET;
  if (!expected || String(expected).includes('your-')) {
    res.status(503).json({ error: 'N8N_WEBHOOK_SECRET chưa cấu hình trên server' });
    return false;
  }
  const got = req.headers['x-n8n-secret'] || req.headers['x-webhook-secret'] || req.body?.secret;
  if (got !== expected) {
    res.status(401).json({ error: 'Unauthorized — sai secret' });
    return false;
  }
  return true;
}

router.post('/n8n', async (req, res) => {
  if (!assertSecret(req, res)) return;

  try {
    const action = String(req.body?.action || 'ingest_file').trim();

    if (action === 'sync_folder') {
      const limit = Number(req.body?.limit) || 10;
      const result = await syncDriveFolder({ limit });
      res.json({ ok: true, action, ...result });
      return;
    }

    if (req.body?.fileId) {
      const result = await ingestDriveFile(String(req.body.fileId));
      res.json({ ok: true, action: 'ingest_file', ...result });
      return;
    }

    if (req.body?.fileUrl) {
      const url = String(req.body.fileUrl);
      const driveParsed = parseDriveResource(url);
      if (driveParsed?.type === 'folder') {
        const result = await syncDriveFolder({
          folderId: driveParsed.id,
          limit: Number(req.body?.limit) || 10,
        });
        res.json({ ok: true, action: 'ingest_drive_folder', ...result });
        return;
      }
      if (driveParsed?.id) {
        const result = await ingestDriveFile(driveParsed.id);
        res.json({ ok: true, action: 'ingest_drive', ...result });
        return;
      }

      const resp = await fetch(url);
      if (!resp.ok) throw new Error(`Không tải được fileUrl: HTTP ${resp.status}`);
      const ab = await resp.arrayBuffer();
      const buffer = Buffer.from(ab);
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

router.get('/n8n/health', (req, res) => {
  const secretOk = Boolean(
    process.env.N8N_WEBHOOK_SECRET && !String(process.env.N8N_WEBHOOK_SECRET).includes('your-')
  );
  res.json({
    ok: true,
    webhook: '/api/webhooks/n8n',
    secretConfigured: secretOk,
  });
});

module.exports = router;
