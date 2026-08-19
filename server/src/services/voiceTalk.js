/**
 * Cài đặt giao tiếp giọng nói (bật/tắt từ admin).
 * TTS chạy trên trình duyệt (SpeechSynthesis) — nói từng câu khi token SSE tới, không đợi hết bài.
 */

const { getSetting, setSetting } = require('./appSettings');

const TALK_KEY = 'voice_talk';

/** Provider chat latency thấp — ưu tiên khi user bật voice. */
const FAST_CHAT_ORDER = [
  'groq',
  'gemini',
  'together',
  'fireworks',
  'openrouter',
  'mistral',
  'deepseek',
  'openai',
  'xai',
  'custom',
];

function defaultTalk() {
  return {
    enabled: false,
    autoSpeak: true,
    preferFastChat: true,
    lang: 'vi-VN',
    rate: 1.05,
  };
}

function clampRate(n) {
  const t = Number(n);
  if (!Number.isFinite(t)) return 1.05;
  return Math.min(1.4, Math.max(0.7, t));
}

function normalizeTalk(input = {}) {
  const base = defaultTalk();
  return {
    enabled: input.enabled === true,
    autoSpeak: input.autoSpeak !== false,
    preferFastChat: input.preferFastChat !== false,
    lang: String(input.lang || base.lang).slice(0, 16) || base.lang,
    rate: clampRate(input.rate ?? base.rate),
  };
}

function publicTalkPayload(talk) {
  const t = normalizeTalk(talk);
  return {
    enabled: t.enabled,
    autoSpeak: t.autoSpeak,
    lang: t.lang,
    rate: t.rate,
    preferFastChat: t.preferFastChat,
  };
}

async function getTalk() {
  const stored = await getSetting(TALK_KEY);
  if (stored && typeof stored === 'object') return normalizeTalk(stored);
  return defaultTalk();
}

async function setTalk(input) {
  const value = normalizeTalk(input);
  const saved = await setSetting(TALK_KEY, value);
  return { ok: true, source: saved.source, talk: value };
}

module.exports = {
  TALK_KEY,
  FAST_CHAT_ORDER,
  defaultTalk,
  normalizeTalk,
  publicTalkPayload,
  getTalk,
  setTalk,
};
