/**
 * Cấu hình "bộ não" Multi-LLM: catalog nhà cung cấp + merge .env với app_settings.
 * Key không bao giờ trả raw ra client (chỉ hasKey + 4 ký tự cuối).
 */

const { getSetting, setSetting, assertDurableSave } = require('./appSettings');

const BRAIN_KEY = 'llm_brain';
const KEEP = '__KEEP__';

function isPlaceholder(value, needle = '') {
  if (value == null || value === '') return true;
  const v = String(value).trim().toLowerCase();
  if (v === KEEP.toLowerCase() || v === '••••unchanged') return true;
  if (v.includes('your-') || v.includes('xxxxxxxx')) return true;
  if (needle && v === `your-${String(needle).toLowerCase()}-api-key`) return true;
  return false;
}

function envTrim(name) {
  return String(process.env[name] || '').trim();
}

const GEMINI_CHAT_CURRENT = 'gemini-3.6-flash';
const GEMINI_CHAT_RETIRED = new Set([
  'gemini-2.0-flash',
  'gemini-2.0-flash-001',
  'gemini-2.0-flash-lite',
  'gemini-2.0-flash-lite-001',
  'gemini-2.0-flash-exp',
  'gemini-2.0-flash-thinking-exp',
  'gemini-1.5-flash',
  'gemini-1.5-flash-latest',
  'gemini-1.5-flash-001',
  'gemini-1.5-pro',
  'gemini-1.5-pro-latest',
  'gemini-1.5-pro-001',
]);

function normalizeGeminiChatModel(model) {
  const raw = String(model || '')
    .trim()
    .replace(/^models\//i, '');
  if (!raw) return GEMINI_CHAT_CURRENT;
  if (GEMINI_CHAT_RETIRED.has(raw.toLowerCase())) return GEMINI_CHAT_CURRENT;
  return raw;
}

const GEMINI_EMBED_CURRENT = 'gemini-embedding-001';
/** Pin 768 — khớp chip Pinecone khuyến nghị; model gốc mặc định 3072. */
const GEMINI_EMBED_DIM_ALLOWED = new Set([768, 1536, 3072]);
const GEMINI_EMBED_RETIRED = new Set([
  'text-embedding-004',
  'embedding-001',
  'text-embedding-005',
  'textembedding-gecko',
  'textembedding-gecko-001',
  'textembedding-gecko@001',
]);

function normalizeGeminiEmbedModel(model) {
  const raw = String(model || '')
    .trim()
    .replace(/^models\//i, '');
  if (!raw) return GEMINI_EMBED_CURRENT;
  if (GEMINI_EMBED_RETIRED.has(raw.toLowerCase())) return GEMINI_EMBED_CURRENT;
  return raw;
}

function geminiEmbedOutputDim() {
  const n = Number(process.env.GEMINI_EMBEDDING_DIM);
  if (GEMINI_EMBED_DIM_ALLOWED.has(n)) return n;
  return 768;
}

/** Catalog — UI + factory dùng chung. kind: gemini | openai-compat */
const PROVIDER_CATALOG = [
  {
    id: 'openai',
    name: 'OpenAI (ChatGPT API)',
    kind: 'openai-compat',
    supportsChat: true,
    supportsEmbed: true,
    signup: 'https://platform.openai.com/api-keys',
    docs: 'https://platform.openai.com/docs/models',
    envKey: 'OPENAI_API_KEY',
    defaultChat: 'gpt-4o-mini',
    defaultEmbed: 'text-embedding-3-small',
    note: 'Cần API key trên platform.openai.com (có billing). Gói ChatGPT Plus/Team trên chat.openai.com không phải API.',
  },
  {
    id: 'gemini',
    name: 'Google Gemini',
    kind: 'gemini',
    supportsChat: true,
    supportsEmbed: true,
    signup: 'https://aistudio.google.com/apikey',
    docs: 'https://ai.google.dev/gemini-api/docs',
    envKey: 'GEMINI_API_KEY',
    defaultChat: 'gemini-3.6-flash',
    defaultEmbed: 'gemini-embedding-001',
    note: 'Key Google AI Studio. Chat: gemini-3.6-flash. Embedding: gemini-embedding-001 (text-embedding-004 đã gỡ), xuất 768 chiều — khớp chip Pinecone 768. Đổi model embed phải số hóa lại tài liệu.',
  },
  {
    id: 'deepseek',
    name: 'DeepSeek',
    kind: 'openai-compat',
    supportsChat: true,
    supportsEmbed: false,
    signup: 'https://platform.deepseek.com/api_keys',
    docs: 'https://api-docs.deepseek.com',
    envKey: 'DEEPSEEK_API_KEY',
    envBase: 'DEEPSEEK_BASE_URL',
    defaultBase: 'https://api.deepseek.com',
    defaultChat: 'deepseek-chat',
    note: 'API platform.deepseek.com. Ứng dụng chat DeepSeek không cấp API. Không có embedding — dùng OpenAI/Gemini/OpenRouter cho vector.',
  },
  {
    id: 'openrouter',
    name: 'OpenRouter',
    kind: 'openai-compat',
    supportsChat: true,
    supportsEmbed: true,
    signup: 'https://openrouter.ai/keys',
    docs: 'https://openrouter.ai/models',
    envKey: 'OPENROUTER_API_KEY',
    defaultBase: 'https://openrouter.ai/api/v1',
    defaultChat: 'google/gemma-3-27b-it:free',
    defaultEmbed: 'openai/text-embedding-3-small',
    note: 'Một key gọi được nhiều model (OpenAI, Gemini, Claude, Llama…). Model có hậu tố :free là tầng miễn phí — dễ hết quota, nên xếp fallback.',
    freeModels: [
      'google/gemma-3-27b-it:free',
      'meta-llama/llama-3.3-70b-instruct:free',
      'qwen/qwen3-4b:free',
      'mistralai/mistral-small-3.1-24b-instruct:free',
      'nvidia/llama-3.1-nemotron-70b-instruct:free',
    ],
  },
  {
    id: 'groq',
    name: 'Groq',
    kind: 'openai-compat',
    supportsChat: true,
    supportsEmbed: false,
    signup: 'https://console.groq.com/keys',
    docs: 'https://console.groq.com/docs/models',
    envKey: 'GROQ_API_KEY',
    defaultBase: 'https://api.groq.com/openai/v1',
    defaultChat: 'llama-3.3-70b-versatile',
    note: 'Rất nhanh, có free tier. Không embedding.',
  },
  {
    id: 'mistral',
    name: 'Mistral',
    kind: 'openai-compat',
    supportsChat: true,
    supportsEmbed: true,
    signup: 'https://console.mistral.ai/api-keys',
    docs: 'https://docs.mistral.ai',
    envKey: 'MISTRAL_API_KEY',
    defaultBase: 'https://api.mistral.ai/v1',
    defaultChat: 'mistral-small-latest',
    defaultEmbed: 'mistral-embed',
    note: 'Embedding mistral-embed = 1024 chiều. Khớp chip Pinecone 1024; không ghép OpenAI 1536 hay Gemini 768.',
  },
  {
    id: 'together',
    name: 'Together AI',
    kind: 'openai-compat',
    supportsChat: true,
    supportsEmbed: true,
    signup: 'https://api.together.xyz/settings/api-keys',
    docs: 'https://docs.together.ai',
    envKey: 'TOGETHER_API_KEY',
    defaultBase: 'https://api.together.xyz/v1',
    defaultChat: 'meta-llama/Llama-3.3-70B-Instruct-Turbo',
    defaultEmbed: 'togethercomputer/m2-bert-80M-8k-retrieval',
  },
  {
    id: 'fireworks',
    name: 'Fireworks',
    kind: 'openai-compat',
    supportsChat: true,
    supportsEmbed: false,
    signup: 'https://fireworks.ai/account/api-keys',
    docs: 'https://docs.fireworks.ai',
    envKey: 'FIREWORKS_API_KEY',
    defaultBase: 'https://api.fireworks.ai/inference/v1',
    defaultChat: 'accounts/fireworks/models/llama-v3p3-70b-instruct',
  },
  {
    id: 'xai',
    name: 'xAI (Grok)',
    kind: 'openai-compat',
    supportsChat: true,
    supportsEmbed: false,
    signup: 'https://console.x.ai',
    docs: 'https://docs.x.ai',
    envKey: 'XAI_API_KEY',
    defaultBase: 'https://api.x.ai/v1',
    defaultChat: 'grok-2-latest',
  },
  {
    id: 'custom',
    name: 'Tùy chỉnh (OpenAI-compatible)',
    kind: 'openai-compat',
    supportsChat: true,
    supportsEmbed: true,
    signup: '',
    docs: '',
    envKey: 'CUSTOM_LLM_API_KEY',
    envBase: 'CUSTOM_LLM_BASE_URL',
    defaultBase: '',
    defaultChat: '',
    defaultEmbed: '',
    note: 'LM Studio, vLLM, Azure OpenAI proxy, LiteLLM, LocalAI… Điền Base URL dạng …/v1.',
  },
];

const CHAT_PROVIDERS = PROVIDER_CATALOG.filter((p) => p.supportsChat).map((p) => p.id);
const EMBEDDING_PROVIDERS = PROVIDER_CATALOG.filter((p) => p.supportsEmbed).map((p) => p.id);

function catalogById(id) {
  return PROVIDER_CATALOG.find((p) => p.id === id) || null;
}

function hintKey(key) {
  const s = String(key || '').trim();
  if (s.length < 8) return s ? '••••' : '';
  return `${s.slice(0, 3)}…${s.slice(-4)}`;
}

function defaultProviderState(spec) {
  const envKey = spec.envKey ? envTrim(spec.envKey) : '';
  const envBase = spec.envBase ? envTrim(spec.envBase) : '';
  const idUpper = spec.id.toUpperCase();
  return {
    enabled: spec.id !== 'custom',
    apiKey: isPlaceholder(envKey, spec.id) ? '' : envKey,
    baseUrl: envBase || spec.defaultBase || '',
    chatModel: (() => {
      const picked =
        envTrim(`${idUpper}_CHAT_MODEL`) ||
        (spec.id === 'openai' ? envTrim('OPENAI_CHAT_MODEL') : '') ||
        (spec.id === 'gemini' ? envTrim('GEMINI_CHAT_MODEL') : '') ||
        (spec.id === 'deepseek' ? envTrim('DEEPSEEK_CHAT_MODEL') : '') ||
        spec.defaultChat ||
        '';
      return spec.id === 'gemini' ? normalizeGeminiChatModel(picked) : picked;
    })(),
    embeddingModel: (() => {
      const picked =
        envTrim(`${idUpper}_EMBEDDING_MODEL`) ||
        (spec.id === 'openai' ? envTrim('OPENAI_EMBEDDING_MODEL') : '') ||
        (spec.id === 'gemini' ? envTrim('GEMINI_EMBEDDING_MODEL') : '') ||
        spec.defaultEmbed ||
        '';
      return spec.id === 'gemini' ? normalizeGeminiEmbedModel(picked) : picked;
    })(),
    siteUrl: spec.id === 'openrouter' ? envTrim('OPENROUTER_SITE_URL') : '',
    siteName: spec.id === 'openrouter' ? envTrim('OPENROUTER_SITE_NAME') || 'RAGVANBAN' : '',
  };
}

function defaultsFromEnv() {
  const providers = {};
  for (const spec of PROVIDER_CATALOG) {
    providers[spec.id] = defaultProviderState(spec);
  }
  const pineconeKey = envTrim('PINECONE_API_KEY');
  return {
    chatPrimary: envTrim('DEFAULT_CHAT_PROVIDER') || 'deepseek',
    extractPrimary: envTrim('DEFAULT_EXTRACT_PROVIDER') || 'gemini',
    embeddingPrimary: envTrim('DEFAULT_EMBEDDING_PROVIDER') || 'openai',
    chatFallback: (envTrim('CHAT_FALLBACK_PROVIDERS') || 'deepseek,openai,gemini,openrouter,groq')
      .split(',')
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean),
    extractFallback: (envTrim('EXTRACT_FALLBACK_PROVIDERS') || 'gemini,deepseek,openai,openrouter')
      .split(',')
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean),
    embeddingFallback: (envTrim('EMBEDDING_FALLBACK_PROVIDERS') || 'openai,gemini,openrouter')
      .split(',')
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean),
    pinecone: {
      apiKey: isPlaceholder(pineconeKey, 'pinecone') ? '' : pineconeKey,
      indexName: envTrim('PINECONE_INDEX_NAME') || 'van-ban-hanh-chinh',
      namespace: envTrim('PINECONE_NAMESPACE') || '',
      environment: envTrim('PINECONE_ENVIRONMENT') || 'us-east-1',
    },
    providers,
  };
}

function mergeBrain(base, stored) {
  if (!stored || typeof stored !== 'object') return base;
  const out = {
    ...base,
    chatPrimary: stored.chatPrimary || base.chatPrimary,
    extractPrimary: stored.extractPrimary || base.extractPrimary,
    embeddingPrimary: stored.embeddingPrimary || base.embeddingPrimary,
    chatFallback: Array.isArray(stored.chatFallback) ? stored.chatFallback : base.chatFallback,
    extractFallback: Array.isArray(stored.extractFallback) ? stored.extractFallback : base.extractFallback,
    embeddingFallback: Array.isArray(stored.embeddingFallback)
      ? stored.embeddingFallback
      : base.embeddingFallback,
    pinecone: { ...base.pinecone, ...(stored.pinecone || {}) },
    providers: { ...base.providers },
  };
  if (stored.pinecone?.apiKey && isPlaceholder(stored.pinecone.apiKey, 'pinecone')) {
    out.pinecone.apiKey = base.pinecone.apiKey;
  }
  for (const spec of PROVIDER_CATALOG) {
    const prev = base.providers[spec.id] || defaultProviderState(spec);
    const patch = stored.providers?.[spec.id] || {};
    const apiKey =
      patch.apiKey && !isPlaceholder(patch.apiKey, spec.id) ? patch.apiKey : prev.apiKey;
    out.providers[spec.id] = {
      ...prev,
      ...patch,
      apiKey,
    };
    if (spec.id === 'gemini') {
      out.providers[spec.id].chatModel = normalizeGeminiChatModel(
        out.providers[spec.id].chatModel
      );
      out.providers[spec.id].embeddingModel = normalizeGeminiEmbedModel(
        out.providers[spec.id].embeddingModel
      );
    }
  }
  return out;
}

let cache = null;
let loading = null;
const BRAIN_TTL_MS = 30_000;

function getBrainSync() {
  return cache || defaultsFromEnv();
}

async function refreshBrain() {
  const stored = await getSetting(BRAIN_KEY);
  cache = mergeBrain(defaultsFromEnv(), stored);
  cache._fromDb = true;
  cache._loadedAt = Date.now();
  return cache;
}

async function ensureBrain() {
  if (cache?._fromDb && cache._loadedAt && Date.now() - cache._loadedAt < BRAIN_TTL_MS) {
    return cache;
  }
  if (!loading) {
    loading = refreshBrain().finally(() => {
      loading = null;
    });
  }
  return loading;
}

function providerCreds(id) {
  const spec = catalogById(id);
  if (!spec) return { id, enabled: false, hasKey: false };
  const brain = getBrainSync();
  const state = brain.providers?.[id] || defaultProviderState(spec);
  const apiKey = String(state.apiKey || '').trim();
  const enabled = state.enabled !== false;
  const hasKey = enabled && !isPlaceholder(apiKey, spec.id);
  const baseUrl = String(state.baseUrl || spec.defaultBase || '').replace(/\/$/, '');
  return {
    ...spec,
    enabled,
    hasKey,
    apiKey: hasKey ? apiKey : '',
    baseUrl,
    chatModel:
      spec.id === 'gemini'
        ? normalizeGeminiChatModel(state.chatModel || spec.defaultChat)
        : state.chatModel || spec.defaultChat || '',
    embeddingModel:
      spec.id === 'gemini'
        ? normalizeGeminiEmbedModel(state.embeddingModel || spec.defaultEmbed)
        : state.embeddingModel || spec.defaultEmbed || '',
    siteUrl: state.siteUrl || '',
    siteName: state.siteName || 'RAGVANBAN',
  };
}

function pineconeCreds() {
  const brain = getBrainSync();
  const p = brain.pinecone || {};
  const apiKey = String(p.apiKey || '').trim();
  return {
    hasKey: !isPlaceholder(apiKey, 'pinecone'),
    apiKey: isPlaceholder(apiKey, 'pinecone') ? '' : apiKey,
    indexName: p.indexName || 'van-ban-hanh-chinh',
    namespace: p.namespace || '',
    environment: p.environment || 'us-east-1',
  };
}

function sanitizeBrain(brain) {
  const providers = {};
  for (const spec of PROVIDER_CATALOG) {
    const st = brain.providers?.[spec.id] || {};
    const key = String(st.apiKey || '');
    const hasKey = !isPlaceholder(key, spec.id);
    providers[spec.id] = {
      enabled: st.enabled !== false,
      hasKey,
      apiKeyHint: hasKey ? hintKey(key) : '',
      baseUrl: st.baseUrl || spec.defaultBase || '',
      chatModel:
        spec.id === 'gemini'
          ? normalizeGeminiChatModel(st.chatModel || spec.defaultChat)
          : st.chatModel || spec.defaultChat || '',
      embeddingModel:
        spec.id === 'gemini'
          ? normalizeGeminiEmbedModel(st.embeddingModel || spec.defaultEmbed)
          : st.embeddingModel || spec.defaultEmbed || '',
      siteUrl: st.siteUrl || '',
      siteName: st.siteName || '',
    };
  }
  const pk = String(brain.pinecone?.apiKey || '');
  return {
    chatPrimary: brain.chatPrimary,
    extractPrimary: brain.extractPrimary,
    embeddingPrimary: brain.embeddingPrimary,
    chatFallback: brain.chatFallback,
    extractFallback: brain.extractFallback,
    embeddingFallback: brain.embeddingFallback,
    pinecone: {
      hasKey: !isPlaceholder(pk, 'pinecone'),
      apiKeyHint: isPlaceholder(pk, 'pinecone') ? '' : hintKey(pk),
      indexName: brain.pinecone?.indexName || 'van-ban-hanh-chinh',
      namespace: brain.pinecone?.namespace || '',
      environment: brain.pinecone?.environment || 'us-east-1',
    },
    providers,
  };
}

function applySavedKeys(incoming, previous) {
  const next = mergeBrain(defaultsFromEnv(), incoming);
  const prev = previous || defaultsFromEnv();
  for (const spec of PROVIDER_CATALOG) {
    const raw = incoming?.providers?.[spec.id]?.apiKey;
    if (raw == null || raw === '' || isPlaceholder(raw, spec.id)) {
      next.providers[spec.id].apiKey = prev.providers?.[spec.id]?.apiKey || '';
    } else if (String(raw).trim() === '-') {
      next.providers[spec.id].apiKey = '';
    } else {
      next.providers[spec.id].apiKey = String(raw).trim();
    }
  }
  const pRaw = incoming?.pinecone?.apiKey;
  if (pRaw == null || pRaw === '' || isPlaceholder(pRaw, 'pinecone')) {
    next.pinecone.apiKey = prev.pinecone?.apiKey || '';
  } else if (String(pRaw).trim() === '-') {
    next.pinecone.apiKey = '';
  } else {
    next.pinecone.apiKey = String(pRaw).trim();
  }
  return next;
}

async function saveBrain(incoming) {
  const previous = await refreshBrain();
  const next = applySavedKeys(incoming, previous);
  delete next._fromDb;
  const persisted = await setSetting(BRAIN_KEY, next);
  assertDurableSave(persisted, 'bộ não');
  cache = { ...next, _fromDb: true, _loadedAt: Date.now() };
  return cache;
}

function publicBrainPayload() {
  const brain = getBrainSync();
  const fromEnv = {};
  for (const spec of PROVIDER_CATALOG) {
    fromEnv[spec.id] = !isPlaceholder(spec.envKey ? envTrim(spec.envKey) : '', spec.id);
  }
  fromEnv.pinecone = !isPlaceholder(envTrim('PINECONE_API_KEY'), 'pinecone');
  return {
    catalog: PROVIDER_CATALOG.map(({ envKey, envBase, ...rest }) => rest),
    config: sanitizeBrain(brain),
    fromEnv,
  };
}

module.exports = {
  BRAIN_KEY,
  KEEP,
  PROVIDER_CATALOG,
  CHAT_PROVIDERS,
  EMBEDDING_PROVIDERS,
  isPlaceholder,
  catalogById,
  hintKey,
  defaultsFromEnv,
  mergeBrain,
  applySavedKeys,
  getBrainSync,
  refreshBrain,
  ensureBrain,
  providerCreds,
  pineconeCreds,
  sanitizeBrain,
  saveBrain,
  publicBrainPayload,
  normalizeGeminiChatModel,
  normalizeGeminiEmbedModel,
  geminiEmbedOutputDim,
  GEMINI_CHAT_CURRENT,
  GEMINI_EMBED_CURRENT,
};
