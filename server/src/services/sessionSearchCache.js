/**
 * Ngữ cảnh phiên chat + cache đoạn truy xuất.
 * Follow-up: giữ tình huống. History do client gửi (Vercel không giữ RAM giữa 2 request).
 */

const { extractSoHieuList } = require('../ingestion/legalChunker');

const TTL_MS = 12 * 60 * 1000;
const store = new Map();
const seqBySession = new Map();

function sessionKey(sessionId) {
  return String(sessionId || '').trim();
}

function beginSessionRequest(sessionId) {
  const key = sessionKey(sessionId);
  if (!key || key === 'anonymous') return 0;
  const n = (seqBySession.get(key) || 0) + 1;
  seqBySession.set(key, n);
  return n;
}

function normalizeConversationTurns(raw, { maxTurns = 12, userMax = 500, asstMax = 700 } = {}) {
  const out = [];
  for (const t of Array.isArray(raw) ? raw : []) {
    const role = t?.role === 'assistant' ? 'assistant' : t?.role === 'user' ? 'user' : '';
    if (!role) continue;
    const content = String(t.content || '')
      .replace(/\s+/g, ' ')
      .trim();
    if (!content) continue;
    const max = role === 'user' ? userMax : asstMax;
    out.push({
      role,
      content: content.length > max ? `${content.slice(0, max)}…` : content,
    });
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
  return /^(xin chào|chào|hello|hi|cảm ơn|thanks|ok|oke)\b/i.test(String(question || '').trim());
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
  return `${q}\nQuy định áp dụng, điều khoản, đối tượng, hồ sơ, trình tự, hình thức xử lý.`.slice(0, 800);
}

function expandSearchQuery(question, turns = [], previousQuestion = '') {
  const q = String(question || '').trim();
  const prev = String(previousQuestion || lastUserQuestion(turns) || '').trim();
  if (!prev || !isFollowUpQuestion(q, prev, turns)) return q;
  const users = turns.filter((t) => t.role === 'user').map((t) => t.content);
  if (!users.length && prev) users.push(prev);
  const unique = [...new Set([...users.slice(-2), q])].filter(Boolean);
  return unique.join('\n').slice(0, 800);
}

function formatConversationForPrompt(turns = []) {
  if (!turns.length) return '';
  const lines = turns.map((t) => {
    const who = t.role === 'user' ? 'Cán bộ' : 'AI';
    return `${who}: ${t.content}`;
  });
  return `Ngữ cảnh đoạn chat này (câu hiện tại tiếp nối các lượt trước — giữ tình huống, đối tượng, văn bản đang nói; không hỏi lại từ đầu):
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
  if (store.size > 400) {
    const oldest = store.keys().next().value;
    store.delete(oldest);
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

function invalidateSessionCache() {
  store.clear();
  seqBySession.clear();
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
  normalizeConversationTurns,
  lastUserQuestion,
  expandSearchQuery,
  expandAdviseQuery,
  formatConversationForPrompt,
  isGreeting,
  TTL_MS,
};
