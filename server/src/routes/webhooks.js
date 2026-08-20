/**
 * Webhook cho n8n.
 *
 * POST /api/webhooks/n8n
 * Header: X-N8N-Secret
 * Body: { fileId } | { fileUrl } | { action: "sync_folder", folderId? }
 */

const express = require('express');
const crypto = require('crypto');
const { ingestDriveFile, syncDriveFolder, driveFileIdFromWebhookBody, coerceWebhookBody } = require('../services/driveIngest');
const { ingestSingleFile } = require('../services/ingestFile');
const { storeUploadedOriginal } = require('../services/originalStore');
const { parseDriveResource, getFileParentIds } = require('../services/googleDrive');
const { assertSafeUrl } = require('../ingestion/extractWebPage');
const { getFlags, getN8nSecret, findSourceForFolder } = require('../services/integrations');
const { publicErrorMessage } = require('../services/publicError');

const router = express.Router();

function secretsMatch(got, expected) {
  const a = Buffer.from(String(got || ''), 'utf8');
  const b = Buffer.from(String(expected || ''), 'utf8');
  if (!a.length || a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

function syncFolderLimit(raw) {
  const n = Number(raw);
  if (!Number.isFinite(n)) return 8;
  return Math.min(20, Math.max(1, Math.floor(n)));
}

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
  if (!secretsMatch(got, stored.secret)) {
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
  const started = Date.now();
  const body = coerceWebhookBody(req.body);

  try {
    const action = String(body.action || 'ingest_file').trim();
    const flags = await getFlags();

    if (action === 'ping') {
      res.json({
        ok: true,
        action: 'ping',
        at: new Date().toISOString(),
        hint: 'Webhook sống. n8n phải Active và POST đúng URL + X-N8N-Secret. App cũng đồng bộ Drive ngay từ Cài đặt, không cần n8n.',
      });
      return;
    }

    if (action === 'sync_folder') {
      if (!flags.driveEnabled) {
        res.status(403).json({ error: 'Google Drive đang tắt trong Cài đặt' });
        return;
      }
      const result = await syncDriveFolder({
        limit: syncFolderLimit(body.limit),
        folderId: body.folderId || null,
        categoryId: body.categoryId || null,
      });
      const message =
        result.processed > 0
          ? `Đã số hóa ${result.processed} file mới vào kho.`
          : result.skipped > 0
            ? `Không có file mới — ${result.skipped}/${result.totalListed} file Drive đã có trong kho.`
            : result.totalListed === 0
              ? 'Thư mục không có PDF/Word/Excel (hoặc service account chưa được Share Viewer).'
              : 'Không có file mới để số hóa.';
      res.json({
        ok: true,
        action,
        ingested: result.processed > 0,
        message,
        durationMs: Date.now() - started,
        ...result,
      });
      return;
    }

    const driveFileId = driveFileIdFromWebhookBody(body);
    if (driveFileId) {
      if (!flags.driveEnabled) {
        res.status(403).json({ error: 'Google Drive đang tắt trong Cài đặt' });
        return;
      }
      const categoryId = body.categoryId || (await categoryForFile(driveFileId, body.folderId));
      const result = await ingestDriveFile(driveFileId, { categoryId });
      if (result?.duplicate || result?.skipped) {
        res.json({
          ok: true,
          action: 'ingest_file',
          ingested: false,
          duplicate: true,
          message: result.message || 'File đã có trong kho — không số hóa lại.',
          durationMs: Date.now() - started,
          ...result,
        });
        return;
      }
      if (!result?.id) {
        throw new Error('Số hóa Drive xong nhưng không ghi được danh mục tài liệu.');
      }
      res.json({
        ok: true,
        action: 'ingest_file',
        ingested: true,
        message: `Đã số hóa «${result.displayName || result.fileName || result.id}» (${result.chunks || 0} chunks).`,
        durationMs: Date.now() - started,
        ...result,
      });
      return;
    }

    if (body.fileUrl) {
      const url = String(body.fileUrl);
      const driveParsed = parseDriveResource(url);
      if (driveParsed && !flags.driveEnabled) {
        res.status(403).json({ error: 'Google Drive đang tắt trong Cài đặt' });
        return;
      }
      if (driveParsed?.type === 'folder') {
        const src = await findSourceForFolder(driveParsed.id);
        const result = await syncDriveFolder({
          folderId: driveParsed.id,
          limit: syncFolderLimit(body.limit),
          categoryId: body.categoryId || src?.categoryId || null,
        });
        res.json({
          ok: true,
          action: 'ingest_drive_folder',
          ingested: result.processed > 0,
          message:
            result.processed > 0
              ? `Đã số hóa ${result.processed} file.`
              : 'Không có file mới trong thư mục.',
          durationMs: Date.now() - started,
          ...result,
        });
        return;
      }
      if (driveParsed?.id) {
        const categoryId =
          body.categoryId || (await categoryForFile(driveParsed.id, body.folderId));
        const result = await ingestDriveFile(driveParsed.id, { categoryId });
        res.json({
          ok: true,
          action: 'ingest_drive',
          ingested: !(result?.duplicate || result?.skipped),
          message: result?.message,
          durationMs: Date.now() - started,
          ...result,
        });
        return;
      }

      assertSafeUrl(url);
      const resp = await fetch(url);
      if (!resp.ok) throw new Error(`Không tải được fileUrl: HTTP ${resp.status}`);
      const buffer = Buffer.from(await resp.arrayBuffer());
      const fileName = String(body.fileName || 'n8n-upload.pdf');
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
        categoryId: body.categoryId || null,
      });
      res.json({
        ok: true,
        action: 'ingest_url',
        ingested: Boolean(result?.id),
        durationMs: Date.now() - started,
        ...result,
      });
      return;
    }

    res.status(400).json({
      error: 'Body cần fileId, fileUrl, hoặc action=sync_folder',
      receivedType: typeof req.body,
      hint: 'Trong n8n HTTP Request: Body → JSON, dùng biểu thức {{ $json }} (không JSON.stringify). Xem Executions → output node Gói body.',
      examples: [
        { action: 'ping' },
        { fileId: '1abc...' },
        { action: 'sync_folder', limit: 8 },
        { fileUrl: 'https://...', fileName: 'vb.pdf' },
      ],
    });
  } catch (err) {
    console.error('[n8n webhook]', err);
    res.status(500).json({
      ok: false,
      ingested: false,
      error: publicErrorMessage(err, 'Số hóa thất bại'),
      durationMs: Date.now() - started,
    });
  }
});

router.get('/n8n/health', async (_req, res) => {
  const [flags, secret] = await Promise.all([getFlags(), getN8nSecret()]);
  res.json({
    ok: true,
    webhook: '/api/webhooks/n8n',
    method: 'POST',
    header: 'X-N8N-Secret',
    enabled: flags.n8nEnabled,
    secretConfigured: Boolean(secret.secret),
    hint: 'n8n phải gọi URL Vercel https://…/api/webhooks/n8n — không dùng localhost',
  });
});

module.exports = router;
