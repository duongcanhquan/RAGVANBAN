/**
 * Kiểm tra API phản hồi chat + wiring learn loop.
 * node scripts/test-chat-feedback.js
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');

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

const chatSrc = fs.readFileSync(path.resolve(__dirname, '../src/routes/chat.js'), 'utf8');
const supaSrc = fs.readFileSync(path.resolve(__dirname, '../src/services/supabase.js'), 'utf8');

test('chat.js có POST /feedback và import updateChatLogFeedback', () => {
  assert.match(chatSrc, /router\.post\('\/feedback'/);
  assert.match(chatSrc, /updateChatLogFeedback/);
});

test('SSE done trả logId sau persistLog', () => {
  assert.match(chatSrc, /logId:\s*logRow\?\.id/);
  assert.match(chatSrc, /const logRow = await persistLog/);
});

test('supabase export updateChatLogFeedback', () => {
  assert.match(supaSrc, /async function updateChatLogFeedback/);
  assert.match(supaSrc, /feedback:\s*norm/);
});

test('learnLoop coi feedback down là câu yếu', () => {
  const { isWeakAnswer, pickBestAnswer } = require('../src/services/learnLoop');
  assert.equal(
    isWeakAnswer({
      question: 'q',
      answer: 'Trả lời đủ dài có nguồn trích dẫn chi tiết.',
      citations_used: [{ url: 'https://a' }],
      tags: { feedback: 'down' },
    }),
    true
  );
  const best = pickBestAnswer([
    { answer: 'Trả lời B', citations_used: [], tags: { feedback: 'down' } },
    { answer: 'Trả lời A tốt hơn', citations_used: [{ url: 'x' }], tags: { feedback: 'up' } },
  ]);
  assert.match(best, /Trả lời A/);
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
