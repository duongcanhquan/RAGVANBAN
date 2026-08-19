/**
 * LLM Factory / Router — nhiều nhà cung cấp (OpenAI-compatible + Gemini).
 * Key/model lấy từ llmConfig (app_settings overlay .env). Auto-fallback khi lỗi.
 */

const {
  CHAT_PROVIDERS,
  EMBEDDING_PROVIDERS,
  getBrainSync,
  ensureBrain,
  providerCreds,
  pineconeCreds,
  GEMINI_CHAT_CURRENT,
  GEMINI_EMBED_CURRENT,
  normalizeGeminiChatModel,
  normalizeGeminiEmbedModel,
  geminiEmbedOutputDim,
} = require('./llmConfig');
const { createGeminiEmbeddings } = require('./geminiEmbeddings');
const { FAST_CHAT_ORDER } = require('./voiceTalk');
const { isAbortError } = require('./abortControl');

function hasProviderKey(provider) {
  return Boolean(providerCreds(provider).hasKey);
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

function isFallbackableError(err) {
  if (isAbortError(err)) return false;
  if (err?.code === 'EMBEDDING_DIM_MISMATCH') return true;
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
    msg.includes('resource_exhausted') ||
    msg.includes('free-models-per-day')
  );
}

function openAiHeaders(creds) {
  if (creds.id !== 'openrouter') return undefined;
  const referer = creds.siteUrl || process.env.CLIENT_ORIGIN || 'http://localhost:5173';
  return {
    'HTTP-Referer': String(referer).split(',')[0].trim(),
    'X-Title': creds.siteName || 'RAGVANBAN',
  };
}

function chatOpenAICompat(creds, { temperature, streaming, model }) {
  const { ChatOpenAI } = require('@langchain/openai');
  const opts = {
    apiKey: creds.apiKey,
    model: model || creds.chatModel,
    temperature,
    streaming,
  };
  const configuration = {};
  if (creds.baseUrl) configuration.baseURL = creds.baseUrl;
  const headers = openAiHeaders(creds);
  if (headers) configuration.defaultHeaders = headers;
  if (Object.keys(configuration).length) opts.configuration = configuration;
  return new ChatOpenAI(opts);
}

/**
 * @param {string} provider
 * @param {{ temperature?: number, streaming?: boolean, model?: string }} options
 */
function getLLM(provider, options = {}) {
  const p = normalizeProvider(provider);
  const temperature = options.temperature ?? 0;
  const streaming = options.streaming ?? true;
  const creds = providerCreds(p);

  if (!creds.hasKey) {
    throw new Error(`Thiếu API key cho ${creds.name || p}`);
  }
  if (creds.id === 'custom' && !creds.baseUrl) {
    throw new Error('Provider tùy chỉnh cần Base URL (…/v1)');
  }

  if (creds.kind === 'gemini') {
    const { ChatGoogleGenerativeAI } = require('@langchain/google-genai');
    return new ChatGoogleGenerativeAI({
      apiKey: creds.apiKey,
      model: normalizeGeminiChatModel(options.model || creds.chatModel || GEMINI_CHAT_CURRENT),
      temperature,
      streaming,
    });
  }

  return chatOpenAICompat(creds, {
    temperature,
    streaming,
    model: options.model,
  });
}

function getEmbeddings(provider) {
  const p = normalizeProvider(provider) || getBrainSync().embeddingPrimary || 'openai';
  const creds = providerCreds(p);

  if (!creds.supportsEmbed) {
    throw new Error(
      `${creds.name || p} không hỗ trợ Embedding. Dùng OpenAI, Gemini, OpenRouter hoặc Mistral.`
    );
  }
  if (!creds.hasKey) throw new Error(`Thiếu API key embedding cho ${creds.name || p}`);

  if (creds.kind === 'gemini') {
    return createGeminiEmbeddings({
      apiKey: creds.apiKey,
      model: normalizeGeminiEmbedModel(creds.embeddingModel || GEMINI_EMBED_CURRENT),
      outputDimensionality: geminiEmbedOutputDim(),
    });
  }

  const { OpenAIEmbeddings } = require('@langchain/openai');
  const opts = {
    apiKey: creds.apiKey,
    model: creds.embeddingModel || 'text-embedding-3-small',
  };
  const configuration = {};
  if (creds.baseUrl) configuration.baseURL = creds.baseUrl;
  const headers = openAiHeaders(creds);
  if (headers) configuration.defaultHeaders = headers;
  if (Object.keys(configuration).length) opts.configuration = configuration;
  return new OpenAIEmbeddings(opts);
}

function resolveProviderChain(primary, fallbackEnvOrList, allowed) {
  const primaryNorm = normalizeProvider(primary);
  const fallbacks = Array.isArray(fallbackEnvOrList)
    ? fallbackEnvOrList.map(normalizeProvider)
    : parseProviderList(fallbackEnvOrList, allowed.filter((x) => x !== primaryNorm));
  const ordered = [primaryNorm, ...fallbacks].filter((p, i, arr) => p && arr.indexOf(p) === i);
  return ordered.filter((p) => allowed.includes(p) && hasProviderKey(p));
}

function chainFor(purpose) {
  const brain = getBrainSync();
  if (purpose === 'embedding') {
    return resolveProviderChain(brain.embeddingPrimary, brain.embeddingFallback, EMBEDDING_PROVIDERS);
  }
  if (purpose === 'extract') {
    return resolveProviderChain(brain.extractPrimary, brain.extractFallback, CHAT_PROVIDERS);
  }
  return resolveProviderChain(brain.chatPrimary, brain.chatFallback, CHAT_PROVIDERS);
}

/** Groq / Gemini Flash trước — TTS cần token ra sớm. */
function preferFastChatChain() {
  const allowed = CHAT_PROVIDERS.filter(hasProviderKey);
  const fast = FAST_CHAT_ORDER.filter((p) => allowed.includes(p));
  const rest = allowed.filter((p) => !fast.includes(p));
  return [...fast, ...rest];
}

async function withProviderFallback(purpose, fn, options = {}) {
  await ensureBrain();
  let chain = options.chain
    ? options.chain.filter((p) => hasProviderKey(p))
    : options.fastChat
      ? preferFastChatChain()
      : options.primary
        ? resolveProviderChain(
            options.primary,
            purpose === 'embedding' ? getBrainSync().embeddingFallback : getBrainSync().chatFallback,
            purpose === 'embedding' ? EMBEDDING_PROVIDERS : CHAT_PROVIDERS
          )
        : chainFor(purpose);

  if (!chain.length) {
    throw new Error(
      `Không có provider nào sẵn sàng cho "${purpose}". Vào /quantri/bo-nao để dán API key.`
    );
  }

  let lastError;
  for (const provider of chain) {
    try {
      const result = await fn(provider);
      return { result, provider };
    } catch (err) {
      lastError = err;
      const hasMore = chain.indexOf(provider) < chain.length - 1;
      if (!shouldAttemptNextProvider(err, hasMore)) break;
      console.warn(
        `[llmFactory] ${purpose}/${provider} thất bại: ${err.message || err} → thử provider tiếp theo`
      );
    }
  }

  throw lastError || new Error(`Tất cả provider cho "${purpose}" đều thất bại`);
}

function shouldAttemptNextProvider(err, hasMoreProviders) {
  if (!err) return false;
  if (err.noFallback) return false;
  if (isAbortError(err)) return false;
  return isFallbackableError(err) || Boolean(hasMoreProviders);
}

function listAvailableProviders() {
  return {
    chat: CHAT_PROVIDERS.filter(hasProviderKey),
    embedding: EMBEDDING_PROVIDERS.filter(hasProviderKey),
    pinecone: pineconeCreds().hasKey,
  };
}

function liveKeysReport() {
  const providers = listAvailableProviders();
  const missing = [];
  if (!providers.chat.length) missing.push('chat');
  if (!providers.embedding.length) missing.push('embedding');
  if (!providers.pinecone) missing.push('pinecone');
  return { ready: missing.length === 0, missing, providers };
}

function hasLiveKeys() {
  return liveKeysReport().ready;
}

function brainNotReadyMessage(report = liveKeysReport()) {
  const hints = {
    chat: 'key chat (OpenAI / Gemini / OpenRouter / DeepSeek…)',
    embedding:
      'key embedding (OpenAI, Gemini hoặc OpenRouter — DeepSeek/Groq không embed được)',
    pinecone: 'Pinecone API key và tên index',
  };
  const missing = report?.missing?.length ? report.missing : ['chat', 'embedding', 'pinecone'];
  const detail = missing.map((k) => hints[k] || k).join('; ');
  return `Chưa đủ bộ não: thiếu ${detail}. Super-admin vào /quantri/bo-nao dán key rồi bấm Lưu.`;
}

module.exports = {
  getLLM,
  getEmbeddings,
  withProviderFallback,
  hasProviderKey,
  hasLiveKeys,
  liveKeysReport,
  brainNotReadyMessage,
  listAvailableProviders,
  isFallbackableError,
  shouldAttemptNextProvider,
  resolveProviderChain,
  preferFastChatChain,
  ensureBrain,
  CHAT_PROVIDERS,
  EMBEDDING_PROVIDERS,
};
