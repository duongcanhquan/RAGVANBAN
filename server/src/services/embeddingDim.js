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
  'gemini-embedding-001': 768,
  'gemini-embedding-2': 768,
  'mistral-embed': 1024,
};

/** Chip trên console Pinecone (index gắn model sẵn) ≠ dimension tùy chọn của index dense. */
const INDEX_PAIRINGS = [
  {
    dim: 1536,
    recommended: true,
    provider: 'openai',
    defaultModel: 'text-embedding-3-small',
    pineconeUi: 'Custom settings, gõ 1536, cosine — ChatGPT / OpenAI',
    models: ['OpenAI text-embedding-3-small', 'OpenRouter openai/text-embedding-3-small'],
  },
  {
    dim: 768,
    recommended: false,
    provider: 'gemini',
    defaultModel: 'gemini-embedding-001',
    pineconeUi: 'Chip 768 có sẵn trên console',
    models: ['Gemini gemini-embedding-001 (768 chiều)'],
  },
  {
    dim: 1024,
    recommended: false,
    provider: 'mistral',
    defaultModel: 'mistral-embed',
    pineconeUi: 'Chip 1024 có sẵn — khớp Mistral, không khớp OpenAI 1536',
    models: ['Mistral mistral-embed (1024 chiều)'],
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
    'ChatGPT / OpenAI: Pinecone Custom settings, Dimensions 1536, cosine — embedding text-embedding-3-small. ' +
    'Gemini: chip 768 + gemini-embedding-001. Mistral: chip 1024 + mistral-embed. ' +
    'Không ghép OpenAI 1536 với index 768/1024, cũng không ghép Gemini 768 với index 1536.'
  );
}

function keepIndexFix(indexDim) {
  const rec = recommendEmbeddingForIndex(indexDim);
  if (!rec) {
    return `Giữ index ${indexDim}: chọn embedding model đúng ${indexDim} chiều trên /quantri/bo-nao.`;
  }
  const who =
    rec.provider === 'mistral'
      ? 'tab Embedding chọn Mistral, model mistral-embed, dán key Mistral ở tab API key'
      : rec.provider === 'gemini'
        ? 'tab Embedding chọn Gemini, model gemini-embedding-001, dán key Gemini ở tab API key'
        : rec.provider === 'openai'
          ? 'tab Embedding chọn OpenAI, model text-embedding-3-small, dán key OpenAI ở tab API key'
          : `chọn ${(rec.models || []).join(' / ')}`;
  return `Giữ index ${indexDim} chiều: ${who}. Không để OpenAI/Gemini/Mistral khác chiều làm embedding dự phòng.`;
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
    return 'Gemini gemini-embedding-001 → Pinecone chip 768, cosine (text-embedding-004 đã gỡ).';
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
    `Hai số phải giống nhau — không ghép ${vDim} với ${indexDim}. ` +
    `${keepIndexFix(indexDim)} ` +
    `Hoặc tạo index mới đúng ${vDim} chiều (cosine) rồi số hóa lại toàn bộ tài liệu.`
  );
}

function mismatchFixHint({ expected, indexDim, model, ok }) {
  if (ok || !indexDim) return '';
  return dimensionMismatchMessage({
    vectorDim: expected || '?',
    indexDim,
    model,
  });
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
  const pairings = INDEX_PAIRINGS.map((p) => ({
    ...p,
    yours: index != null && p.dim === index,
    recommended: index != null ? p.dim === index : Boolean(p.recommended),
  }));
  return {
    model: model || '',
    expectedDim: expected,
    indexDim: index,
    ok,
    hint: embeddingDimHint(model),
    createHint: pineconeCreateHint(),
    pairings,
    recommend: rec
      ? {
          ...rec,
          yours: true,
          recommended: true,
        }
      : null,
    fixHint: mismatchFixHint({ expected, indexDim: index, model, ok }),
    action: rec?.provider
      ? {
          embeddingPrimary: rec.provider,
          embeddingModel: rec.defaultModel || '',
          tab: 'embed',
        }
      : null,
  };
}

module.exports = {
  MODEL_DIMS,
  INDEX_PAIRINGS,
  expectedEmbeddingDim,
  vectorDim,
  embeddingDimHint,
  pineconeCreateHint,
  keepIndexFix,
  modelsForIndexDim,
  recommendEmbeddingForIndex,
  dimensionMismatchMessage,
  mismatchFixHint,
  assertEmbeddingFitsIndex,
  assertExpectedFitsIndex,
  getPineconeIndexDimension,
  peekPineconeIndexDimension,
  resetIndexDimCache,
  embeddingAlignmentReport,
};
