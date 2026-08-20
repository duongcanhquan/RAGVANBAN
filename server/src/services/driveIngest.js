/**
 * Ingest file từ Google Drive — file gốc ở lại Drive, chỉ đưa text vào Pinecone.
 * Tải về = link Drive. Không copy sang R2. Không copy sang Supabase trừ khi DRIVE_MIRROR_TO_SUPABASE=true.
 */
const { downloadPdf, listPdfInFolder, hasAnyDriveKey } = require('./googleDrive');
const { ingestSingleFile } = require('./ingestFile');
const { uploadPdfToStorage, isConfigured: isSupabaseConfigured } = require('./supabase');

function shouldMirrorToSupabase() {
  return String(process.env.DRIVE_MIRROR_TO_SUPABASE || '').toLowerCase() === 'true';
}

function summarizeDriveUrlJob(items) {
  const files = [];
  let folderLink = '';
  for (const it of items || []) {
    if (it?.type === 'folder') {
      folderLink =
        it.webViewLink ||
        it.link ||
        (it.folderId ? `https://drive.google.com/drive/folders/${it.folderId}` : '') ||
        folderLink;
      for (const r of it.results || []) {
        const view = r.driveWebViewLink || r.downloadUrl || folderLink;
        files.push({
          ok: r.ok !== false && !r.error,
          id: r.id || r.fileId,
          fileName: r.fileName || r.name,
          displayName: r.displayName || r.fileName || r.name,
          chunks: r.chunks || 0,
          driveWebViewLink: view,
          storageUrl: r.storageUrl || view,
          error: r.error,
          duplicate: r.duplicate,
        });
      }
    } else if (it) {
      const view = it.driveWebViewLink || it.downloadUrl || it.link || '';
      files.push({
        ok: !it.error && (it.id || it.ok !== false),
        id: it.id,
        fileName: it.fileName || it.name,
        displayName: it.displayName || it.fileName || it.name,
        chunks: it.chunks || 0,
        driveWebViewLink: view,
        storageUrl: it.storageUrl || view,
        error: it.error,
        duplicate: it.duplicate,
      });
    }
  }
  const okFiles = files.filter((f) => f.ok && f.id && !f.duplicate);
  const skippedDupes = files.filter((f) => f.duplicate);
  const first = okFiles[0] || skippedDupes[0] || files[0] || {};
  const n = okFiles.length;
  return {
    files,
    chunks: okFiles.reduce((sum, f) => sum + Number(f.chunks || 0), 0),
    processed: n,
    skippedDuplicates: skippedDupes.length,
    failed: files.filter((f) => !f.ok).length,
    fileName: n === 1 ? first.fileName : n ? `${n} file Drive` : 'Drive',
    displayName: n === 1 ? first.displayName || first.fileName : n ? `${n} file từ Google Drive` : 'Drive',
    driveWebViewLink: n === 1 ? first.driveWebViewLink || folderLink : folderLink || first.driveWebViewLink || '',
    storageUrl: n === 1 ? first.storageUrl || first.driveWebViewLink || '' : folderLink || first.storageUrl || '',
    downloadUrl:
      n === 1 ? first.driveWebViewLink || first.storageUrl || '' : folderLink || first.driveWebViewLink || '',
    id: first.id,
  };
}

function pickNewDriveFiles(files, ingestedIds, limit) {
  const seen = new Set(
    [...(ingestedIds || [])]
      .map((id) => String(id || '').trim())
      .filter(Boolean)
  );
  const listed = Array.isArray(files) ? files : [];
  const fresh = listed
    .filter((f) => f?.id && !seen.has(String(f.id)))
    .sort((a, b) => String(b.modifiedTime || '').localeCompare(String(a.modifiedTime || '')));
  const n = Math.min(40, Math.max(1, Number(limit) || 8));
  return {
    listed: listed.length,
    skipped: listed.length - fresh.length,
    pending: fresh.length,
    queued: fresh.slice(0, n),
  };
}

function driveFileIdFromWebhookBody(body) {
  const b = coerceWebhookBody(body);
  const direct = String(b.fileId || b.file_id || '').trim();
  if (direct) return direct;
  const id = String(b.id || '').trim();
  if (!id) return '';
  if (b.name || b.fileName || b.mimeType || Array.isArray(b.parents)) return id;
  if (/^[a-zA-Z0-9_-]{20,}$/.test(id) && !b.action) return id;
  return '';
}

/** n8n đôi khi gửi JSON đã stringify thành chuỗi — ép về object. */
function coerceWebhookBody(raw) {
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) return raw;
  if (typeof raw === 'string') {
    const s = raw.trim();
    if (!s) return {};
    try {
      const parsed = JSON.parse(s);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed;
    } catch {
      /* ignore */
    }
  }
  return {};
}

function skippedDriveResult(doc, extra = {}) {
  const view = extra.driveWebViewLink || doc.drive_web_view_link || extra.downloadUrl || '';
  return {
    duplicate: true,
    skipped: true,
    id: doc.id,
    fileName: doc.file_name,
    displayName: doc.display_name || doc.file_name,
    chunks: doc.chunk_count || 0,
    source: 'google_drive',
    driveFileId: extra.driveFileId || doc.drive_file_id,
    driveWebViewLink: view,
    storageUrl: doc.storage_url || view,
    downloadUrl: view,
    message:
      extra.message ||
      `File Drive đã có trong kho «${doc.display_name || doc.file_name}» — không OCR/vector lại.`,
  };
}

async function rememberDriveIdOnDocument(doc, driveFileId, driveWebViewLink) {
  if (!doc?.id || !driveFileId) return;
  const have = String(doc.drive_file_id || doc.metadata?.drive_file_id || '').trim();
  if (have === String(driveFileId)) return;
  const { updateDocument } = require('./supabase');
  await updateDocument(doc.id, {
    drive_file_id: driveFileId,
    drive_web_view_link: driveWebViewLink || doc.drive_web_view_link || null,
    metadata: {
      ...(doc.metadata || {}),
      drive_file_id: driveFileId,
      drive_web_view_link: driveWebViewLink || doc.drive_web_view_link || null,
      source: 'google_drive',
    },
  });
}

async function ingestDriveFile(fileId, options = {}) {
  const { onProgress, categoryId = null } = options;

  const notify = (stage, percent, message) => {
    if (typeof onProgress === 'function') onProgress({ stage, percent, message });
  };

  const { getDocumentByDriveFileId, getDocumentByContentHash, getDocumentByFileName } = require('./supabase');
  const already = await getDocumentByDriveFileId(fileId);
  if (already.item) {
    notify(
      'dedup',
      100,
      `File Drive đã có trong kho — bỏ qua, không vector lại: ${already.item.display_name || already.item.file_name}`
    );
    return skippedDriveResult(already.item, { driveFileId: fileId });
  }

  notify('drive', 5, `Đang đọc file Drive: ${fileId}`);
  const file = await downloadPdf(fileId);
  const { fileFingerprint, decideDuplicate, duplicateMessage } = require('./documentDedup');
  const fp = fileFingerprint(file.buffer);
  const [byHash, byName] = await Promise.all([
    getDocumentByContentHash(fp.sha256),
    getDocumentByFileName(file.fileName),
  ]);
  const decision = decideDuplicate(fp, {
    byHash: byHash.item || null,
    byName: byName.item || null,
  });
  if (decision.action === 'reuse' && decision.document) {
    notify('dedup', 100, duplicateMessage(decision.document));
    const doc = decision.document;
    await rememberDriveIdOnDocument(doc, file.driveFileId, file.driveWebViewLink);
    return skippedDriveResult(doc, {
      driveFileId: file.driveFileId,
      driveWebViewLink: file.driveWebViewLink,
      message: duplicateMessage(doc),
    });
  }

  let publicUrl = file.driveWebViewLink;
  let storagePath = '';

  if (shouldMirrorToSupabase() && isSupabaseConfigured()) {
    notify('storage', 15, 'Mirror PDF lên Supabase Storage…');
    const stored = await uploadPdfToStorage(file.buffer, file.fileName, file.mimeType);
    if (stored.ok) {
      publicUrl = stored.publicUrl || publicUrl;
      storagePath = stored.path || '';
    }
  }

  const result = await ingestSingleFile(file.buffer, {
    fileName: file.fileName,
    mimeType: file.mimeType,
    publicUrl,
    storagePath,
    driveFileId: file.driveFileId,
    driveWebViewLink: file.driveWebViewLink,
    source: 'google_drive',
    categoryId,
    displayName: options.displayName,
    description: options.description,
    contentSha256: fp.sha256,
    byteSize: fp.byteSize,
    replaceDocumentId: decision.action === 'replace' ? decision.document?.id : undefined,
    onProgress,
  });

  return {
    ...result,
    source: 'google_drive',
    driveFileId: file.driveFileId,
    driveWebViewLink: file.driveWebViewLink,
    storageUrl: publicUrl,
    downloadUrl: file.driveWebViewLink,
  };
}

async function syncDriveFolder(options = {}) {
  const { onProgress, limit = 20, folderId, categoryId } = options;
  let targets = [];
  if (folderId) {
    targets = [{ folderId, categoryId: categoryId || null }];
  } else {
    const { listDriveSources } = require('./integrations');
    const sources = (await listDriveSources()).filter((s) => s.enabled);
    if (sources.length) {
      targets = sources.map((s) => ({ folderId: s.folderId, categoryId: s.categoryId || categoryId || null }));
    } else if (process.env.GOOGLE_DRIVE_FOLDER_ID && !String(process.env.GOOGLE_DRIVE_FOLDER_ID).includes('your-')) {
      targets = [{ folderId: process.env.GOOGLE_DRIVE_FOLDER_ID, categoryId: categoryId || null }];
    }
  }
  if (!targets.length) {
    throw new Error('Chưa có thư mục Drive. Thêm link folder trong Cài đặt → Google Drive.');
  }
  if (!(await hasAnyDriveKey())) {
    throw new Error('Chưa có Google service account. Super-admin dán JSON trong Cài đặt.');
  }

  const { listIngestedDriveFileIds } = require('./supabase');
  const ingestedIds = await listIngestedDriveFileIds();
  const allResults = [];
  let totalListed = 0;
  let skipped = 0;
  let pending = 0;
  for (const t of targets) {
    const files = await listPdfInFolder(t.folderId);
    totalListed += files.length;
    const picked = pickNewDriveFiles(files, ingestedIds, limit);
    skipped += picked.skipped;
    pending += picked.pending;
    const slice = picked.queued;
    if (!slice.length) {
      if (typeof onProgress === 'function') {
        onProgress({
          stage: 'sync',
          percent: 100,
          message: picked.skipped
            ? `Không có file mới — ${picked.skipped} file đã có trong kho, không OCR/vector lại.`
            : 'Thư mục không có PDF/Word mới.',
        });
      }
      continue;
    }
    for (let i = 0; i < slice.length; i += 1) {
      const f = slice[i];
      if (typeof onProgress === 'function') {
        onProgress({
          stage: 'sync',
          percent: Math.round((i / Math.max(slice.length, 1)) * 100),
          message: `Số hóa file mới ${i + 1}/${slice.length}: ${f.name}`,
        });
      }
      try {
        const r = await ingestDriveFile(f.id, { onProgress, categoryId: t.categoryId });
        if (r?.duplicate || r?.skipped) {
          allResults.push({ ok: true, fileId: f.id, name: f.name, ...r });
          ingestedIds.push(f.id);
        } else if (!r?.id) {
          allResults.push({
            ok: false,
            fileId: f.id,
            name: f.name,
            error: r?.error || r?.message || 'Không ghi được tài liệu vào danh mục',
          });
        } else {
          allResults.push({ ok: true, fileId: f.id, name: f.name, ...r });
          ingestedIds.push(f.id);
        }
      } catch (err) {
        allResults.push({
          ok: false,
          id: err.catalogId || undefined,
          fileId: f.id,
          name: f.name,
          error: err.message,
        });
      }
    }
  }

  const recorded = allResults.filter((r) => r.id && !r.duplicate && !r.skipped);
  const failed = allResults.filter((r) => r.ok === false || r.error);

  return {
    totalListed,
    skipped,
    pending,
    processed: recorded.length,
    failed: failed.length,
    results: allResults,
    error: !recorded.length && failed.length ? failed[0].error : undefined,
  };
}

module.exports = {
  ingestDriveFile,
  syncDriveFolder,
  shouldMirrorToSupabase,
  pickNewDriveFiles,
  driveFileIdFromWebhookBody,
  coerceWebhookBody,
  summarizeDriveUrlJob,
};
