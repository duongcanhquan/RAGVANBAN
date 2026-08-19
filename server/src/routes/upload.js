/**
 * POST /api/upload          — multipart file (PDF/DOC/PPT/ảnh/text)
 * POST /api/upload/text     — JSON { text, title? }
 * POST /api/upload/url      — JSON { url } website tham khảo
 * SSE progress trên mọi endpoint.
 */

const express = require('express');
const multer = require('multer');
const { ingestSingleFile, ingestTextContent } = require('../services/ingestFile');
const { storeUploadedOriginal } = require('../services/originalStore');
const { updateDocument } = require('../services/supabase');
const { listCategories, pathForCategory } = require('../services/taxonomyStore');
const { moveR2Object } = require('../services/r2');
const {
  isAllowedUpload,
  guessContentType,
} = require('../ingestion/extractAnyText');
const { extractWebPage } = require('../ingestion/extractWebPage');
const { hasLiveKeys, ensureBrain } = require('../services/clients');
const { assertCanUseCategory } = require('../services/adminAccess');
const { parseDriveResource } = require('../services/googleDrive');
const { ingestDriveFile, syncDriveFolder } = require('../services/driveIngest');
const { getRagConfig, assertUploadSize } = require('../services/ragConfig');
const { getFlags } = require('../services/integrations');
const { listenSseAbort } = require('../services/sseAbort');
const { publicErrorMessage } = require('../services/publicError');

const router = express.Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 80 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (!isAllowedUpload(file.originalname, file.mimetype)) {
      return cb(
        new Error('Định dạng không hỗ trợ. Dùng PDF, DOC/DOCX, PPT/PPTX, ảnh, TXT/MD.')
      );
    }
    cb(null, true);
  },
});

function initSse(res) {
  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  if (typeof res.flushHeaders === 'function') res.flushHeaders();
}

function sendEvent(res, event, data) {
  res.write(`event: ${event}\n`);
  res.write(`data: ${JSON.stringify(data)}\n\n`);
}

async function requireLiveKeys(res) {
  try {
    await ensureBrain();
  } catch {
    /* env-only */
  }
  if (hasLiveKeys()) return true;
  res.status(503).json({
    error:
      'Chưa cấu hình bộ não (LLM + embedding + Pinecone). Super-admin vào /quantri/bo-nao để dán API key.',
    ragReady: false,
  });
  return false;
}

async function runWithSse(req, res, work) {
  initSse(res);
  const aborted = listenSseAbort(res);
  const closed = () => aborted();
  try {
    await work({
      closed,
      progress: (p) => {
        if (!closed()) sendEvent(res, 'progress', p);
      },
      done: (data) => {
        if (!closed()) {
          sendEvent(res, 'done', { ok: true, ...data });
          res.end();
        }
      },
    });
  } catch (e) {
    console.error('[upload]', e);
    if (!closed()) {
      sendEvent(res, 'error', { message: publicErrorMessage(e, 'Lỗi số hóa') });
      res.end();
    }
  }
}

router.post('/', async (req, res) => {
  if (!(await requireLiveKeys(res))) return;
  upload.single('file')(req, res, async (err) => {
    if (err) {
      res.status(400).json({ error: err.message || 'Upload thất bại' });
      return;
    }
    if (!req.file?.buffer) {
      res.status(400).json({ error: 'Thiếu file (field name: file)' });
      return;
    }
    try {
      const rag = await getRagConfig();
      assertUploadSize(req.file.size, rag.uploadMaxBytes);
    } catch (sizeErr) {
      res.status(sizeErr.status || 413).json({ error: sizeErr.message });
      return;
    }

    await runWithSse(req, res, async ({ closed, progress, done }) => {
      const fileName = req.file.originalname;
      const mimeType = req.file.mimetype || guessContentType(fileName);

      progress({
        stage: 'receive',
        percent: 5,
        message: `Đã nhận ${fileName} (${Math.round(req.file.size / 1024)} KB)`,
      });

      const categoryId = String(req.body?.categoryId || '').trim() || null;
      assertCanUseCategory(req.admin, categoryId);

      let publicUrl = '';
      let storagePath = '';
      let source = 'upload';
      let folderPath = '';
      if (categoryId) {
        const cats = await listCategories();
        folderPath = pathForCategory(cats.items || [], categoryId);
      }

      progress({
        stage: 'storage',
        percent: 12,
        message: folderPath
          ? `Đang lưu bản gốc R2 · ${folderPath}`
          : 'Đang lưu bản gốc (R2 ưu tiên)…',
      });
      const stored = await storeUploadedOriginal(req.file.buffer, fileName, mimeType, {
        folderPath,
      });
      if (!stored.ok && !stored.skipped) {
        throw new Error(stored.error || 'Lưu file gốc thất bại');
      }
      if (stored.ok) {
        publicUrl = stored.publicUrl;
        storagePath = stored.path;
        source = stored.source || 'r2';
        progress({
          stage: 'storage',
          percent: 18,
          message:
            stored.backend === 'r2'
              ? 'Đã lưu bản gốc trên Cloudflare R2'
              : 'Đã lưu bản gốc trên Supabase Storage',
        });
      } else {
        progress({
          stage: 'storage',
          percent: 18,
          message: 'Chưa cấu hình R2 — số hóa không kèm file tải về',
        });
      }

      const result = await ingestSingleFile(req.file.buffer, {
        fileName,
        mimeType,
        publicUrl,
        storagePath,
        source,
        categoryId,
        onProgress: (p) => {
          if (!closed()) progress(p);
        },
      });

      if (stored.ok && stored.path && result.folderPath && result.folderPath !== folderPath) {
        const moved = await moveR2Object(stored.path, result.folderPath);
        if (moved.ok && moved.path && moved.path !== stored.path) {
          storagePath = moved.path;
          publicUrl = moved.publicUrl || publicUrl;
          if (result.id) {
            await updateDocument(result.id, {
              storage_path: storagePath,
              storage_url: publicUrl,
            });
          }
        }
      }

      done({ ...result, publicUrl, storagePath, storageBackend: stored.backend || null });
    });
  });
});

router.post('/text', async (req, res) => {
  const text = String(req.body?.text || '').trim();
  const title = String(req.body?.title || 'van-ban-dan.txt').trim() || 'van-ban-dan.txt';
  const categoryId = String(req.body?.categoryId || '').trim() || null;
  if (!text) {
    res.status(400).json({ error: 'Thiếu text' });
    return;
  }
  if (text.length > 500000) {
    res.status(400).json({ error: 'Text quá dài (tối đa ~500k ký tự)' });
    return;
  }
  if (!(await requireLiveKeys(res))) return;
  try {
    assertCanUseCategory(req.admin, categoryId);
  } catch (e) {
    res.status(e.status || 403).json({ error: e.message });
    return;
  }

  await runWithSse(req, res, async ({ closed, progress, done }) => {
    progress({ stage: 'receive', percent: 5, message: 'Đã nhận văn bản dán tay' });
    const fileName = title.toLowerCase().endsWith('.txt') ? title : `${title}.txt`;
    const result = await ingestTextContent(text, {
      fileName,
      source: 'paste',
      sourceKind: 'text',
      categoryId,
      onProgress: (p) => {
        if (!closed()) progress(p);
      },
    });
    done(result);
  });
});

router.post('/url', async (req, res) => {
  const raw = String(req.body?.url || '').trim();
  const categoryId = String(req.body?.categoryId || '').trim() || null;
  if (!raw) {
    res.status(400).json({ error: 'Thiếu url' });
    return;
  }
  if (!(await requireLiveKeys(res))) return;
  try {
    assertCanUseCategory(req.admin, categoryId);
  } catch (e) {
    res.status(e.status || 403).json({ error: e.message });
    return;
  }

  const parts = raw.split(/[\s,;]+/).map((s) => s.trim()).filter(Boolean);
  const driveParts = parts.map((p) => ({ raw: p, parsed: parseDriveResource(p) }));
  const allDrive = driveParts.every((p) => p.parsed);

  await runWithSse(req, res, async ({ closed, progress, done }) => {
    if (allDrive) {
      const flags = await getFlags();
      if (!flags.driveEnabled) {
        throw Object.assign(new Error('Google Drive đang tắt trong Cài đặt'), { status: 403 });
      }
      const items = [];
      for (let i = 0; i < driveParts.length; i += 1) {
        const { raw: link, parsed } = driveParts[i];
        progress({
          stage: 'drive',
          percent: Math.round((i / driveParts.length) * 90),
          message: `Drive ${i + 1}/${driveParts.length}: ${link}`,
        });
        if (parsed.type === 'folder') {
          const folderResult = await syncDriveFolder({
            folderId: parsed.id,
            limit: Number(req.body?.limit) || 40,
            categoryId,
            onProgress: (p) => {
              if (!closed()) progress(p);
            },
          });
          items.push({ type: 'folder', link, ...folderResult });
        } else {
          const one = await ingestDriveFile(parsed.id, {
            categoryId,
            onProgress: (p) => {
              if (!closed()) progress(p);
            },
          });
          items.push({ type: 'file', link, ...one });
        }
      }
      done({
        source: 'google_drive',
        count: items.length,
        items,
        fileName: items[0]?.fileName || `drive-${items.length}-files`,
        downloadUrl: items[0]?.driveWebViewLink,
      });
      return;
    }

    const url = parts[0];
    progress({ stage: 'fetch', percent: 8, message: 'Đang tải trang web…' });
    const page = await extractWebPage(url);
    progress({
      stage: 'fetch',
      percent: 20,
      message: page.official
        ? `Trang chính thống (${page.host}) — ${page.title}`
        : `Trang tham khảo (${page.host}) — chưa xác nhận .gov.vn`,
      official: page.official,
    });

    const fileName = `${(page.title || 'web').slice(0, 80).replace(/[\\/:*?"<>|]/g, '_')}.web.txt`;
    const result = await ingestTextContent(page.text, {
      fileName,
      publicUrl: page.url,
      source: page.official ? 'web_official' : 'web',
      sourceKind: 'web',
      mimeType: 'text/html',
      categoryId,
      onProgress: (p) => {
        if (!closed()) progress(p);
      },
    });

    done({
      ...result,
      official: page.official,
      sourceUrl: page.url,
      pageTitle: page.title,
    });
  });
});

module.exports = router;
