/**
 * POST /api/upload          — multipart file (PDF/DOC/PPT/ảnh/text)
 * POST /api/upload/text     — JSON { text, title? }
 * POST /api/upload/url      — JSON { url } website tham khảo
 * SSE progress trên mọi endpoint.
 */

const express = require('express');
const multer = require('multer');
const { ingestSingleFile, ingestTextContent } = require('../services/ingestFile');
const { uploadPdfToStorage, isConfigured } = require('../services/supabase');
const {
  isAllowedUpload,
  guessContentType,
} = require('../ingestion/extractAnyText');
const { extractWebPage } = require('../ingestion/extractWebPage');
const { hasLiveKeys } = require('../services/clients');
const { assertCanUseCategory } = require('../services/adminAccess');

const router = express.Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: Number(process.env.UPLOAD_MAX_BYTES) || 40 * 1024 * 1024 },
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

function requireLiveKeys(res) {
  if (hasLiveKeys()) return true;
  res.status(503).json({
    error:
      'Chưa cấu hình Multi-LLM + Pinecone — không thể số hóa. Điền API keys trong .env rồi restart server.',
    ragReady: false,
  });
  return false;
}

async function runWithSse(req, res, work) {
  initSse(res);
  let closed = false;
  req.on('close', () => {
    closed = true;
  });
  try {
    await work({
      closed: () => closed,
      progress: (p) => {
        if (!closed) sendEvent(res, 'progress', p);
      },
      done: (data) => {
        if (!closed) {
          sendEvent(res, 'done', { ok: true, ...data });
          res.end();
        }
      },
    });
  } catch (e) {
    console.error('[upload]', e);
    if (!closed) {
      sendEvent(res, 'error', { message: e.message || 'Lỗi số hóa' });
      res.end();
    }
  }
}

router.post('/', (req, res) => {
  if (!requireLiveKeys(res)) return;
  upload.single('file')(req, res, async (err) => {
    if (err) {
      res.status(400).json({ error: err.message || 'Upload thất bại' });
      return;
    }
    if (!req.file?.buffer) {
      res.status(400).json({ error: 'Thiếu file (field name: file)' });
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

      let publicUrl = '';
      let storagePath = '';

      if (isConfigured()) {
        progress({
          stage: 'storage',
          percent: 12,
          message: 'Đang lưu bản gốc lên Storage…',
        });
        const stored = await uploadPdfToStorage(req.file.buffer, fileName, mimeType);
        if (!stored.ok && !stored.skipped) {
          throw new Error(stored.error || 'Upload Storage thất bại');
        }
        if (stored.ok) {
          publicUrl = stored.publicUrl;
          storagePath = stored.path;
        }
      }

      const categoryId = String(req.body?.categoryId || '').trim() || null;
      assertCanUseCategory(req.admin, categoryId);

      const result = await ingestSingleFile(req.file.buffer, {
        fileName,
        mimeType,
        publicUrl,
        storagePath,
        source: 'upload',
        categoryId,
        onProgress: (p) => {
          if (!closed()) progress(p);
        },
      });

      done({ ...result, publicUrl, storagePath });
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
  if (!requireLiveKeys(res)) return;
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
  const url = String(req.body?.url || '').trim();
  const categoryId = String(req.body?.categoryId || '').trim() || null;
  if (!url) {
    res.status(400).json({ error: 'Thiếu url' });
    return;
  }
  if (!requireLiveKeys(res)) return;
  try {
    assertCanUseCategory(req.admin, categoryId);
  } catch (e) {
    res.status(e.status || 403).json({ error: e.message });
    return;
  }

  await runWithSse(req, res, async ({ closed, progress, done }) => {
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
