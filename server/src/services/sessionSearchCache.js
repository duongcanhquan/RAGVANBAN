/**
 * Cache đoạn truy xuất theo phiên — follow-up không search lại từ đầu.
 */

const { extractSoHieuList } = require('../ingestion/legalChunker');

const TTL_MS = 12 * 60 * 1000;
const store = new Map();

function isFollowUpQuestion(question, previousQuestion) {
  const s = String(question || '').trim();
  if (!s || !previousQuestion) return false;
  const newSo = extractSoHieuList(s);
  const prevSo = extractSoHieuList(previousQuestion).map((x) => x.toLowerCase());
  if (newSo.length && !newSo.some((n) => prevSo.includes(n.toLowerCase()))) {
    return false;
  }
  if (s.length <= 56 && /^(vậy|thế thì|thế còn|còn|khoản|điều đó|văn bản đó|như trên|và khoản|còn điều)\b/i.test(s)) {
    return true;
  }
  if (/^(khoản|điều)\s+\d+/i.test(s) && s.length < 90) return true;
  return false;
}

function remember(sessionId, payload) {
  const key = String(sessionId || '').trim();
  if (!key || key === 'anonymous') return;
  store.set(key, { ...payload, at: Date.now() });
  if (store.size > 400) {
    const oldest = store.keys().next().value;
    store.delete(oldest);
  }
}

function recall(sessionId) {
  const key = String(sessionId || '').trim();
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

module.exports = { isFollowUpQuestion, remember, recall, mergeMatches, invalidateSessionCache, TTL_MS };
