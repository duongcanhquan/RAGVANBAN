/**
 * POST /api/chat — Hệ thống văn bản thông minh HCC.
 * Body: { message, sessionId?, mode?: 'lookup'|'advise' }
 */

const express = require('express');
const { routeIntent } = require('../services/intentRouter');
const { hybridSearch } = require('../services/hybridSearch');
const {
  streamAnswer,
  buildNoContextAnswer,
  confidenceFromSources,
} = require('../services/qaChain');
const {
  getClients,
  hasLiveKeys,
  listAvailableProviders,
  withProviderFallback,
  getLLM,
} = require('../services/clients');
const { insertChatLog } = require('../services/supabase');
const {
  findRelevantScenarios,
  formatScenariosForPrompt,
} = require('../services/knowledgeStore');

const router = express.Router();

function initSse(res) {
  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  if (typeof res.flushHeaders === 'function') res.flushHeaders();
}

function sendEvent(res, event, data) {
  res.write(`event: ${event}\n`);
  res.write(`data: ${JSON.stringify(data)}\n\n`);
}

function resolveQaMode(uiMode, intent) {
  if (uiMode === 'advise') return 'advise';
  if (intent?.muc_dich === 'tu_van') return 'advise';
  return 'lookup';
}

async function persistLog({ userSession, question, sources, answer }) {
  try {
    await insertChatLog({
      userSession,
      question,
      citationsUsed: sources || [],
      answer,
    });
  } catch (err) {
    console.warn('[chat] log skip:', err.message);
  }
}

async function mockStream(res, message, userSession, uiMode) {
  const intent = await routeIntent(message, { useLlm: false, mode: uiMode });
  const qaMode = resolveQaMode(uiMode, intent);
  const { answer, sources, confidence } = buildNoContextAnswer(qaMode);
  const demoNote =
    '\n\n_(Chế độ demo: chưa đủ API key Multi-LLM + Pinecone. Điền .env rồi ingest PDF để dùng thật.)_';
  const full = answer + demoNote;

  sendEvent(res, 'meta', {
    intent,
    sources: [],
    confidence,
    qaMode,
    mode: 'demo',
    providers: listAvailableProviders(),
    status: 'Đang phân tích (demo)…',
  });

  for (let i = 0; i < full.length; i += 48) {
    sendEvent(res, 'token', { token: full.slice(i, i + 48) });
  }
  await persistLog({ userSession, question: message, sources, answer: full });
  sendEvent(res, 'done', {
    answer: full,
    sources,
    intent,
    confidence,
    qaMode,
    mode: 'demo',
  });
  res.end();
}

async function streamWithFallback(question, matches, onToken, scenarioContext, qaMode) {
  return withProviderFallback('chat', async (provider) => {
    const llm = getLLM(provider, { temperature: 0, streaming: true });
    const result = await streamAnswer(
      question,
      matches,
      { llm, scenarioContext, mode: qaMode },
      onToken
    );
    return { ...result, provider };
  });
}

router.post('/', async (req, res) => {
  const message = String(req.body?.message || '').trim();
  const userSession = String(req.body?.sessionId || req.headers['x-session-id'] || 'anonymous');
  const uiMode = req.body?.mode === 'advise' ? 'advise' : 'lookup';

  if (!message) {
    res.status(400).json({ error: 'Thiếu message' });
    return;
  }

  initSse(res);

  let closed = false;
  req.on('close', () => {
    closed = true;
  });

  try {
    if (!hasLiveKeys()) {
      await mockStream(res, message, userSession, uiMode);
      return;
    }

    const clients = await getClients();
    if (!clients) {
      await mockStream(res, message, userSession, uiMode);
      return;
    }

    sendEvent(res, 'meta', {
      status: 'Đang xác định lĩnh vực…',
      qaMode: uiMode,
      mode: 'live',
    });

    let intent;
    try {
      const routed = await withProviderFallback('chat', async (provider) => {
        const llm = getLLM(provider, { temperature: 0, streaming: false });
        return routeIntent(message, { llm, useLlm: true, mode: uiMode });
      });
      intent = routed.result;
      intent._provider = routed.provider;
    } catch {
      intent = await routeIntent(message, { useLlm: false, mode: uiMode });
    }

    const qaMode = resolveQaMode(uiMode, intent);
    if (closed) return;

    sendEvent(res, 'meta', {
      status: 'Đang tìm văn bản còn hiệu lực…',
      intent,
      qaMode,
      mode: 'live',
    });

    let matches = [];
    if (intent.needs_retrieval !== false) {
      matches = await hybridSearch(message, intent, {
        embeddings: clients.embeddings,
        pinecone: clients.pinecone,
        indexName: clients.indexName,
        namespace: clients.namespace,
        topK: Number(process.env.RAG_TOP_K) || 6,
      });
    }

    const sourcesPreview = matches.map((m) => ({
      title: [m.loai_van_ban, m.so_hieu].filter(Boolean).join(' ') || m.ten_file,
      url: m.link_goc || m.url_file_goc,
      trang_thai: m.trang_thai,
      co_quan_ban_hanh: m.co_quan_ban_hanh,
    }));

    const relatedScenarios = await findRelevantScenarios(message, 2);
    const scenarioContext = formatScenariosForPrompt(relatedScenarios);
    const previewConfidence = confidenceFromSources(sourcesPreview);

    sendEvent(res, 'meta', {
      intent,
      sources: sourcesPreview,
      scenarios: relatedScenarios.map((s) => ({ id: s.id, title: s.title })),
      confidence: previewConfidence,
      qaMode,
      mode: 'live',
      status: matches.length
        ? `Đã tìm ${matches.length} đoạn · đang soạn trả lời…`
        : 'Không có đoạn phù hợp trong kho',
      chatProvider: clients.chatProvider,
      embeddingProvider: clients.embeddingProvider,
    });

    if (!matches.length) {
      const { answer, sources, confidence } = buildNoContextAnswer(qaMode);
      for (let i = 0; i < answer.length; i += 48) {
        if (closed) return;
        sendEvent(res, 'token', { token: answer.slice(i, i + 48) });
      }
      await persistLog({ userSession, question: message, sources, answer });
      sendEvent(res, 'done', {
        answer,
        sources,
        intent,
        confidence,
        qaMode,
        mode: 'live',
      });
      res.end();
      return;
    }

    const { result } = await streamWithFallback(
      message,
      matches,
      (token) => {
        if (!closed) sendEvent(res, 'token', { token });
      },
      scenarioContext,
      qaMode
    );

    await persistLog({
      userSession,
      question: message,
      sources: result.sources,
      answer: result.answer,
    });

    if (!closed) {
      sendEvent(res, 'done', {
        answer: result.answer,
        sources: result.sources,
        intent,
        confidence: result.confidence || confidenceFromSources(result.sources),
        qaMode,
        mode: 'live',
        chatProvider: result.provider,
      });
      res.end();
    }
  } catch (err) {
    console.error('[chat]', err);
    if (!closed) {
      sendEvent(res, 'error', { message: err.message || 'Lỗi xử lý chat' });
      res.end();
    }
  }
});

module.exports = router;
