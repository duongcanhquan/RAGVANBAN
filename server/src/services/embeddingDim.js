/**
 * Dimension vector embedding phải trùng dimension index Pinecone.
 * Không convert được 768 ↔ 1536 — báo lỗi rõ, không ghi vector lệch.
 */

const MODEL_DIMS = {
  'text-embedding-3-small': 1536,
  'text-embedding-3-large': 3072,
  'text-embedding-ada-002': 1536,
  'text-embedding-004': 768,
  'embedding-001': 768,
  'gemini-embedding-001': 3072,
  'mistral-embed': 1024,
};

/** Chip trên console Pinecone (index gắn model sẵn) ≠ dimension tùy chọn của index dense. */
const INDEX_PAIRINGS = [
  {
    dim: 768,
    recommended: true,
    provider: 'gemini',
    pineconeUi: 'Chọn 768 trên console (chip có sẵn)',
    models: ['Gemini text-embedding-004'],
  },
  {
    dim: 1024,
    recommended: false,
    provider: null,
    pineconeUi: 'Chip 1024',
    models: ['mistral-embed'],
  },
  {
    dim: 1536,
    recommended: false,
    provider: 'openai',
    pineconeUi: 'Không có chip 1536 — Custom settings, gõ 1536, cosine',
    models: ['OpenAI text-embedding-3-small', 'OpenRouter openai/text-embedding-3-small'],
  },
];

function modelsForIndexDim(dim) {
  const row = INDEX_PAIRINGS.find((p) => p.dim === Number(dim));
  return row ? [...row.models] : [];
}

function recommendEmbeddingForIndex(indexDim) {
  return INDEX_PAIRINGS.find((p) => p.dim === Number(indexDim)) || null;
}

function pineconeCreateHint() {
  return (
    'Console Pinecone thường hiện chip 384 / 512 / 768 / 1024 / 2048 (index gắn model sẵn của họ). ' +
    'App này tự tạo vector rồi gửi lên — tạo index dense, metric cosine. ' +
    'Cách dễ: chọn chip 768 rồi embedding Gemini text-embedding-004. ' +
    'Muốn OpenAI: bấm Custom settings, gõ 1536, cosine — không cần chip 1536.'
  );
}

function expectedEmbeddingDim(model) {
  const raw = String(model || '')
    .trim()
    .toLowerCase()
    .replace(/^models\//, '');
  if (!raw) return null;
  if (MODEL_DIMS[raw]) return MODEL_DIMS[raw];
  const short = raw.split('/').pop();
  if (MODEL_DIMS[short]) return MODEL_DIMS[short];
  for (const [id, dim] of Object.entries(MODEL_DIMS)) {
    if (raw.endsWith(`/${id}`) || raw === id) return dim;
  }
  return null;
}

function vectorDim(vec) {
  if (!Array.isArray(vec) || vec.length === 0) return 0;
  if (typeof vec[0] === 'number') return vec.length;
  if (Array.isArray(vec[0])) return vec[0].length;
  return 0;
}

function embeddingDimHint(model) {
  const dim = expectedEmbeddingDim(model);
  if (dim === 768) {
    return 'Gemini text-embedding-004 → trên Pinecone chọn chip 768, cosine (khớp sẵn, không cần 1536).';
  }
  if (dim === 1536) {
    return 'OpenAI text-embedding-3-small = 1536. Console không có chip 1536: Custom settings, gõ 1536, cosine.';
  }
  if (dim === 1024) {
    return 'mistral-embed → index Pinecone 1024 chiều (cosine).';
  }
  if (dim) return `Model ${model} → index Pinecone ${dim} chiều.`;
  return pineconeCreateHint();
}

function dimensionMismatchMessage({ vectorDim: vDim, indexDim, model }) {
  return (
    `Embedding ra ${vDim} chiều (model ${model || '?'}) nhưng index Pinecone là ${indexDim} chiều. ` +
    `Hai số phải giống nhau — không ghép được Gemini text-embedding-004 (768) với index 1536 của OpenAI text-embedding-3-small. ` +
    `Cách xử lý: (1) dùng embedding khớp index hiện tại, hoặc (2) tạo index mới đúng chiều rồi số hóa lại toàn bộ tài liệu.`
  );
}

function assertEmbeddingFitsIndex({ vectors, indexDim, model } = {}) {
  const vDim = vectorDim(vectors);
  const iDim = Number(indexDim);
  if (!vDim || !Number.isFinite(iDim) || iDim <= 0) {
    return { ok: true, skipped: true, vectorDim: vDim, indexDim: iDim || null };
  }
  if (vDim !== iDim) {
    const err = new Error(dimensionMismatchMessage({ vectorDim: vDim, indexDim: iDim, model }));
    err.code = 'EMBEDDING_DIM_MISMATCH';
    throw err;
  }
  return { ok: true, vectorDim: vDim, indexDim: iDim };
}

function assertExpectedFitsIndex({ model, indexDim } = {}) {
  const expected = expectedEmbeddingDim(model);
  const iDim = Number(indexDim);
  if (!expected || !Number.isFinite(iDim) || iDim <= 0) {
    return { ok: true, skipped: true, expected, indexDim: iDim || null };
  }
  if (expected !== iDim) {
    const err = new Error(
      dimensionMismatchMessage({ vectorDim: expected, indexDim: iDim, model })
    );
    err.code = 'EMBEDDING_DIM_MISMATCH';
    throw err;
  }
  return { ok: true, expected, indexDim: iDim };
}

let dimCache = { name: '', dim: null, at: 0 };

function resetIndexDimCache() {
  dimCache = { name: '', dim: null, at: 0 };
}

function peekPineconeIndexDimension(indexName) {
  const name = String(indexName || '').trim();
  if (!name) return null;
  if (dimCache.name === name && Date.now() - dimCache.at < 60_000) return dimCache.dim;
  return null;
}

async function getPineconeIndexDimension(pinecone, indexName) {
  const name = String(indexName || '').trim();
  if (!pinecone || !name) return null;
  if (dimCache.name === name && Date.now() - dimCache.at < 60_000) return dimCache.dim;
  if (typeof pinecone.describeIndex !== 'function') return null;
  try {
    const info = await pinecone.describeIndex(name);
    const dim = Number(info?.dimension);
    dimCache = {
      name,
      dim: Number.isFinite(dim) && dim > 0 ? dim : null,
      at: Date.now(),
    };
    return dimCache.dim;
  } catch {
    return null;
  }
}

function embeddingAlignmentReport({ model, indexDim } = {}) {
  const expected = expectedEmbeddingDim(model);
  const index = Number(indexDim) || null;
  const ok = !expected || !index || expected === index;
  const rec = recommendEmbeddingForIndex(index);
  return {
    model: model || '',
    expectedDim: expected,
    indexDim: index,
    ok,
    hint: embeddingDimHint(model),
    createHint: pineconeCreateHint(),
    pairings: INDEX_PAIRINGS,
    recommend: rec,
  };
}

module.exports = {
  MODEL_DIMS,
  INDEX_PAIRINGS,
  expectedEmbeddingDim,
  vectorDim,
  embeddingDimHint,
  pineconeCreateHint,
  modelsForIndexDim,
  recommendEmbeddingForIndex,
  dimensionMismatchMessage,
  assertEmbeddingFitsIndex,
  assertExpectedFitsIndex,
  getPineconeIndexDimension,
  peekPineconeIndexDimension,
  resetIndexDimCache,
  embeddingAlignmentReport,
};
