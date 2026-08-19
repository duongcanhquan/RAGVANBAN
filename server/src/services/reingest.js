/**
 * Số hóa lại tài liệu đã có trong catalog (R2 / Drive / URL).
 */

const { getDocument, listDocuments } = require('./supabase');
const { downloadFromR2 } = require('./r2');
const { ingestSingleFile } = require('./ingestFile');
const { assertCanTouchDoc, filterDocsForAdmin } = require('./documentAdmin');
const { getRagConfig } = require('./ragConfig');
const { invalidateSessionCache } = require('./sessionSearchCache');

async function loadOriginalBuffer(doc) {
  const fileName = doc.file_name || 'van-ban.bin';
  const storagePath = doc.storage_path || doc.metadata?.storage_path || '';
  const driveId = doc.drive_file_id || doc.metadata?.drive_file_id || '';
  const url = doc.storage_url || doc.drive_web_view_link || doc.metadata?.link_goc || '';

  if (storagePath && String(storagePath).startsWith('van-ban/')) {
    const got = await downloadFromR2(storagePath);
    if (!got.ok) throw new Error(got.error || 'Không tải được file từ R2');
    return {
      buffer: got.buffer,
      mimeType: got.contentType,
      fileName,
      publicUrl: got.publicUrl || url,
      storagePath,
    };
  }

  if (driveId) {
    const { downloadPdf } = require('./googleDrive');
    const file = await downloadPdf(driveId);
    return {
      buffer: file.buffer,
      mimeType: file.mimeType,
      fileName: file.fileName || fileName,
      publicUrl: file.driveWebViewLink || url,
      storagePath,
      driveFileId: file.driveFileId,
      driveWebViewLink: file.driveWebViewLink,
    };
  }

  if (url && /^https?:\/\//i.test(url)) {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Không tải được bản gốc (${res.status})`);
    const buf = Buffer.from(await res.arrayBuffer());
    return {
      buffer: buf,
      mimeType: res.headers.get('content-type') || 'application/octet-stream',
      fileName,
      publicUrl: url,
      storagePath,
    };
  }

  throw new Error('Không còn file gốc (R2 / Drive / URL) để số hóa lại');
}

async function reingestDocument(admin, id, options = {}) {
  const found = await getDocument(id);
  if (!found.ok) {
    const err = new Error(found.error || 'Không tìm thấy tài liệu');
    err.status = 404;
    throw err;
  }
  assertCanTouchDoc(admin, found.item);
  const rag = await getRagConfig();
  const original = await loadOriginalBuffer(found.item);
  const result = await ingestSingleFile(original.buffer, {
    fileName: original.fileName,
    mimeType: original.mimeType,
    publicUrl: original.publicUrl,
    storagePath: original.storagePath,
    driveFileId: original.driveFileId || found.item.drive_file_id,
    driveWebViewLink: original.driveWebViewLink || found.item.drive_web_view_link,
    source: found.item.source || 'reindex',
    categoryId: found.item.category_id || found.item.metadata?.category_id || null,
    replaceDocumentId: found.item.id,
    ocrLangs: rag.ocrLangs,
    onProgress: options.onProgress,
  });
  invalidateSessionCache();
  return result;
}

async function reingestAll(admin, options = {}) {
  const limit = Math.min(80, Math.max(1, Number(options.limit) || 40));
  const offset = Math.max(0, Number(options.offset) || 0);
  const listed = await listDocuments({ limit: 2000 });
  const docs = filterDocsForAdmin(admin, listed.items || []);
  const slice = docs.slice(offset, offset + limit);
  const results = [];
  for (let i = 0; i < slice.length; i += 1) {
    const doc = slice[i];
    if (typeof options.onProgress === 'function') {
      options.onProgress({
        stage: 'reindex',
        percent: Math.round((i / Math.max(slice.length, 1)) * 100),
        message: `Số hóa lại ${i + 1}/${slice.length}: ${doc.file_name}`,
      });
    }
    try {
      const r = await reingestDocument(admin, doc.id);
      results.push({ ok: true, id: doc.id, fileName: doc.file_name, chunks: r.chunks, upserted: r.upserted });
    } catch (err) {
      results.push({ ok: false, id: doc.id, fileName: doc.file_name, error: err.message });
    }
  }
  const failed = results.filter((r) => !r.ok).length;
  const nextOffset = offset + slice.length;
  return {
    ok: failed === 0,
    processed: results.length,
    failed,
    results,
    offset,
    nextOffset,
    total: docs.length,
    hasMore: nextOffset < docs.length,
  };
}

module.exports = { reingestDocument, reingestAll, loadOriginalBuffer };
