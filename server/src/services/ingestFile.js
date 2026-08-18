/**
 * Ingest tài liệu đa định dạng (PDF/DOC/PPT/ảnh OCR/text) hoặc text thuần.
 */
const path = require('path');
const { extractAnyText } = require('../ingestion/extractAnyText');
const { extractMetadataFromPrefix } = require('../ingestion/extractMetadata');
const { chunkTextWithMetadata } = require('../ingestion/chunkDocuments');
const { upsertChunksToPinecone } = require('../ingestion/upsertToPinecone');
const {
  getExtractLLM,
  getPinecone,
  getEmbeddings,
  withProviderFallback,
  hasLiveKeys,
} = require('./clients');
const { insertDocument } = require('./supabase');
const {
  listCategories,
  suggestCategoryId,
  pathForCategory,
  setLocalDocCategory,
} = require('./taxonomyStore');

function defaultUrlForFile(filePath) {
  const base = process.env.PUBLIC_DOCS_BASE_URL || '';
  const name = path.basename(filePath);
  if (base) return `${base.replace(/\/$/, '')}/${encodeURIComponent(name)}`;
  return `file://${String(filePath).replace(/\\/g, '/')}`;
}

function progress(onProgress, stage, percent, message) {
  if (typeof onProgress === 'function') {
    onProgress({ stage, percent, message });
  }
}

/**
 * Ingest từ chuỗi text đã có (dán tay / website).
 */
async function ingestTextContent(text, options = {}) {
  const {
    onProgress,
    dryRun = false,
    fileName = 'van-ban.txt',
    publicUrl = '',
    storagePath = '',
    mimeType = 'text/plain',
    sourceKind = 'text',
  } = options;

  const cleaned = String(text || '').trim();
  if (!cleaned) throw new Error('Nội dung trống');

  const chunkSize = Number(process.env.CHUNK_SIZE) || 900;
  const chunkOverlap = Number(process.env.CHUNK_OVERLAP) || 150;

  progress(onProgress, 'read', 15, `Đã nhận ${cleaned.length} ký tự (${sourceKind})`);

  progress(onProgress, 'metadata', 30, 'Đang bóc tách metadata…');
  let llm = null;
  let extractProvider = 'heuristic';
  if (!dryRun && hasLiveKeys()) {
    const extract = await getExtractLLM();
    llm = extract.llm;
    extractProvider = extract.provider;
  }

  const metadata = await extractMetadataFromPrefix(cleaned, {
    fileName,
    urlFileGoc: publicUrl || '',
    llm,
    useLlm: Boolean(llm),
  });

  if (publicUrl) {
    metadata.link_goc = publicUrl;
    metadata.url_file_goc = publicUrl;
  }
  metadata.nguon_loai = sourceKind;
  metadata.mime_type = mimeType;

  progress(onProgress, 'chunk', 50, 'Đang chunk văn bản…');
  const chunks = await chunkTextWithMetadata(cleaned, metadata, {
    chunkSize,
    chunkOverlap,
  });

  let upserted = 0;
  let embeddingProvider = null;

  if (!dryRun) {
    if (!hasLiveKeys()) {
      throw new Error('Thiếu cấu hình Multi-LLM / Pinecone để số hóa');
    }
    progress(onProgress, 'embed', 65, 'Đang embed & đẩy lên Pinecone…');
    const emb = await withProviderFallback('embedding', async (p) => getEmbeddings(p));
    embeddingProvider = emb.provider;
    const pinecone = getPinecone();

    const result = await upsertChunksToPinecone(chunks, {
      embeddings: emb.result,
      pinecone,
      indexName: process.env.PINECONE_INDEX_NAME || 'van-ban-hanh-chinh',
      namespace: process.env.PINECONE_NAMESPACE || '',
      batchSize: Number(process.env.UPSERT_BATCH_SIZE) || 64,
    });
    upserted = result.upserted;

    progress(onProgress, 'db', 90, 'Đang ghi metadata & chuyên mục…');
    const cats = await listCategories();
    const flat = cats.items || [];
    let categoryId = options.categoryId || null;
    if (!categoryId) {
      categoryId = suggestCategoryId(flat, {
        linhVuc: metadata.linh_vuc || metadata.chuyen_mon,
        loaiVanBan: metadata.loai_van_ban,
        fileName,
        text: cleaned,
      });
    }
    const folderPath = categoryId ? pathForCategory(flat, categoryId) : '';
    const cat = flat.find((c) => c.id === categoryId);
    metadata.category_id = categoryId;
    metadata.folder_path = folderPath;
    metadata.chuyen_mon = cat?.name || metadata.chuyen_mon || null;

    const inserted = await insertDocument({
      fileName,
      soHieu: metadata.so_hieu,
      loaiVanBan: metadata.loai_van_ban,
      trangThai: metadata.trang_thai,
      chunkCount: chunks.length,
      storagePath,
      storageUrl: publicUrl || metadata.link_goc,
      linkGoc: metadata.link_goc,
      driveFileId: options.driveFileId,
      driveWebViewLink: options.driveWebViewLink,
      source: options.source || sourceKind,
      categoryId,
      folderPath,
      chuyenMon: cat?.name || null,
      metadata,
    });

    if (inserted?.id && categoryId) {
      setLocalDocCategory(inserted.id, categoryId);
    }
  }

  progress(onProgress, 'done', 100, 'Hoàn tất số hóa');

  return {
    fileName,
    pageCount: 0,
    kind: sourceKind,
    metadata,
    chunks: chunks.length,
    upserted,
    extractProvider,
    embeddingProvider,
    storageUrl: publicUrl || metadata.link_goc || '',
    storagePath: storagePath || '',
    categoryId: metadata.category_id || options.categoryId || null,
    folderPath: metadata.folder_path || '',
  };
}

/**
 * @param {string|Buffer} source
 * @param {object} options
 */
async function ingestSingleFile(source, options = {}) {
  const {
    onProgress,
    dryRun = false,
    fileName: nameOpt,
    publicUrl,
    storagePath,
    mimeType,
  } = options;

  const fileName =
    nameOpt ||
    (typeof source === 'string' ? path.basename(source) : 'upload.bin');

  progress(onProgress, 'read', 10, `Đang trích xuất nội dung: ${fileName}`);
  const extracted = await extractAnyText(source, { fileName, mimeType });
  if (!extracted.text) {
    throw new Error(`Không trích xuất được text từ ${fileName}`);
  }

  const urlFileGoc =
    publicUrl ||
    (typeof source === 'string' ? defaultUrlForFile(source) : '');

  return ingestTextContent(extracted.text, {
    ...options,
    dryRun,
    onProgress,
    fileName,
    publicUrl: urlFileGoc,
    storagePath,
    mimeType: mimeType || 'application/octet-stream',
    sourceKind: extracted.kind || 'upload',
    pageCountHint: extracted.pageCount,
  }).then((r) => ({
    ...r,
    pageCount: extracted.pageCount || 0,
    kind: extracted.kind,
  }));
}

module.exports = { ingestSingleFile, ingestTextContent, defaultUrlForFile };
