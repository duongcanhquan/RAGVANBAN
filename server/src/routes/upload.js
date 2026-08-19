/**
 * POST /api/upload          — multipart file (PDF/DOC/PPT/ảnh/text)
 * POST /api/upload/text     — JSON { text, title? }
 * POST /api/upload/drive    — JSON { url } Google Drive (file/folder)
 * POST /api/upload/web      — JSON { url } trang web tham khảo (1+ URL)
 * POST /api/upload/url      — JSON { url } tự nhận Drive hoặc web (legacy)
 * SSE progress trên mọi endpoint.
 */

const express = require('express');
const multer = require('multer');
const { ingestSingleFile, ingestTextContent } = require('../services/ingestFile');
const { updateDocument, getDocumentByFileName, getDocumentByContentHash } = require('../services/supabase');
const { storeUploadedOriginal } = require('../services/originalStore');
const { listCategories, pathForCategory } = require('../services/taxonomyStore');
const { moveR2Object, deleteFromR2 } = require('../services/r2');
const {
  isAllowedUpload,
  guessContentType,
} = require('../ingestion/extractAnyText');
const { extractWebPage, webCatalogFileName } = require('../ingestion/extractWebPage');
const { ensureBrain, liveKeysReport, brainNotReadyMessage } = require('../services/clients');
const { assertCanUseCategory } = require('../services/adminAccess');
const { parseDriveResource, inspectDriveResource } = require('../services/googleDrive');
const { ingestDriveFile, syncDriveFolder, summarizeDriveUrlJob } = require('../services/driveIngest');
const { getRagConfig, assertUploadSize, multerFileSizeCap, formatBytes } = require('../services/ragConfig');
const { getFlags } = require('../services/integrations');
const { listenSseAbort } = require('../services/sseAbort');
const { publicErrorMessage } = require('../services/publicError');
const { assertOriginalStored } = require('../services/documentCatalog');
const {
  fileFingerprint,
  decideDuplicate,
  duplicateMessage,
  textFingerprint,
} = require('../services/documentDedup');

const router = express.Router();

function createUploader(maxBytes) {
  return multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: multerFileSizeCap(maxBytes) },
    fileFilter: (_req, file, cb) => {
      if (!isAllowedUpload(file.originalname, file.mimetype)) {
        return cb(
          new Error('Định dạng không hỗ trợ. Dùng PDF, Word, PowerPoint, Excel, ảnh, TXT/MD.')
        );
      }
      cb(null, true);
    },
  });
}

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
  const report = liveKeysReport();
  if (report.ready) return true;
  res.status(503).json({
    error: brainNotReadyMessage(report),
    ragReady: false,
    missing: report.missing,
    providers: report.providers,
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
  let rag;
  try {
    rag = await getRagConfig();
  } catch (e) {
    res.status(500).json({ error: publicErrorMessage(e, 'Không đọc được giới hạn upload') });
    return;
  }
  createUploader(rag.uploadMaxBytes).single('file')(req, res, async (err) => {
    if (err) {
      if (err.code === 'LIMIT_FILE_SIZE') {
        res.status(413).json({
          error: `File vượt giới hạn ${formatBytes(rag.uploadMaxBytes)} đã đặt trong RAG & số hóa`,
        });
        return;
      }
      res.status(400).json({ error: err.message || 'Upload thất bại' });
      return;
    }
    if (!req.file?.buffer) {
      res.status(400).json({ error: 'Thiếu file (field name: file)' });
      return;
    }
    try {
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
      const displayName = String(req.body?.displayName || req.body?.title || '').trim();
      const description = String(req.body?.description || req.body?.moTa || '').trim();
      assertCanUseCategory(req.admin, categoryId);

      const fp = fileFingerprint(req.file.buffer);
      const [byHash, byName] = await Promise.all([
        getDocumentByContentHash(fp.sha256),
        getDocumentByFileName(fileName),
      ]);
      const decision = decideDuplicate(fp, {
        byHash: byHash.item || null,
        byName: byName.item || null,
      });

      if (decision.action === 'reuse' && decision.document) {
        const doc = decision.document;
        progress({
          stage: 'dedup',
          percent: 100,
          message: duplicateMessage(doc),
        });
        done({
          duplicate: true,
          skipped: true,
          id: doc.id,
          fileName: doc.file_name,
          displayName: doc.display_name || doc.file_name,
          moTa: doc.mo_ta || '',
          metadata: doc.metadata || {},
          chunks: doc.chunk_count || 0,
          storagePath: doc.storage_path || '',
          publicUrl: doc.storage_url || doc.drive_web_view_link || '',
          storageUrl: doc.storage_url || '',
          categoryId: doc.category_id || '',
          folderPath: doc.folder_path || '',
          source: doc.source || 'upload',
          message: duplicateMessage(doc),
        });
        return;
      }

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
        contentHash: fp.sha256,
      });
      assertOriginalStored(stored);
      publicUrl = stored.publicUrl;
      storagePath = stored.path;
      source = stored.source || 'r2';
      progress({
        stage: 'storage',
        percent: 18,
        message: stored.reused
          ? 'R2 đã có object cùng nội dung — không upload thêm'
          : stored.backend === 'r2'
            ? 'Đã lưu bản gốc trên Cloudflare R2'
            : 'Đã lưu bản gốc trên Supabase Storage',
      });

      const oldPath = decision.document?.storage_path || '';
      const result = await ingestSingleFile(req.file.buffer, {
        fileName,
        mimeType,
        publicUrl,
        storagePath,
        source,
        categoryId,
        displayName: displayName || undefined,
        description: description || undefined,
        contentSha256: fp.sha256,
        byteSize: fp.byteSize,
        replaceDocumentId: decision.action === 'replace' ? decision.document?.id : undefined,
        onProgress: (p) => {
          if (!closed()) progress(p);
        },
      });

      if (decision.action === 'replace' && oldPath && storagePath && oldPath !== storagePath) {
        await deleteFromR2(oldPath);
      }

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

      done({
        ...result,
        publicUrl,
        storagePath,
        storageBackend: stored.backend || null,
        catalogId: result.id,
        stored: true,
        r2Reused: Boolean(stored.reused),
      });
    });
  });
});

router.post('/text', async (req, res) => {
  const text = String(req.body?.text || '').trim();
  const title = String(req.body?.title || 'van-ban-dan.txt').trim() || 'van-ban-dan.txt';
  const description = String(req.body?.description || req.body?.moTa || '').trim();
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
      displayName: title,
      description: description || undefined,
      onProgress: (p) => {
        if (!closed()) progress(p);
      },
    });
    done(result);
  });
});

function splitUrlParts(raw) {
  return String(raw || '')
    .trim()
    .split(/[\s,;]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

async function ingestDriveUrls(parts, ctx) {
  const { categoryId, displayName, description, req, closed, progress } = ctx;
  const flags = await getFlags();
  if (!flags.driveEnabled) {
    throw Object.assign(new Error('Google Drive đang tắt trong Cài đặt'), { status: 403 });
  }
  const driveParts = parts.map((p) => ({ raw: p, parsed: parseDriveResource(p) }));
  const bad = driveParts.filter((p) => !p.parsed);
  if (bad.length) {
    throw Object.assign(
      new Error(
        `Không phải link Google Drive: ${bad[0].raw}. Trang web dùng tab Link Website.`
      ),
      { status: 400 }
    );
  }

  const items = [];
  for (let i = 0; i < driveParts.length; i += 1) {
    const { raw: link, parsed: parsedRaw } = driveParts[i];
    const parsed = await inspectDriveResource(parsedRaw);
    progress({
      stage: 'drive',
      percent: Math.round((i / driveParts.length) * 90),
      message: `Drive ${i + 1}/${driveParts.length}: ${parsed?.name || link}`,
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
      items.push({
        type: 'folder',
        link,
        folderId: parsed.id,
        webViewLink: parsed.webViewLink || `https://drive.google.com/drive/folders/${parsed.id}`,
        ...folderResult,
      });
    } else {
      const one = await ingestDriveFile(parsed.id, {
        categoryId,
        displayName: displayName || parsed.name || undefined,
        description: description || undefined,
        onProgress: (p) => {
          if (!closed()) progress(p);
        },
      });
      items.push({
        type: 'file',
        link,
        ...one,
        driveWebViewLink: one.driveWebViewLink || parsed.webViewLink || link,
      });
    }
  }
  const summary = summarizeDriveUrlJob(items);
  return {
    source: 'google_drive',
    count: items.length,
    items,
    ...summary,
    skipped:
      items.reduce((n, it) => n + (typeof it.skipped === 'number' ? it.skipped : 0), 0) +
      Number(summary.skippedDuplicates || 0),
    pending: items.reduce((n, it) => n + Number(it.pending || 0), 0),
  };
}

async function ingestWebUrls(parts, ctx) {
  const { categoryId, displayName, description, closed, progress } = ctx;
  const items = [];
  for (let i = 0; i < parts.length; i += 1) {
    const url = parts[i];
    if (parseDriveResource(url)) {
      throw Object.assign(
        new Error('Link Google Drive không dùng ở đây — chuyển sang tab Google Drive.'),
        { status: 400 }
      );
    }
    progress({
      stage: 'fetch',
      percent: Math.round(5 + (i / parts.length) * 15),
      message: `Đang tải trang ${i + 1}/${parts.length}…`,
    });
    try {
      const page = await extractWebPage(url);
      progress({
        stage: 'fetch',
        percent: Math.round(20 + (i / parts.length) * 60),
        message: page.official
          ? `Trang chính thống (${page.host}) — ${page.title}`
          : `Trang tham khảo (${page.host}) — ${page.title}`,
        official: page.official,
      });

      const fp = textFingerprint(page.text, page.url);
      const [byHash, byName] = await Promise.all([
        getDocumentByContentHash(fp.sha256),
        getDocumentByFileName(webCatalogFileName(page)),
      ]);
      const decision = decideDuplicate(fp, {
        byHash: byHash.item || null,
        byName: byName.item || null,
      });
      if (decision.action === 'reuse' && decision.document) {
        const doc = decision.document;
        items.push({
          ok: true,
          type: 'web',
          link: url,
          duplicate: true,
          skipped: true,
          id: doc.id,
          fileName: doc.file_name,
          displayName: doc.display_name || doc.file_name,
          sourceUrl: page.url,
          pageTitle: page.title,
          message: duplicateMessage(doc),
        });
        continue;
      }

      const fileName = webCatalogFileName(page);
      const replaceDocumentId =
        decision.action === 'replace' && decision.document ? decision.document.id : null;
      const useDisplayName =
        parts.length === 1 ? displayName || page.title || undefined : page.title || undefined;
      const result = await ingestTextContent(page.text, {
        fileName,
        publicUrl: page.url,
        source: page.official ? 'web_official' : 'web',
        sourceKind: 'web',
        mimeType: 'text/html',
        categoryId,
        displayName: useDisplayName,
        description: description || undefined,
        contentSha256: fp.sha256,
        byteSize: fp.byteSize,
        replaceDocumentId,
        webHost: page.host,
        webOfficial: page.official,
        sourceUrl: page.url,
        onProgress: (p) => {
          if (!closed()) progress(p);
        },
      });
      items.push({
        ok: true,
        type: 'web',
        link: url,
        ...result,
        official: page.official,
        sourceUrl: page.url,
        pageTitle: page.title,
      });
    } catch (e) {
      items.push({ ok: false, type: 'web', link: url, error: e.message || String(e) });
    }
  }
  const failed = items.filter((it) => it.ok === false).length;
  return {
    source: 'web',
    count: items.length,
    items,
    files: items.filter((it) => it.id),
    failed,
  };
}

async function ingestWebPageSingle(url, ctx) {
  const [payload] = (await ingestWebUrls([url], ctx)).items;
  if (!payload?.ok && payload?.error) {
    throw Object.assign(new Error(payload.error), { status: 400 });
  }
  return payload;
}

function parseUploadUrlBody(req) {
  const raw = String(req.body?.url || '').trim();
  const categoryId = String(req.body?.categoryId || '').trim() || null;
  const displayName = String(req.body?.displayName || req.body?.title || '').trim();
  const description = String(req.body?.description || req.body?.moTa || '').trim();
  if (!raw) {
    throw Object.assign(new Error('Thiếu url'), { status: 400 });
  }
  return { raw, categoryId, displayName, description, parts: splitUrlParts(raw) };
}

router.post('/drive', async (req, res) => {
  let parsed;
  try {
    parsed = parseUploadUrlBody(req);
  } catch (e) {
    res.status(e.status || 400).json({ error: e.message });
    return;
  }
  if (!(await requireLiveKeys(res))) return;
  try {
    assertCanUseCategory(req.admin, parsed.categoryId);
  } catch (e) {
    res.status(e.status || 403).json({ error: e.message });
    return;
  }

  await runWithSse(req, res, async ({ closed, progress, done }) => {
    const payload = await ingestDriveUrls(parsed.parts, {
      categoryId: parsed.categoryId,
      displayName: parsed.displayName,
      description: parsed.description,
      req,
      closed,
      progress,
    });
    done(payload);
  });
});

router.post('/web', async (req, res) => {
  let parsed;
  try {
    parsed = parseUploadUrlBody(req);
  } catch (e) {
    res.status(e.status || 400).json({ error: e.message });
    return;
  }
  if (!(await requireLiveKeys(res))) return;
  try {
    assertCanUseCategory(req.admin, parsed.categoryId);
  } catch (e) {
    res.status(e.status || 403).json({ error: e.message });
    return;
  }

  await runWithSse(req, res, async ({ closed, progress, done }) => {
    const payload = await ingestWebUrls(parsed.parts, {
      categoryId: parsed.categoryId,
      displayName: parsed.displayName,
      description: parsed.description,
      closed,
      progress,
    });
    if (payload.failed === payload.count) {
      throw Object.assign(new Error(payload.items[0]?.error || 'Không số hóa được trang web nào'), {
        status: 400,
      });
    }
    done(payload);
  });
});

router.post('/url', async (req, res) => {
  let parsed;
  try {
    parsed = parseUploadUrlBody(req);
  } catch (e) {
    res.status(e.status || 400).json({ error: e.message });
    return;
  }
  if (!(await requireLiveKeys(res))) return;
  try {
    assertCanUseCategory(req.admin, parsed.categoryId);
  } catch (e) {
    res.status(e.status || 403).json({ error: e.message });
    return;
  }

  const driveParts = parsed.parts.map((p) => ({ raw: p, parsed: parseDriveResource(p) }));
  const allDrive = driveParts.every((p) => p.parsed);

  await runWithSse(req, res, async ({ closed, progress, done }) => {
    if (allDrive) {
      done(
        await ingestDriveUrls(parsed.parts, {
          categoryId: parsed.categoryId,
          displayName: parsed.displayName,
          description: parsed.description,
          req,
          closed,
          progress,
        })
      );
      return;
    }

    if (parsed.parts.length > 1) {
      done(
        await ingestWebUrls(parsed.parts, {
          categoryId: parsed.categoryId,
          displayName: parsed.displayName,
          description: parsed.description,
          closed,
          progress,
        })
      );
      return;
    }

    const result = await ingestWebPageSingle(parsed.parts[0], {
      categoryId: parsed.categoryId,
      displayName: parsed.displayName,
      description: parsed.description,
      closed,
      progress,
    });
    done(result);
  });
});

module.exports = router;
