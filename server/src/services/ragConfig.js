/**
 * Cấu hình RAG / số hóa — admin ghi đè .env.
 */

const { getSetting, setSetting } = require('./appSettings');

const RAG_KEY = 'rag_config';

const DEFAULT_DISCLAIMER =
  'Nội dung chỉ hỗ trợ tra cứu văn bản trong kho, không thay thế tư vấn pháp lý chính thức.';

function clampInt(n, min, max, fallback) {
  const t = Number(n);
  if (!Number.isFinite(t)) return fallback;
  return Math.min(max, Math.max(min, Math.round(t)));
}

function defaultRag() {
  return {
    topK: clampInt(process.env.RAG_TOP_K, 4, 40, 16),
    maxPerDoc: 4,
    maxTotal: 12,
    chunkSize: clampInt(process.env.CHUNK_SIZE, 400, 4000, 1200),
    chunkOverlap: clampInt(process.env.CHUNK_OVERLAP, 0, 800, 150),
    onlyActiveDefault: true,
    skipIntentLlmWhenAnchored: true,
    ocrLangs: String(process.env.OCR_LANGS || 'vie+eng').slice(0, 40),
    uploadMaxBytes: clampInt(process.env.UPLOAD_MAX_BYTES, 1_000_000, 80_000_000, 41_943_040),
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
      1_000_000,
      80_000_000,
      base.uploadMaxBytes
    ),
    disclaimer: String(input.disclaimer ?? base.disclaimer).trim().slice(0, 400) || DEFAULT_DISCLAIMER,
  };
}

function assertUploadSize(byteLength, maxBytes) {
  const size = Number(byteLength) || 0;
  const max = Number(maxBytes) || defaultRag().uploadMaxBytes;
  if (size > max) {
    const mb = Math.max(1, Math.round(max / (1024 * 1024)));
    const err = new Error(`File vượt giới hạn ${mb} MB đã đặt trong RAG & số hóa`);
    err.status = 413;
    throw err;
  }
  return true;
}

function publicRagPayload(rag) {
  const r = normalizeRag(rag);
  return {
    disclaimer: r.disclaimer,
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
  defaultRag,
  normalizeRag,
  publicRagPayload,
  getRagConfig,
  setRagConfig,
  assertUploadSize,
};
