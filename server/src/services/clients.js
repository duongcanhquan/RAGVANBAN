/**
 * Shared clients — Pinecone + LLM/Embeddings qua llmFactory (Multi-LLM).
 */

const {
  getLLM,
  getEmbeddings,
  withProviderFallback,
  hasLiveKeys,
  listAvailableProviders,
} = require('./llmFactory');

let pineconeCached = null;

function getPinecone() {
  if (pineconeCached) return pineconeCached;
  if (!hasLiveKeys() && !process.env.PINECONE_API_KEY) return null;

  const key = process.env.PINECONE_API_KEY;
  if (!key || String(key).includes('your-pinecone')) {
    return null;
  }

  const { Pinecone } = require('@pinecone-database/pinecone');
  pineconeCached = new Pinecone({ apiKey: key });
  return pineconeCached;
}

/**
 * Lấy bộ clients runtime cho chat/ingest.
 * Chat/extract dùng factory + fallback; embeddings theo DEFAULT_EMBEDDING_PROVIDER.
 */
async function getClients() {
  if (!hasLiveKeys()) return null;

  const pinecone = getPinecone();
  if (!pinecone) return null;

  const { result: chatModel, provider: chatProvider } = await withProviderFallback(
    'chat',
    async (provider) => getLLM(provider, { temperature: 0, streaming: true })
  );

  const { result: embeddings, provider: embeddingProvider } = await withProviderFallback(
    'embedding',
    async (provider) => getEmbeddings(provider)
  );

  return {
    chatModel,
    embeddings,
    pinecone,
    chatProvider,
    embeddingProvider,
    indexName: process.env.PINECONE_INDEX_NAME || 'van-ban-hanh-chinh',
    namespace: process.env.PINECONE_NAMESPACE || '',
  };
}

/**
 * LLM chuyên extract metadata (ưu tiên DEFAULT_EXTRACT_PROVIDER).
 */
async function getExtractLLM() {
  const { result, provider } = await withProviderFallback('extract', async (p) =>
    getLLM(p, { temperature: 0, streaming: false })
  );
  return { llm: result, provider };
}

module.exports = {
  getClients,
  getPinecone,
  getExtractLLM,
  hasLiveKeys,
  listAvailableProviders,
  getLLM,
  getEmbeddings,
  withProviderFallback,
};
