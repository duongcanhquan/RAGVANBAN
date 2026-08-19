/**
 * Số hóa lại tài liệu đã có trong catalog (R2 / Drive / URL web).
 */

const { getDocument, listDocuments } = require('./supabase');
const { downloadFromR2 } = require('./r2');
const { ingestSingleFile, ingestTextContent } = require('./ingestFile');
const { extractWebPage, webCatalogFileName, assertSafeUrl } = require('../ingestion/extractWebPage');
const { textFingerprint } = require('./documentDedup');
const { assertCanTouchDoc, filterDocsForAdmin } = require('./documentAdmin');
const { getRagConfig } = require('./ragConfig');
const { invalidateSessionCache } = require('./sessionSearchCache');

function isWebSource(doc) {
  const source = String(doc?.source || doc?.metadata?.source || doc?.metadata?.nguon_loai || '').toLowerCase();
  return source === 'web' || source === 'web_official';
}

async function loadOriginalBuffer(doc) {
  const fileName = doc.file_name || 'van-ban.bin';
  const storagePath = doc.storage_path || doc.metadata?.storage_path || '';
  const driveId = doc.drive_file_id || doc.metadata?.drive_file_id || '';
  const url = doc.storage_url || doc.drive_web_view_link || doc.metadata?.link_goc || doc.metadata?.source_url || '';

  if (isWebSource(doc) && url && /^https?:\/\//i.test(url)) {
    return {
      kind: 'web',
      url,
      fileName,
      publicUrl: url,
      storagePath,
      source: doc.source || 'web',
    };
  }

  if (storagePath && String(storagePath).startsWith('van-ban/')) {
    const got = await downloadFromR2(storagePath);
    if (!got.ok) throw new Error(got.error || 'Không tải được file từ R2');
    return {
      kind: 'file',
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
      kind: 'file',
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
    assertSafeUrl(url);
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Không tải được bản gốc (${res.status})`);
    const buf = Buffer.from(await res.arrayBuffer());
    const ctype = res.headers.get('content-type') || 'application/octet-stream';
    if (/text\/html|application\/xhtml/i.test(ctype)) {
      return {
        kind: 'web',
        url,
        fileName,
        publicUrl: url,
        storagePath,
        source: doc.source || 'web',
      };
    }
    return {
      kind: 'file',
      buffer: buf,
      mimeType: ctype,
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
  const doc = found.item;

  let result;
  if (original.kind === 'web') {
    const page = await extractWebPage(original.url);
    const fp = textFingerprint(page.text, page.url);
    result = await ingestTextContent(page.text, {
      fileName: webCatalogFileName(page) || original.fileName,
      publicUrl: page.url,
      source: page.official ? 'web_official' : original.source || 'web',
      sourceKind: 'web',
      mimeType: 'text/html',
      categoryId: doc.category_id || doc.metadata?.category_id || null,
      displayName: doc.display_name || page.title || undefined,
      description: doc.mo_ta || doc.metadata?.mo_ta || undefined,
      contentSha256: fp.sha256,
      byteSize: fp.byteSize,
      replaceDocumentId: doc.id,
      webHost: page.host,
      webOfficial: page.official,
      sourceUrl: page.url,
      onProgress: options.onProgress,
    });
  } else {
    result = await ingestSingleFile(original.buffer, {
      fileName: original.fileName,
      mimeType: original.mimeType,
      publicUrl: original.publicUrl,
      storagePath: original.storagePath,
      driveFileId: original.driveFileId || doc.drive_file_id,
      driveWebViewLink: original.driveWebViewLink || doc.drive_web_view_link,
      source: doc.source || 'reindex',
      categoryId: doc.category_id || doc.metadata?.category_id || null,
      replaceDocumentId: doc.id,
      ocrLangs: rag.ocrLangs,
      onProgress: options.onProgress,
    });
  }

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

module.exports = { reingestDocument, reingestAll, loadOriginalBuffer, isWebSource };
