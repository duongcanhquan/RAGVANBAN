/**
 * Unit tests giọng nói: tách câu TTS + ưu tiên provider nhanh.
 * node scripts/test-voice-talk.js
 */

const assert = require('assert');
const { extractSpeakable, stripMarkdownForSpeech } = require('../src/services/speakChunks');
const { normalizeTalk, FAST_CHAT_ORDER, publicTalkPayload } = require('../src/services/voiceTalk');
const { preferFastChatChain } = require('../src/services/llmFactory');

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    passed += 1;
    console.log(`✓ ${name}`);
  } catch (err) {
    failed += 1;
    console.error(`✗ ${name}\n  ${err.message}`);
  }
}

test('stripMarkdownForSpeech bỏ ** và link', () => {
  const out = stripMarkdownForSpeech('**Kết luận:** xem [VB](https://x.com/a.pdf) ngay.');
  assert.ok(!out.includes('**'));
  assert.ok(!out.includes('http'));
  assert.ok(out.includes('Kết luận'));
});

test('extractSpeakable nói hết câu, giữ phần dở', () => {
  const { spoken, rest } = extractSpeakable('Kết luận: được. Căn cứ còn ');
  assert.ok(spoken.some((s) => /được/i.test(s)));
  assert.ok(/Căn cứ/.test(rest));
});

test('extractSpeakable nói dần khi đoạn đã dài dù chưa có chấm', () => {
  const long = `${'thủ tục hành chính cần giấy tờ liên quan khá nhiều, '.repeat(3)}và tiếp`;
  const { spoken, rest } = extractSpeakable(long, { minFlush: 42, hardFlush: 88 });
  assert.ok(spoken.length >= 1, 'phải nói sớm');
  assert.ok(typeof rest === 'string');
});

test('normalizeTalk mặc định tắt, kẹp rate', () => {
  const t = normalizeTalk({ enabled: true, rate: 9 });
  assert.strictEqual(t.enabled, true);
  assert.strictEqual(t.rate, 1.4);
  assert.strictEqual(normalizeTalk({}).enabled, false);
  assert.strictEqual(normalizeTalk({ enabled: 'true' }).enabled, false);
  assert.strictEqual(publicTalkPayload({}).enabled, false);
  assert.strictEqual(publicTalkPayload({ enabled: true }).enabled, true);
});

test('FAST_CHAT_ORDER Groq rồi Gemini', () => {
  assert.strictEqual(FAST_CHAT_ORDER[0], 'groq');
  assert.ok(FAST_CHAT_ORDER.indexOf('gemini') < FAST_CHAT_ORDER.indexOf('openai'));
});

test('preferFastChatChain là mảng unique', () => {
  const chain = preferFastChatChain();
  assert.ok(Array.isArray(chain));
  assert.strictEqual(new Set(chain).size, chain.length);
});

console.log(`\nKết quả: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exitCode = 1;
