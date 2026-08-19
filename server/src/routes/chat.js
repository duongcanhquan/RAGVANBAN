/**
 * POST /api/chat — Hệ thống văn bản thông minh HCC.
 * Body: { message, sessionId?, mode?: 'lookup'|'advise' }
 */

const express = require('express');
const { routeIntent, shouldSkipIntentLlm, heuristicIntent, resolveQaMode } = require('../services/intentRouter');
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
const { matchSkillsForQuestion, formatSkillsForPrompt } = require('../services/skillStore');
const { getVoice, answerMaxTokens } = require('../services/voiceConfig');
const { getTalk } = require('../services/voiceTalk');
const { shouldCompare } = require('../services/conflictBrief');
const { getRagConfig, publicRagPayload } = require('../services/ragConfig');
const {
  isFollowUpQuestion,
  remember,
  recall,
  mergeMatches,
  beginSessionRequest,
  supersedeSessionWork,
  endSessionWork,
  normalizeConversationTurns,
  lastUserQuestion,
  expandSearchQuery,
  expandAdviseQuery,
  isGreeting,
} = require('../services/sessionSearchCache');
const { bindSseAbort } = require('../services/sseAbort');
const { throwIfAborted, isAbortError, defaultChatTimeoutMs, combineSignals } = require('../services/abortControl');
const { publicErrorMessage } = require('../services/publicError');
const { resolveCategoryScope, applyScopeToIntent, scopeKey } = require('../services/categoryScope');
const { checkChatRate, acquireChatSlot } = require('../services/chatGate');

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
  const signal = opts.signal;
  return withProviderFallback(
    'chat',
    async (provider) => {
      throwIfAborted(signal);
      const llm = getLLM(provider, {
        temperature,
        streaming: true,
        maxTokens: answerMaxTokens(voice, { mode: qaMode, spoken }),
      });
      let sent = 0;
      try {
        const result = await streamAnswer(
          question,
          matches,
          {
            llm,
            scenarioContext,
            skillContext: opts.skillContext || '',
            mode: qaMode,
            voice,
            spoken,
            signal,
            conversationTurns: opts.conversationTurns || [],
          },
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

  const limited = checkChatRate(req);
  if (limited) {
    res.status(429).json({ error: limited });
    return;
  }

  initSse(res);

  const { signal, aborted, dispose } = bindSseAbort(res, {
    timeoutMs: defaultChatTimeoutMs(),
  });
  const closed = () => aborted();
  let slot = null;
  let sessionAc = null;
  let workSignal = signal;

  try {
    if (isGreeting(message)) {
      const answer =
        uiMode === 'advise'
          ? 'Chào bạn. Mô tả ngắn tình huống cần tư vấn (đối tượng, việc đang hỏi).'
          : 'Chào bạn. Hãy nêu số hiệu, điều khoản cần tra, hoặc mô tả ngắn tình huống.';
      sendEvent(res, 'meta', {
        status: 'Sẵn sàng',
        qaMode: uiMode,
        mode: 'live',
        voiceTalk: false,
      });
      for (let i = 0; i < answer.length; i += 48) {
        throwIfAborted(signal);
        sendEvent(res, 'token', { token: answer.slice(i, i + 48) });
      }
      sendEvent(res, 'done', {
        answer,
        sources: [],
        intent: { needs_retrieval: false, muc_dich: uiMode === 'advise' ? 'tu_van' : 'tra_cuu' },
        confidence: confidenceFromSources([]),
        qaMode: uiMode,
        mode: 'live',
      });
      res.end();
      return;
    }

    slot = await acquireChatSlot(signal);
    sessionAc = supersedeSessionWork(userSession);
    workSignal = combineSignals(signal, sessionAc?.signal) || signal;

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

    const conversationTurns = normalizeConversationTurns(req.body?.history);
    const prevTurnQuestion = lastUserQuestion(conversationTurns) || recall(userSession)?.question || '';
    const followUp = isFollowUpQuestion(message, prevTurnQuestion, conversationTurns);
    let searchQuery = followUp
      ? expandSearchQuery(message, conversationTurns, prevTurnQuestion)
      : message;
    const heur = heuristicIntent(message, uiMode);
    if (uiMode === 'advise' || heur.muc_dich === 'tu_van') searchQuery = expandAdviseQuery(searchQuery);

    sendEvent(res, 'meta', {
      status: followUp ? 'Đang hỏi tiếp trong cùng tình huống…' : 'Đang xác định lĩnh vực…',
      qaMode: uiMode,
      mode: 'live',
      voiceTalk: voiceRequested,
      disclaimer: publicRagPayload(rag).disclaimer,
    });

    let intent;
    const skipLlm =
      (rag.skipIntentLlmWhenAnchored && shouldSkipIntentLlm(message, uiMode)) || followUp;
    try {
      if (skipLlm) {
        intent = heur;
        intent._provider = 'heuristic';
      } else {
        const routed = await withProviderFallback(
          'chat',
          async (provider) => {
            throwIfAborted(workSignal);
            const llm = getLLM(provider, { temperature: 0, streaming: false });
            return routeIntent(message, { llm, useLlm: true, mode: uiMode, signal: workSignal });
          },
          chatOpts
        );
        intent = routed.result;
        intent._provider = routed.provider;
      }
    } catch (err) {
      if (isAbortError(err)) throw err;
      intent = await routeIntent(message, { useLlm: false, mode: uiMode });
    }
    if (rag.onlyActiveDefault === false) intent.onlyActive = false;
    if (uiMode === 'advise') {
      intent.muc_dich = 'tu_van';
      intent.skipLinhVucFilter = true;
    }
    const scope = await resolveCategoryScope(req.body?.categoryIds).catch((err) => {
      console.warn('[chat] category scope:', err.message);
      return null;
    });
    if (scope) applyScopeToIntent(intent, scope);
    intent.needs_retrieval = true;

    let qaMode = resolveQaMode(uiMode, intent);
    throwIfAborted(workSignal);

    sendEvent(res, 'meta', {
      status: scope?.labels?.length
        ? `Đang tìm trong: ${scope.labels.join(', ')}…`
        : 'Đang tìm văn bản còn hiệu lực…',
      intent,
      qaMode,
      mode: 'live',
      scopeLabels: scope?.labels || [],
    });

    const voice = await getVoice();

    let matches = [];
    if (intent.needs_retrieval !== false) {
      const seq = beginSessionRequest(userSession);
      const prev = recall(userSession);
      const searchOpts = {
        embeddings: clients.embeddings,
        pinecone: clients.pinecone,
        indexName: clients.indexName,
        namespace: clients.namespace,
        topK: rag.topK,
        maxPerDoc: rag.maxPerDoc,
        maxTotal: rag.maxTotal,
        signal: workSignal,
      };
      matches = await hybridSearch(searchQuery, intent, searchOpts);
      throwIfAborted(workSignal);
      const thisScope = scopeKey(intent);
      if (followUp && prev?.matches?.length && prev.scopeKey === thisScope) {
        matches = mergeMatches(prev.matches, matches, rag.maxTotal + rag.maxPerDoc);
      }
      remember(userSession, { question: message, matches, searchQuery, scopeKey: thisScope }, seq);
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

    throwIfAborted(workSignal);
    const matchedSkills = matches.length ? await matchSkillsForQuestion(message) : [];
    const skillContext = formatSkillsForPrompt(matchedSkills);
    const previewConfidence = confidenceFromSources(sourcesPreview);

    throwIfAborted(workSignal);
    sendEvent(res, 'meta', {
      intent,
      sources: sourcesPreview,
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
      const { answer, sources, confidence } = buildNoContextAnswer(qaMode, {
        scopeLabels: scope?.labels || intent.scopeLabels,
      });
      for (let i = 0; i < answer.length; i += 48) {
        throwIfAborted(workSignal);
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
      '',
      qaMode,
      voice,
      {
        spoken: voiceRequested,
        fastChat,
        signal: workSignal,
        skillContext,
        conversationTurns,
      }
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
    if (isAbortError(err)) {
      if (!res.writableEnded && err.abortKind === 'timeout') {
        sendEvent(res, 'error', { message: 'Hết thời gian chờ. Thử hỏi lại.' });
        res.end();
      }
      return;
    }
    console.error('[chat]', err);
    if (!closed()) {
      sendEvent(res, 'error', { message: publicErrorMessage(err, 'Lỗi xử lý chat') });
      res.end();
    }
  } finally {
    endSessionWork(userSession, sessionAc);
    if (slot) slot.release();
    dispose();
  }
});

module.exports = router;
