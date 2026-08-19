/**
 * POST /api/chat — Hệ thống văn bản thông minh HCC.
 * Body: { message, sessionId?, mode?: 'lookup'|'advise' }
 */

const express = require('express');
const { routeIntent, shouldSkipIntentLlm, heuristicIntent } = require('../services/intentRouter');
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
  ensureBrain,
} = require('../services/clients');
const { insertChatLog } = require('../services/supabase');
const {
  findRelevantScenarios,
  formatScenariosForPrompt,
} = require('../services/knowledgeStore');
const { getVoice } = require('../services/voiceConfig');
const { getTalk } = require('../services/voiceTalk');
const { shouldCompare } = require('../services/conflictBrief');
const { getRagConfig, publicRagPayload } = require('../services/ragConfig');
const { isFollowUpQuestion, remember, recall, mergeMatches } = require('../services/sessionSearchCache');
const { listenSseAbort } = require('../services/sseAbort');
const { publicErrorMessage } = require('../services/publicError');

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
  if (intent?.muc_dich === 'so_sanh') return 'compare';
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

async function streamWithFallback(question, matches, onToken, scenarioContext, qaMode, voice, opts = {}) {
  const temperature = Number(voice?.temperature) || 0;
  const spoken = Boolean(opts.spoken);
  const fastChat = Boolean(opts.fastChat);
  return withProviderFallback(
    'chat',
    async (provider) => {
      const llm = getLLM(provider, { temperature, streaming: true });
      let sent = 0;
      try {
        const result = await streamAnswer(
          question,
          matches,
          { llm, scenarioContext, mode: qaMode, voice, spoken },
          (token) => {
            sent += 1;
            onToken(token);
          }
        );
        return { ...result, provider };
      } catch (err) {
        if (sent) err.noFallback = true;
        throw err;
      }
    },
    fastChat ? { fastChat: true } : {}
  );
}

router.post('/', async (req, res) => {
  const message = String(req.body?.message || '').trim();
  const userSession = String(req.body?.sessionId || req.headers['x-session-id'] || 'anonymous');
  const uiMode = req.body?.mode === 'advise' ? 'advise' : 'lookup';
  const wantVoiceTalk = req.body?.voiceTalk === true;

  if (!message) {
    res.status(400).json({ error: 'Thiếu message' });
    return;
  }

  initSse(res);

  const aborted = listenSseAbort(res);
  const closed = () => aborted();

  try {
    await ensureBrain();
    if (!hasLiveKeys()) {
      await mockStream(res, message, userSession, uiMode);
      return;
    }

    const clients = await getClients();
    if (!clients) {
      await mockStream(res, message, userSession, uiMode);
      return;
    }

    const rag = await getRagConfig();
    const talk = await getTalk();
    const voiceRequested = wantVoiceTalk && talk.enabled;
    const fastChat = voiceRequested && talk.preferFastChat;
    const chatOpts = fastChat ? { fastChat: true } : {};

    sendEvent(res, 'meta', {
      status: 'Đang xác định lĩnh vực…',
      qaMode: uiMode,
      mode: 'live',
      voiceTalk: voiceRequested,
      disclaimer: publicRagPayload(rag).disclaimer,
    });

    let intent;
    const skipLlm = rag.skipIntentLlmWhenAnchored && shouldSkipIntentLlm(message, uiMode);
    try {
      if (skipLlm) {
        intent = heuristicIntent(message, uiMode);
        intent._provider = 'heuristic';
      } else {
        const routed = await withProviderFallback(
          'chat',
          async (provider) => {
            const llm = getLLM(provider, { temperature: 0, streaming: false });
            return routeIntent(message, { llm, useLlm: true, mode: uiMode });
          },
          chatOpts
        );
        intent = routed.result;
        intent._provider = routed.provider;
      }
    } catch {
      intent = await routeIntent(message, { useLlm: false, mode: uiMode });
    }
    if (rag.onlyActiveDefault === false) intent.onlyActive = false;

    let qaMode = resolveQaMode(uiMode, intent);
    if (closed()) return;

    sendEvent(res, 'meta', {
      status: 'Đang tìm văn bản còn hiệu lực…',
      intent,
      qaMode,
      mode: 'live',
    });

    const voice = await getVoice();

    let matches = [];
    if (intent.needs_retrieval !== false) {
      const prev = recall(userSession);
      const searchOpts = {
        embeddings: clients.embeddings,
        pinecone: clients.pinecone,
        indexName: clients.indexName,
        namespace: clients.namespace,
        topK: rag.topK,
        maxPerDoc: rag.maxPerDoc,
        maxTotal: rag.maxTotal,
      };
      matches = await hybridSearch(message, intent, searchOpts);
      if (prev && isFollowUpQuestion(message, prev.question) && prev.matches?.length) {
        matches = mergeMatches(prev.matches, matches, rag.maxTotal + rag.maxPerDoc);
      }
      remember(userSession, { question: message, matches });
    }

    if (qaMode === 'lookup' && shouldCompare(matches)) {
      qaMode = 'compare';
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
        if (closed()) return;
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
        if (!closed()) sendEvent(res, 'token', { token });
      },
      scenarioContext,
      qaMode,
      voice,
      { spoken: voiceRequested, fastChat }
    );

    await persistLog({
      userSession,
      question: message,
      sources: result.sources,
      answer: result.answer,
    });

    if (!closed()) {
      sendEvent(res, 'done', {
        answer: result.answer,
        sources: result.sources,
        intent,
        confidence: result.confidence || confidenceFromSources(result.sources),
        qaMode,
        mode: 'live',
        chatProvider: result.provider,
        voiceTalk: voiceRequested,
      });
      res.end();
    }
  } catch (err) {
    console.error('[chat]', err);
    if (!closed()) {
      sendEvent(res, 'error', { message: publicErrorMessage(err, 'Lỗi xử lý chat') });
      res.end();
    }
  }
});

module.exports = router;
