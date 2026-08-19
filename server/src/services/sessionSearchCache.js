/**
 * Ngữ cảnh phiên chat + cache đoạn truy xuất.
 * Follow-up: giữ tình huống. History do client gửi (Vercel không giữ RAM giữa 2 request).
 */

const { extractSoHieuList } = require('../ingestion/legalChunker');
const { abortError } = require('./abortControl');

const TTL_MS = 12 * 60 * 1000;
const STORE_MAX = 400;
const store = new Map();
const embedStore = new Map();
const seqBySession = new Map();
const abortBySession = new Map();

function sessionKey(sessionId) {
  return String(sessionId || '').trim();
}

function evictSession(key) {
  store.delete(key);
  seqBySession.delete(key);
  const ac = abortBySession.get(key);
  if (ac) {
    abortBySession.delete(key);
    if (!ac.signal.aborted) {
      try {
        ac.abort(abortError('client'));
      } catch {
        /* ignore */
      }
    }
  }
}

function beginSessionRequest(sessionId) {
  const key = sessionKey(sessionId);
  if (!key || key === 'anonymous') return 0;
  const n = (seqBySession.get(key) || 0) + 1;
  seqBySession.set(key, n);
  if (seqBySession.size > STORE_MAX + 50) {
    const oldest = seqBySession.keys().next().value;
    if (oldest && !store.has(oldest)) seqBySession.delete(oldest);
  }
  return n;
}

function supersedeSessionWork(sessionId) {
  const key = sessionKey(sessionId);
  if (!key || key === 'anonymous') return null;
  const prev = abortBySession.get(key);
  if (prev && !prev.signal.aborted) {
    try {
      prev.abort(abortError('client'));
    } catch {
      /* ignore */
    }
  }
  const ac = new AbortController();
  abortBySession.set(key, ac);
  return ac;
}

function endSessionWork(sessionId, ac) {
  const key = sessionKey(sessionId);
  if (!key || !ac) return;
  if (abortBySession.get(key) === ac) abortBySession.delete(key);
}

function compactTurnContent(role, content, max) {
  let s = String(content || '')
    .replace(/\s+/g, ' ')
    .trim();
  if (role === 'assistant') {
    s = s
      .replace(/\s*(?:\*\*)?Nguồn:(?:\*\*)?[\s\S]*$/i, '')
      .replace(/\s*\*\*Kiểm chứng:\*\*[\s\S]*$/i, '')
      .trim();
  }
  if (!s) return '';
  return s.length > max ? `${s.slice(0, max)}…` : s;
}

function normalizeConversationTurns(raw, { maxTurns = 6, userMax = 320, asstMax = 220 } = {}) {
  const out = [];
  for (const t of Array.isArray(raw) ? raw : []) {
    const role = t?.role === 'assistant' ? 'assistant' : t?.role === 'user' ? 'user' : '';
    if (!role) continue;
    const content = compactTurnContent(role, t.content, role === 'user' ? userMax : asstMax);
    if (!content) continue;
    out.push({ role, content });
  }
  return out.slice(-maxTurns);
}

function lastUserQuestion(turns = []) {
  for (let i = turns.length - 1; i >= 0; i -= 1) {
    if (turns[i].role === 'user' && turns[i].content) return turns[i].content;
  }
  return '';
}

function isGreeting(question) {
  return /^(xin chào|chào bạn|chào|hello|hi|cảm ơn|thanks|ok|oke)[\s!.]*$/i.test(
    String(question || '').trim()
  );
}

function isFollowUpQuestion(question, previousQuestion, turns = []) {
  const s = String(question || '').trim();
  const prev = String(previousQuestion || lastUserQuestion(turns) || '').trim();
  if (!s || !prev) return false;
  if (isGreeting(s)) return false;

  const newSo = extractSoHieuList(s);
  const prevSo = extractSoHieuList(prev).map((x) => x.toLowerCase());
  if (newSo.length && !newSo.some((n) => prevSo.includes(n.toLowerCase()))) {
    return false;
  }

  if (s.length <= 72 && /^(vậy|thế thì|thế còn|thế|còn|khoản|điều đó|văn bản đó|như trên|và khoản|còn điều)\b/i.test(s)) {
    return true;
  }
  if (/^(khoản|điều)\s+\d+/i.test(s) && s.length < 90) return true;
  if (
    /\b(vậy|thế thì|như trên|trường hợp này|trường hợp đó|đối tượng đó|văn bản đó|điều đó|cụ thể|giải thích thêm|giải thích rõ|còn về|còn lại|nếu tôi|nếu mình|áp dụng cho|hỏi sâu|chi tiết hơn|thời hạn đó|hồ sơ đó|giấy tờ nào)\b/i.test(
      s
    )
  ) {
    return true;
  }
  if (prevSo.length && !newSo.length && s.length < 180) return true;
  if (s.length <= 36 && !newSo.length && /[?？]$/.test(s)) return true;
  return false;
}

function expandAdviseQuery(question) {
  const q = String(question || '').trim();
  if (!q) return q;
  if (q.length > 220 && /quy định|điều khoản|áp dụng/i.test(q)) return q;
  return `${q}\nQuy định áp dụng, điều khoản, đối tượng, hồ sơ, trình tự.`.slice(0, 480);
}

function expandSearchQuery(question, turns = [], previousQuestion = '') {
  const q = String(question || '').trim();
  const prev = String(previousQuestion || lastUserQuestion(turns) || '').trim();
  if (!prev || !isFollowUpQuestion(q, prev, turns)) return q;
  const users = turns.filter((t) => t.role === 'user').map((t) => t.content);
  if (!users.length && prev) users.push(prev);
  const unique = [...new Set([...users.slice(-2), q])].filter(Boolean);
  return unique.join('\n').slice(0, 480);
}

function formatConversationForPrompt(turns = []) {
  if (!turns.length) return '';
  const lines = turns.map((t) => {
    const who = t.role === 'user' ? 'Người hỏi' : 'AI';
    return `${who}: ${t.content}`;
  });
  return `Ngữ cảnh đoạn chat (giữ tình huống; câu hiện tại là trọng tâm):
${lines.join('\n')}`;
}

function remember(sessionId, payload, seq) {
  const key = sessionKey(sessionId);
  if (!key || key === 'anonymous') return false;
  if (seq != null) {
    const latest = seqBySession.get(key) || 0;
    if (Number(seq) !== latest) return false;
  }
  store.set(key, {
    ...payload,
    at: Date.now(),
    seq: seq != null ? Number(seq) : undefined,
  });
  if (store.size > STORE_MAX) {
    let oldestKey = null;
    let oldestAt = Infinity;
    for (const [k, row] of store) {
      const at = Number(row?.at) || 0;
      if (at < oldestAt) {
        oldestAt = at;
        oldestKey = k;
      }
    }
    if (oldestKey && oldestKey !== key) evictSession(oldestKey);
  }
  return true;
}

function recall(sessionId) {
  const key = sessionKey(sessionId);
  if (!key || key === 'anonymous') return null;
  const row = store.get(key);
  if (!row) return null;
  if (Date.now() - row.at > TTL_MS) {
    store.delete(key);
    return null;
  }
  return row;
}

function embedCacheKey(scopeKey, query) {
  const sk = String(scopeKey || 'all').trim() || 'all';
  const q = String(query || '')
    .trim()
    .slice(0, 480);
  return `${sk}::${q}`;
}

function rememberEmbed(scopeKey, query, vector) {
  const key = embedCacheKey(scopeKey, query);
  if (!vector?.length) return false;
  embedStore.set(key, { vector, at: Date.now() });
  if (embedStore.size > STORE_MAX) {
    let oldestKey = null;
    let oldestAt = Infinity;
    for (const [k, row] of embedStore) {
      const at = Number(row?.at) || 0;
      if (at < oldestAt) {
        oldestAt = at;
        oldestKey = k;
      }
    }
    if (oldestKey) embedStore.delete(oldestKey);
  }
  return true;
}

function recallEmbed(scopeKey, query) {
  const key = embedCacheKey(scopeKey, query);
  const row = embedStore.get(key);
  if (!row) return null;
  if (Date.now() - row.at > TTL_MS) {
    embedStore.delete(key);
    return null;
  }
  return row.vector;
}

function invalidateSessionCache() {
  store.clear();
  embedStore.clear();
  seqBySession.clear();
  for (const ac of abortBySession.values()) {
    if (!ac.signal.aborted) {
      try {
        ac.abort(abortError('client'));
      } catch {
        /* ignore */
      }
    }
  }
  abortBySession.clear();
}

function mergeMatches(prev, next, max = 16) {
  const out = [];
  const seen = new Set();
  for (const m of [...(next || []), ...(prev || [])]) {
    const id = m?.id || `${m?.so_hieu || ''}:${m?.dieu || ''}:${(m?.text || '').slice(0, 40)}`;
    if (seen.has(id)) continue;
    seen.add(id);
    out.push(m);
    if (out.length >= max) break;
  }
  return out;
}

module.exports = {
  isFollowUpQuestion,
  remember,
  recall,
  mergeMatches,
  invalidateSessionCache,
  beginSessionRequest,
  supersedeSessionWork,
  endSessionWork,
  normalizeConversationTurns,
  lastUserQuestion,
  expandSearchQuery,
  expandAdviseQuery,
  formatConversationForPrompt,
  isGreeting,
  rememberEmbed,
  recallEmbed,
  embedCacheKey,
  TTL_MS,
};
