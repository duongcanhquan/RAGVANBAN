/**
 * Cấu hình RAG / số hóa — admin ghi đè .env.
 */

const { getSetting, setSetting } = require('./appSettings');

const RAG_KEY = 'rag_config';

const DEFAULT_DISCLAIMER =
  'Nội dung chỉ hỗ trợ tra cứu văn bản trong kho, không thay thế tư vấn pháp lý chính thức.';

const MB = 1024 * 1024;
const UPLOAD_MAX_BYTES_MIN = 64 * 1024;
const UPLOAD_MAX_BYTES_MAX = 512 * MB;
const UPLOAD_MAX_BYTES_DEFAULT = 40 * MB;
/** Website không gửi được file lớn hơn ~4.5 MB (giới hạn nền tảng). */
const DIRECT_UPLOAD_MAX_BYTES = 4_500_000;

function clampInt(n, min, max, fallback) {
  const t = Number(n);
  if (!Number.isFinite(t)) return fallback;
  return Math.min(max, Math.max(min, Math.round(t)));
}

function defaultRag() {
  return {
    topK: clampInt(process.env.RAG_TOP_K, 4, 40, 12),
    maxPerDoc: 3,
    maxTotal: 8,
    chunkSize: clampInt(process.env.CHUNK_SIZE, 400, 4000, 1200),
    chunkOverlap: clampInt(process.env.CHUNK_OVERLAP, 0, 800, 150),
    onlyActiveDefault: true,
    skipIntentLlmWhenAnchored: true,
    ocrLangs: String(process.env.OCR_LANGS || 'vie+eng').slice(0, 40),
    uploadMaxBytes: clampInt(
      process.env.UPLOAD_MAX_BYTES,
      UPLOAD_MAX_BYTES_MIN,
      UPLOAD_MAX_BYTES_MAX,
      UPLOAD_MAX_BYTES_DEFAULT
    ),
    disclaimer: DEFAULT_DISCLAIMER,
  };
}

function normalizeRag(input = {}) {
  const base = defaultRag();
  const chunkSize = clampInt(input.chunkSize ?? input.chunk_size, 400, 4000, base.chunkSize);
  let chunkOverlap = clampInt(input.chunkOverlap ?? input.chunk_overlap, 0, 800, base.chunkOverlap);
  if (chunkOverlap >= chunkSize) {
    chunkOverlap = Math.min(Math.floor(chunkSize * 0.15), Math.max(0, chunkSize - 1));
  }
  return {
    topK: clampInt(input.topK ?? input.top_k, 4, 40, base.topK),
    maxPerDoc: clampInt(input.maxPerDoc ?? input.max_per_doc, 1, 12, base.maxPerDoc),
    maxTotal: clampInt(input.maxTotal ?? input.max_total, 4, 32, base.maxTotal),
    chunkSize,
    chunkOverlap,
    onlyActiveDefault: input.onlyActiveDefault !== false && input.only_active_default !== false,
    skipIntentLlmWhenAnchored:
      input.skipIntentLlmWhenAnchored !== false && input.skip_intent_llm_when_anchored !== false,
    ocrLangs: String(input.ocrLangs || input.ocr_langs || base.ocrLangs).slice(0, 40) || base.ocrLangs,
    uploadMaxBytes: clampInt(
      input.uploadMaxBytes ?? input.upload_max_bytes,
      UPLOAD_MAX_BYTES_MIN,
      UPLOAD_MAX_BYTES_MAX,
      base.uploadMaxBytes
    ),
    disclaimer: String(input.disclaimer ?? base.disclaimer).trim().slice(0, 400) || DEFAULT_DISCLAIMER,
  };
}

function assertUploadSize(byteLength, maxBytes) {
  const size = Number(byteLength) || 0;
  const max = Number(maxBytes) || defaultRag().uploadMaxBytes;
  if (size > max) {
    const err = new Error(`File vượt giới hạn ${formatBytes(max)} đã đặt trong RAG & số hóa`);
    err.status = 413;
    throw err;
  }
  return true;
}

/** Trần multer theo cấu hình RAG — không đệm tới UPLOAD_MAX_BYTES_MAX nếu admin đặt thấp hơn. */
function multerFileSizeCap(maxBytes) {
  const n = Number(maxBytes);
  if (!Number.isFinite(n) || n < 1) return defaultRag().uploadMaxBytes;
  return Math.min(Math.max(Math.round(n), 1), UPLOAD_MAX_BYTES_MAX);
}

function formatBytes(n) {
  const x = Number(n) || 0;
  if (x < 1024) return `${Math.round(x)} byte`;
  if (x < 1_000_000) return `${Math.max(1, Math.round(x / 1024))} KB`;
  const si = x / 1_000_000;
  if (si < 10) {
    const t = Math.round(si * 10) / 10;
    return `${Number.isInteger(t) ? String(t) : t.toFixed(1)} MB`;
  }
  return `${Math.round(x / MB)} MB`;
}

function uploadLimits(rag, _env = process.env) {
  const max = normalizeRag(rag).uploadMaxBytes;
  return {
    uploadMaxBytes: max,
    httpUploadMaxBytes: Math.min(max, DIRECT_UPLOAD_MAX_BYTES),
    directUploadMaxBytes: DIRECT_UPLOAD_MAX_BYTES,
  };
}

function splitUploadFiles(files, limits) {
  const list = Array.isArray(files) ? files : [];
  const cap = Number(limits?.uploadMaxBytes) || defaultRag().uploadMaxBytes;
  const httpMax = Number(limits?.httpUploadMaxBytes) || Math.min(cap, DIRECT_UPLOAD_MAX_BYTES);
  const direct = [];
  const useDrive = [];
  const tooLarge = [];
  for (const f of list) {
    const size = Number(f?.size) || 0;
    if (size > cap) tooLarge.push(f);
    else if (size > httpMax) useDrive.push(f);
    else direct.push(f);
  }
  return { direct, useDrive, tooLarge };
}

function publicRagPayload(rag) {
  const r = normalizeRag(rag);
  const limits = uploadLimits(r);
  return {
    disclaimer: r.disclaimer,
    uploadMaxBytes: r.uploadMaxBytes,
    httpUploadMaxBytes: limits.httpUploadMaxBytes,
    directUploadMaxBytes: DIRECT_UPLOAD_MAX_BYTES,
  };
}

async function getRagConfig() {
  const stored = await getSetting(RAG_KEY);
  if (stored && typeof stored === 'object') return normalizeRag(stored);
  return defaultRag();
}

async function setRagConfig(input) {
  const value = normalizeRag(input);
  const saved = await setSetting(RAG_KEY, value);
  if (saved && saved.ok === false) {
    const err = new Error(saved.error || 'Không lưu được cấu hình RAG');
    err.status = 503;
    throw err;
  }
  return { ok: true, source: saved.source, rag: value };
}

module.exports = {
  RAG_KEY,
  DEFAULT_DISCLAIMER,
  UPLOAD_MAX_BYTES_MIN,
  UPLOAD_MAX_BYTES_MAX,
  UPLOAD_MAX_BYTES_DEFAULT,
  DIRECT_UPLOAD_MAX_BYTES,
  defaultRag,
  normalizeRag,
  publicRagPayload,
  getRagConfig,
  setRagConfig,
  assertUploadSize,
  multerFileSizeCap,
  uploadLimits,
  splitUploadFiles,
  formatBytes,
};
