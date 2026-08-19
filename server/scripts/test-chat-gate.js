/**
 * Rate limit + slot chat song song.
 * node scripts/test-chat-gate.js
 */
const assert = require('assert');
const { checkChatRate, acquireChatSlot, resetChatGateForTests, MAX_CONCURRENT } = require('../src/services/chatGate');
const { combineSignals, isAbortError } = require('../src/services/abortControl');
const { supersedeSessionWork, endSessionWork, invalidateSessionCache } = require('../src/services/sessionSearchCache');

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
async function testAsync(name, fn) {
  try {
    await fn();
    passed += 1;
    console.log(`✓ ${name}`);
  } catch (err) {
    failed += 1;
    console.error(`✗ ${name}\n  ${err.message}`);
  }
}

async function run() {
  resetChatGateForTests();
  invalidateSessionCache();

  test('checkChatRate cho phép vài câu từ cùng IP', () => {
    const req = { ip: '10.0.0.9', headers: {}, body: { sessionId: 's1' } };
    assert.equal(checkChatRate(req), '');
    assert.equal(checkChatRate(req), '');
  });

  test('combineSignals abort khi một nhánh abort', () => {
    const a = new AbortController();
    const b = new AbortController();
    const merged = combineSignals(a.signal, b.signal);
    b.abort();
    assert.equal(merged.aborted, true);
  });

  await testAsync('supersedeSessionWork hủy request cũ cùng phiên', async () => {
    const first = supersedeSessionWork('sess-a');
    assert.ok(first);
    const second = supersedeSessionWork('sess-a');
    assert.equal(first.signal.aborted, true);
    assert.equal(second.signal.aborted, false);
    endSessionWork('sess-a', second);
  });

  await testAsync('acquireChatSlot không vượt MAX_CONCURRENT', async () => {
    resetChatGateForTests();
    const held = [];
    for (let i = 0; i < MAX_CONCURRENT; i += 1) {
      held.push(await acquireChatSlot());
    }
    let timed = false;
    const ac = new AbortController();
    setTimeout(() => ac.abort(), 30);
    try {
      await acquireChatSlot(ac.signal);
    } catch (err) {
      timed = isAbortError(err) || /Aborted/i.test(err.message);
    }
    assert.equal(timed, true);
    held.forEach((s) => s.release());
  });

  console.log(`\nKết quả: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exitCode = 1;
}

run().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
