/**
 * Ingest tài liệu đa định dạng (PDF/DOC/PPT/ảnh OCR/text) hoặc text thuần.
 */
const path = require('path');
const { extractAnyText } = require('../ingestion/extractAnyText');
const {
  extractMetadataFromPrefix,
  enrichMetadataFromFullText,
} = require('../ingestion/extractMetadata');
const { chunkTextWithMetadata } = require('../ingestion/chunkDocuments');
const { upsertChunksToPinecone } = require('../ingestion/upsertToPinecone');
const {
  getExtractLLM,
  getPinecone,
  pineconeIndexTarget,
  getEmbeddings,
  withProviderFallback,
  hasLiveKeys,
  ensureBrain,
  brainNotReadyMessage,
} = require('./clients');
const { insertDocument, getDocumentByFileName, updateDocument, getDocument, isConfigured } = require('./supabase');
const {
  catalogFieldsFromIngest,
  assertCatalogPersisted,
} = require('./documentCatalog');
const { providerCreds } = require('./llmConfig');
const { assertExpectedFitsIndex, getPineconeIndexDimension } = require('./embeddingDim');
const {
  listCategories,
  suggestCategoryId,
  pathForCategory,
  setLocalDocCategory,
} = require('./taxonomyStore');
const { getRagConfig, assertUploadSize } = require('./ragConfig');

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

  const rag = await getRagConfig();
  const chunkSize = Number(options.chunkSize) || rag.chunkSize;
  const chunkOverlap =
    options.chunkOverlap != null && options.chunkOverlap !== ''
      ? Number(options.chunkOverlap)
      : rag.chunkOverlap;

  progress(onProgress, 'read', 15, `Đã nhận ${cleaned.length} ký tự (${sourceKind})`);

  progress(onProgress, 'metadata', 30, 'Đang bóc tách metadata…');
  if (!dryRun) await ensureBrain();
  let llm = null;
  let extractProvider = 'heuristic';
  if (!dryRun && hasLiveKeys()) {
    const extract = await getExtractLLM();
    llm = extract.llm;
    extractProvider = extract.provider;
  }

  const extractedMeta = await extractMetadataFromPrefix(cleaned, {
    fileName,
    urlFileGoc: publicUrl || '',
    llm,
    useLlm: Boolean(llm),
  });
  const metadata = enrichMetadataFromFullText(extractedMeta, cleaned);

  const names = catalogFieldsFromIngest({
    fileName,
    displayName: options.displayName,
    description: options.description,
  });
  metadata.display_name = names.display_name;
  metadata.mo_ta = names.mo_ta;
  metadata.ten_hien_thi = names.display_name;

  if (publicUrl) {
    metadata.link_goc = publicUrl;
    metadata.url_file_goc = publicUrl;
  }
  metadata.nguon_loai = sourceKind;
  metadata.mime_type = mimeType;
  if (options.pageCountHint) metadata.page_count = Number(options.pageCountHint) || 0;

  progress(onProgress, 'chunk', 50, 'Đang chunk văn bản…');
  const chunks = await chunkTextWithMetadata(cleaned, metadata, {
    chunkSize,
    chunkOverlap,
  });
  if (!chunks.length) {
    throw new Error(
      `Không tách được đoạn văn từ ${fileName}. File có thể là PDF scan/ảnh không có lớp chữ — bật OCR hoặc tải bản Word.`
    );
  }

  let upserted = 0;
  let embeddingProvider = null;
  let insertedId = null;

  if (!dryRun) {
    if (!hasLiveKeys()) {
      throw new Error(brainNotReadyMessage());
    }
    progress(onProgress, 'embed', 65, 'Đang embed & đẩy lên Pinecone…');
    const pinecone = getPinecone();
    const pc = pineconeIndexTarget();
    const indexDim = await getPineconeIndexDimension(pinecone, pc.indexName);
    const emb = await withProviderFallback('embedding', async (p) => {
      const creds = providerCreds(p);
      assertExpectedFitsIndex({ model: creds.embeddingModel, indexDim });
      return getEmbeddings(p);
    });
    embeddingProvider = emb.provider;

    const existing =
      options.replaceDocumentId
        ? { ok: true, id: options.replaceDocumentId }
        : await getDocumentByFileName(fileName);
    const documentId = existing?.id || existing?.item?.id || options.replaceDocumentId || '';
    if (documentId) {
      chunks.forEach((c) => {
        c.metadata = { ...(c.metadata || {}), document_id: documentId };
      });
    }

    const result = await upsertChunksToPinecone(chunks, {
      embeddings: emb.result,
      pinecone,
      indexName: pc.indexName,
      namespace: pc.namespace,
      batchSize: Number(process.env.UPSERT_BATCH_SIZE) || 64,
      replaceFileName: fileName,
      previousIds: existing?.item?.metadata?.pinecone_ids || existing?.metadata?.pinecone_ids,
    });
    upserted = result.upserted;
    metadata.pinecone_ids = result.ids || [];

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
    if (options.contentSha256) {
      metadata.content_sha256 = options.contentSha256;
      metadata.byte_size = options.byteSize != null ? Number(options.byteSize) : undefined;
    }

    const catalogPayload = {
      fileName,
      displayName: names.display_name,
      description: names.mo_ta,
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
      contentSha256: options.contentSha256 || null,
      byteSize: options.byteSize,
      metadata,
    };

    const replaceId = options.replaceDocumentId || existing?.id || existing?.item?.id || null;
    let persisted;
    if (replaceId) {
      persisted = await updateDocument(replaceId, {
        file_name: fileName,
        display_name: names.display_name,
        mo_ta: names.mo_ta,
        so_hieu: metadata.so_hieu,
        loai_van_ban: metadata.loai_van_ban,
        trang_thai: metadata.trang_thai,
        storage_path: storagePath || undefined,
        storage_url: publicUrl || metadata.link_goc || undefined,
        content_sha256: options.contentSha256 || undefined,
        byte_size: options.byteSize,
        metadata,
        chunk_count: chunks.length,
      });
      insertedId = replaceId;
      if (!persisted?.ok) {
        persisted = await insertDocument({ ...catalogPayload, id: replaceId });
        insertedId = persisted?.id || replaceId;
      } else {
        persisted = { ok: true, id: replaceId, source: persisted.source };
      }
    } else {
      persisted = await insertDocument(catalogPayload);
      insertedId = persisted?.id || null;
    }
    assertCatalogPersisted(
      { ...persisted, id: insertedId },
      { supabaseConfigured: isConfigured() }
    );
    const verified = await getDocument(insertedId);
    if (!verified?.ok || !verified.item) {
      const err = new Error(
        'Số hóa vector xong nhưng không đọc lại được dòng danh mục. Kiểm tra bảng documents trên Supabase.'
      );
      err.code = 'CATALOG_VERIFY_FAILED';
      throw err;
    }
    if (isConfigured() && verified.source !== 'supabase') {
      const err = new Error(
        'Danh mục chỉ ghi được file local — thư viện trên server không thấy. Kiểm tra SUPABASE_SERVICE_ROLE_KEY.'
      );
      err.code = 'CATALOG_VERIFY_FAILED';
      throw err;
    }

    if (insertedId && categoryId) {
      setLocalDocCategory(insertedId, categoryId);
    }
  }

  progress(onProgress, 'done', 100, 'Hoàn tất số hóa');

  return {
    id: insertedId,
    fileName,
    displayName: names.display_name,
    moTa: names.mo_ta,
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
  const rag = await getRagConfig();
  if (Buffer.isBuffer(source)) {
    assertUploadSize(source.length, rag.uploadMaxBytes);
  }
  const extracted = await extractAnyText(source, {
    fileName,
    mimeType,
    ocrLangs: options.ocrLangs || rag.ocrLangs,
    onProgress: (p) => {
      if (p && p.message) progress(onProgress, p.stage || 'ocr', p.percent ?? 20, p.message);
    },
  });
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
