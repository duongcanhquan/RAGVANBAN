/**
 * Gemini embedding qua REST — text-embedding-004 đã gỡ.
 * gemini-embedding-001 mặc định 3072 chiều; ta xin outputDimensionality 768
 * để khớp chip Pinecone khuyến nghị. Vector space khác 004 → phải số hóa lại.
 */

const { Embeddings } = require('@langchain/core/embeddings');
const { normalizeGeminiEmbedModel, GEMINI_EMBED_CURRENT } = require('./llmConfig');

function l2Normalize(vec) {
  if (!Array.isArray(vec) || !vec.length) return vec;
  let sum = 0;
  for (const x of vec) sum += Number(x) * Number(x);
  const n = Math.sqrt(sum);
  if (!n) return vec.map(() => 0);
  return vec.map((x) => Number(x) / n);
}

function chunk(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

class GeminiEmbeddings extends Embeddings {
  constructor(fields = {}) {
    super(fields);
    this.apiKey = String(fields.apiKey || '').trim();
    this.model = normalizeGeminiEmbedModel(fields.model || GEMINI_EMBED_CURRENT);
    this.outputDimensionality = Number(fields.outputDimensionality) || 768;
    this.fetchImpl = fields.fetchImpl || fetch;
  }

  usesTaskType() {
    return !/^gemini-embedding-2/i.test(this.model);
  }

  async embedQuery(text) {
    const [vec] = await this._embed([text], 'RETRIEVAL_QUERY');
    return vec;
  }

  async embedDocuments(documents) {
    return this._embed(documents, 'RETRIEVAL_DOCUMENT');
  }

  async _embed(texts, taskType) {
    const list = (texts || []).map((t) => String(t || ''));
    const out = [];
    for (const batch of chunk(list, 16)) {
      const part = await this._batch(batch, taskType);
      out.push(...part);
    }
    return out;
  }

  async _batch(texts, taskType) {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(this.model)}:batchEmbedContents`;
    const requests = texts.map((text) => {
      const req = {
        model: `models/${this.model}`,
        content: { parts: [{ text }] },
        outputDimensionality: this.outputDimensionality,
      };
      if (this.usesTaskType()) req.taskType = taskType;
      return req;
    });
    const res = await this.fetchImpl(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': this.apiKey,
      },
      body: JSON.stringify({ requests }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const msg =
        data?.error?.message ||
        data?.message ||
        `Gemini embedding HTTP ${res.status}`;
      throw new Error(`[GoogleGenerativeAI Error]: ${msg}`);
    }
    const embeddings = data.embeddings || [];
    if (embeddings.length !== texts.length) {
      throw new Error(
        `Gemini embedding trả ${embeddings.length} vector, kỳ vọng ${texts.length}`
      );
    }
    return embeddings.map((row) => l2Normalize(row.values || row.embedding?.values || []));
  }
}

function createGeminiEmbeddings(fields) {
  return new GeminiEmbeddings(fields);
}

module.exports = {
  GeminiEmbeddings,
  createGeminiEmbeddings,
  l2Normalize,
};
