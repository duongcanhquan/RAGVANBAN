/**
 * Shared clients — Pinecone + LLM/Embeddings qua llmFactory (Multi-LLM).
 */

const {
  getLLM,
  getEmbeddings,
  withProviderFallback,
  hasLiveKeys,
  liveKeysReport,
  brainNotReadyMessage,
  listAvailableProviders,
  ensureBrain,
} = require('./llmFactory');
const { pineconeCreds, providerCreds } = require('./llmConfig');
const { assertExpectedFitsIndex, getPineconeIndexDimension } = require('./embeddingDim');

let pineconeCached = null;
let pineconeKeyUsed = '';

function pineconeIndexTarget() {
  const pc = pineconeCreds();
  return {
    indexName: pc.indexName || 'van-ban-hanh-chinh',
    namespace: pc.namespace || '',
  };
}

function getPinecone() {
  const creds = pineconeCreds();
  if (!creds.hasKey) return null;
  if (pineconeCached && pineconeKeyUsed === creds.apiKey) return pineconeCached;

  const { Pinecone } = require('@pinecone-database/pinecone');
  pineconeCached = new Pinecone({ apiKey: creds.apiKey });
  pineconeKeyUsed = creds.apiKey;
  return pineconeCached;
}

/**
 * Lấy bộ clients runtime cho chat/ingest.
 * Chat/extract dùng factory + fallback; embeddings theo DEFAULT_EMBEDDING_PROVIDER.
 */
async function getClients() {
  await ensureBrain();
  if (!hasLiveKeys()) return null;

  const pinecone = getPinecone();
  if (!pinecone) return null;
  const pc = pineconeCreds();
  const indexDim = await getPineconeIndexDimension(pinecone, pc.indexName);

  const { result: chatModel, provider: chatProvider } = await withProviderFallback(
    'chat',
    async (provider) => getLLM(provider, { temperature: 0, streaming: true })
  );

  const { result: embeddings, provider: embeddingProvider } = await withProviderFallback(
    'embedding',
    async (provider) => {
      const creds = providerCreds(provider);
      assertExpectedFitsIndex({ model: creds.embeddingModel, indexDim });
      return getEmbeddings(provider);
    }
  );

  return {
    chatModel,
    embeddings,
    pinecone,
    chatProvider,
    embeddingProvider,
    indexName: pc.indexName || 'van-ban-hanh-chinh',
    namespace: pc.namespace || '',
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
  pineconeIndexTarget,
  getExtractLLM,
  hasLiveKeys,
  liveKeysReport,
  brainNotReadyMessage,
  listAvailableProviders,
  getLLM,
  getEmbeddings,
  withProviderFallback,
  ensureBrain,
};
