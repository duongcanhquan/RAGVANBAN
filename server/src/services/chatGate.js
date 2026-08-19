/**
 * Giới hạn tốc độ + số chat chạy song song — tránh nổ quota LLM/Pinecone khi nhiều người hỏi cùng lúc.
 */

const WINDOW_MS = 60_000;
const MAX_PER_IP = clampInt(process.env.CHAT_RATE_PER_IP, 8, 80, 24);
const MAX_PER_SESSION = clampInt(process.env.CHAT_RATE_PER_SESSION, 4, 40, 16);
const MAX_CONCURRENT = clampInt(process.env.CHAT_MAX_CONCURRENT, 2, 40, 12);
const WAIT_MS = clampInt(process.env.CHAT_SLOT_WAIT_MS, 1000, 30_000, 12_000);

const ipHits = new Map();
const sessionHits = new Map();
let inFlight = 0;
const waiters = [];

function clampInt(n, min, max, fallback) {
  const t = Number(n);
  if (!Number.isFinite(t)) return fallback;
  return Math.min(max, Math.max(min, Math.round(t)));
}

function prune(map, maxKeys = 2500) {
  const now = Date.now();
  for (const [key, row] of map) {
    if (!row || now >= row.reset) map.delete(key);
  }
  while (map.size > maxKeys) {
    map.delete(map.keys().next().value);
  }
}

function hit(map, key, max) {
  const id = String(key || '').trim().slice(0, 120);
  if (!id) return true;
  const now = Date.now();
  let row = map.get(id);
  if (!row || now >= row.reset) row = { n: 0, reset: now + WINDOW_MS };
  row.n += 1;
  map.set(id, row);
  if (map.size > 2000) prune(map);
  return row.n <= max;
}

function clientIp(req) {
  const fwd = String(req.headers?.['x-forwarded-for'] || '')
    .split(',')[0]
    .trim();
  return fwd || req.ip || req.socket?.remoteAddress || 'unknown';
}

function checkChatRate(req) {
  const ip = clientIp(req);
  const session = String(req.body?.sessionId || req.headers?.['x-session-id'] || '').trim();
  if (!hit(ipHits, ip, MAX_PER_IP)) {
    return 'Quá nhiều câu hỏi từ mạng này. Đợi khoảng 1 phút rồi thử lại.';
  }
  if (session && session !== 'anonymous' && !hit(sessionHits, session, MAX_PER_SESSION)) {
    return 'Phiên này đang hỏi quá nhanh. Đợi chút rồi thử lại.';
  }
  return '';
}

function acquireChatSlot(signal) {
  return new Promise((resolve, reject) => {
    const failIfAborted = () => {
      if (!signal?.aborted) return false;
      reject(signal.reason || new Error('Aborted'));
      return true;
    };
    if (failIfAborted()) return;

    const grant = () => {
      if (failIfAborted()) return;
      inFlight += 1;
      resolve({ release() { releaseChatSlot(); } });
    };

    if (inFlight < MAX_CONCURRENT) {
      grant();
      return;
    }

    const timer = setTimeout(() => {
      const idx = waiters.indexOf(tryGrant);
      if (idx >= 0) waiters.splice(idx, 1);
      const err = new Error('Hệ thống đang bận. Thử lại sau vài giây.');
      err.status = 503;
      reject(err);
    }, WAIT_MS);

    function tryGrant() {
      clearTimeout(timer);
      if (signal) signal.removeEventListener('abort', onAbort);
      grant();
    }
    function onAbort() {
      clearTimeout(timer);
      const idx = waiters.indexOf(tryGrant);
      if (idx >= 0) waiters.splice(idx, 1);
      failIfAborted();
    }
    waiters.push(tryGrant);
    if (signal) signal.addEventListener('abort', onAbort, { once: true });
  });
}

function releaseChatSlot() {
  inFlight = Math.max(0, inFlight - 1);
  const next = waiters.shift();
  if (next) next();
}

function chatGateStats() {
  return { inFlight, waiting: waiters.length, maxConcurrent: MAX_CONCURRENT };
}

function resetChatGateForTests() {
  ipHits.clear();
  sessionHits.clear();
  inFlight = 0;
  waiters.length = 0;
}

module.exports = {
  checkChatRate,
  acquireChatSlot,
  releaseChatSlot,
  chatGateStats,
  resetChatGateForTests,
  MAX_CONCURRENT,
  MAX_PER_IP,
  MAX_PER_SESSION,
};
