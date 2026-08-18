/**
 * LLM Factory / Router — OpenAI + DeepSeek (OpenAI-compatible) + Gemini.
 * Hỗ trợ khởi tạo dynamic + Auto-Fallback khi lỗi API / rate limit.
 */

const CHAT_PROVIDERS = ['openai', 'deepseek', 'gemini'];
const EMBEDDING_PROVIDERS = ['openai', 'gemini']; // DeepSeek không cung cấp embedding API chuẩn

function isPlaceholder(value, needle) {
  if (!value) return true;
  const v = String(value).toLowerCase();
  return v.includes('your-') || v.includes(needle);
}

function hasProviderKey(provider) {
  switch (normalizeProvider(provider)) {
    case 'openai':
      return !isPlaceholder(process.env.OPENAI_API_KEY, 'openai');
    case 'deepseek':
      return !isPlaceholder(process.env.DEEPSEEK_API_KEY, 'deepseek');
    case 'gemini':
      return !isPlaceholder(process.env.GEMINI_API_KEY, 'gemini');
    default:
      return false;
  }
}

function normalizeProvider(provider) {
  return String(provider || '')
    .trim()
    .toLowerCase();
}

function parseProviderList(envValue, fallbackList) {
  if (!envValue) return [...fallbackList];
  return String(envValue)
    .split(',')
    .map((s) => normalizeProvider(s))
    .filter(Boolean);
}

/**
 * Lỗi có thể retry / fallback (rate limit, 5xx, timeout, auth tạm).
 */
function isFallbackableError(err) {
  const msg = String(err?.message || err || '').toLowerCase();
  const status = err?.status || err?.response?.status || err?.statusCode;
  if (status === 429 || status === 500 || status === 502 || status === 503 || status === 504) {
    return true;
  }
  return (
    msg.includes('rate limit') ||
    msg.includes('429') ||
    msg.includes('timeout') ||
    msg.includes('econnreset') ||
    msg.includes('fetch failed') ||
    msg.includes('overloaded') ||
    msg.includes('unavailable') ||
    msg.includes('quota') ||
    msg.includes('resource_exhausted')
  );
}

/**
 * Khởi tạo Chat model theo provider.
 * @param {'openai'|'deepseek'|'gemini'} provider
 * @param {{ temperature?: number, streaming?: boolean, model?: string }} options
 */
function getLLM(provider, options = {}) {
  const p = normalizeProvider(provider);
  const temperature = options.temperature ?? 0;
  const streaming = options.streaming ?? true;

  if (p === 'openai') {
    if (!hasProviderKey('openai')) {
      throw new Error('Thiếu OPENAI_API_KEY');
    }
    const { ChatOpenAI } = require('@langchain/openai');
    return new ChatOpenAI({
      apiKey: process.env.OPENAI_API_KEY,
      model: options.model || process.env.OPENAI_CHAT_MODEL || 'gpt-4o-mini',
      temperature,
      streaming,
    });
  }

  if (p === 'deepseek') {
    if (!hasProviderKey('deepseek')) {
      throw new Error('Thiếu DEEPSEEK_API_KEY');
    }
    const { ChatOpenAI } = require('@langchain/openai');
    const baseURL = process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com';
    return new ChatOpenAI({
      apiKey: process.env.DEEPSEEK_API_KEY,
      model: options.model || process.env.DEEPSEEK_CHAT_MODEL || 'deepseek-chat',
      temperature,
      streaming,
      configuration: { baseURL },
    });
  }

  if (p === 'gemini') {
    if (!hasProviderKey('gemini')) {
      throw new Error('Thiếu GEMINI_API_KEY');
    }
    const { ChatGoogleGenerativeAI } = require('@langchain/google-genai');
    return new ChatGoogleGenerativeAI({
      apiKey: process.env.GEMINI_API_KEY,
      model: options.model || process.env.GEMINI_CHAT_MODEL || 'gemini-2.0-flash',
      temperature,
      streaming,
    });
  }

  throw new Error(`getLLM: provider không hỗ trợ "${provider}"`);
}

/**
 * Embedding model — openai | gemini.
 * @param {'openai'|'gemini'} provider
 */
function getEmbeddings(provider) {
  const p = normalizeProvider(provider) || process.env.DEFAULT_EMBEDDING_PROVIDER || 'openai';

  if (p === 'deepseek') {
    throw new Error(
      'DeepSeek không hỗ trợ Embedding API. Dùng DEFAULT_EMBEDDING_PROVIDER=openai|gemini'
    );
  }

  if (p === 'openai') {
    if (!hasProviderKey('openai')) throw new Error('Thiếu OPENAI_API_KEY cho embeddings');
    const { OpenAIEmbeddings } = require('@langchain/openai');
    return new OpenAIEmbeddings({
      apiKey: process.env.OPENAI_API_KEY,
      model: process.env.OPENAI_EMBEDDING_MODEL || 'text-embedding-3-small',
    });
  }

  if (p === 'gemini') {
    if (!hasProviderKey('gemini')) throw new Error('Thiếu GEMINI_API_KEY cho embeddings');
    const { GoogleGenerativeAIEmbeddings } = require('@langchain/google-genai');
    return new GoogleGenerativeAIEmbeddings({
      apiKey: process.env.GEMINI_API_KEY,
      model: process.env.GEMINI_EMBEDDING_MODEL || 'text-embedding-004',
    });
  }

  throw new Error(`getEmbeddings: provider không hỗ trợ "${provider}"`);
}

/**
 * Thứ tự provider: primary + fallbacks, bỏ provider không có key / trùng.
 */
function resolveProviderChain(primary, fallbackEnv, allowed) {
  const primaryNorm = normalizeProvider(primary);
  const fallbacks = parseProviderList(fallbackEnv, allowed.filter((x) => x !== primaryNorm));
  const ordered = [primaryNorm, ...fallbacks].filter((p, i, arr) => p && arr.indexOf(p) === i);
  return ordered.filter((p) => allowed.includes(p) && hasProviderKey(p));
}

/**
 * Chạy fn(provider) với auto-fallback.
 * @template T
 * @param {'chat'|'extract'|'embedding'} purpose
 * @param {(provider: string) => Promise<T>} fn
 * @param {{ primary?: string }} options
 * @returns {Promise<{ result: T, provider: string }>}
 */
async function withProviderFallback(purpose, fn, options = {}) {
  let chain = [];

  if (purpose === 'embedding') {
    chain = resolveProviderChain(
      options.primary || process.env.DEFAULT_EMBEDDING_PROVIDER || 'openai',
      process.env.EMBEDDING_FALLBACK_PROVIDERS,
      EMBEDDING_PROVIDERS
    );
  } else if (purpose === 'extract') {
    chain = resolveProviderChain(
      options.primary || process.env.DEFAULT_EXTRACT_PROVIDER || 'gemini',
      process.env.EXTRACT_FALLBACK_PROVIDERS,
      CHAT_PROVIDERS
    );
  } else {
    chain = resolveProviderChain(
      options.primary || process.env.DEFAULT_CHAT_PROVIDER || 'deepseek',
      process.env.CHAT_FALLBACK_PROVIDERS,
      CHAT_PROVIDERS
    );
  }

  if (!chain.length) {
    throw new Error(
      `Không có provider nào sẵn sàng cho "${purpose}". Kiểm tra API keys trong .env`
    );
  }

  let lastError;
  for (const provider of chain) {
    try {
      const result = await fn(provider);
      return { result, provider };
    } catch (err) {
      lastError = err;
      const canFallback = isFallbackableError(err) || chain.indexOf(provider) < chain.length - 1;
      console.warn(
        `[llmFactory] ${purpose}/${provider} thất bại: ${err.message || err}` +
          (canFallback ? ' → thử provider tiếp theo' : '')
      );
      if (!canFallback) break;
    }
  }

  throw lastError || new Error(`Tất cả provider cho "${purpose}" đều thất bại`);
}

/**
 * Có ít nhất 1 chat provider + Pinecone + 1 embedding provider.
 */
function hasLiveKeys() {
  const pineconeOk = !isPlaceholder(process.env.PINECONE_API_KEY, 'pinecone');
  const chatOk = CHAT_PROVIDERS.some((p) => hasProviderKey(p));
  const embedOk = EMBEDDING_PROVIDERS.some((p) => hasProviderKey(p));
  return pineconeOk && chatOk && embedOk;
}

function listAvailableProviders() {
  return {
    chat: CHAT_PROVIDERS.filter(hasProviderKey),
    embedding: EMBEDDING_PROVIDERS.filter(hasProviderKey),
    pinecone: !isPlaceholder(process.env.PINECONE_API_KEY, 'pinecone'),
  };
}

module.exports = {
  getLLM,
  getEmbeddings,
  withProviderFallback,
  hasProviderKey,
  hasLiveKeys,
  listAvailableProviders,
  isFallbackableError,
  resolveProviderChain,
  CHAT_PROVIDERS,
  EMBEDDING_PROVIDERS,
};
