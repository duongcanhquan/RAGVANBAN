/**
 * Timeout / AbortController xuyên embed–Pinecone–LLM + race nhiều tab cùng session.
 * TDD: các case này phải fail trước khi gắn signal.
 * Chạy: node scripts/test-abort-session.js
 */

const assert = require('assert');
const { EventEmitter } = require('events');
const {
  remember,
  recall,
  beginSessionRequest,
  invalidateSessionCache,
} = require('../src/services/sessionSearchCache');
const { hybridSearch } = require('../src/services/hybridSearch');
const { streamAnswer } = require('../src/services/qaChain');
const { routeIntent } = require('../src/services/intentRouter');
const { listenSseAbort, bindSseAbort } = require('../src/services/sseAbort');
const { isFallbackableError, shouldAttemptNextProvider } = require('../src/services/llmFactory');
const { raceAbort, isAbortError, abortError } = require('../src/services/abortControl');

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    passed += 1;
    console.log(`✓ ${name}`);
  } catch (err) {
    failed += 1;
    console.error(`✗ ${name}\n  ${err.stack || err.message}`);
  }
}

async function testAsync(name, fn) {
  try {
    await fn();
    passed += 1;
    console.log(`✓ ${name}`);
  } catch (err) {
    failed += 1;
    console.error(`✗ ${name}\n  ${err.stack || err.message}`);
  }
}

function never() {
  return new Promise(() => {});
}

async function assertRejectsSoon(fn, pred, ms, label) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(label || `không kết thúc trong ${ms}ms`)), ms);
  });
  try {
    await Promise.race([
      Promise.resolve()
        .then(fn)
        .then(
          () => {
            throw new Error('lẽ ra phải reject (AbortError)');
          },
          (err) => {
            if (typeof pred === 'function') assert.ok(pred(err), err?.stack || String(err));
            else assert.ok(isAbortError(err), err?.stack || String(err));
          }
        ),
      timeout,
    ]);
  } finally {
    clearTimeout(timer);
  }
}

const SAMPLE_MATCH = {
  so_hieu: '01/2024/NĐ-CP',
  dieu: '1',
  text: 'Điều 1. Phạm vi điều chỉnh.',
  loai_van_ban: 'Nghị định',
  trang_thai: 'Còn hiệu lực',
};

async function run() {
  invalidateSessionCache();

  test('isAbortError nhận AbortError / timeout', () => {
    const a = abortError('client');
    const t = abortError('timeout');
    assert.strictEqual(isAbortError(a), true);
    assert.strictEqual(isAbortError(t), true);
    assert.strictEqual(isAbortError(new Error('pinecone down')), false);
    assert.strictEqual(isAbortError(new Error('Request timeout')), false);
    assert.strictEqual(isFallbackableError(new Error('Request timeout')), true);
    assert.strictEqual(t.abortKind, 'timeout');
  });

  test('AbortError không được fallback provider', () => {
    const abort = abortError('client');
    assert.strictEqual(isFallbackableError(abort), false);
    assert.strictEqual(isFallbackableError(abortError('timeout')), false);
    assert.strictEqual(shouldAttemptNextProvider(abort, true), false);
    assert.strictEqual(shouldAttemptNextProvider({ noFallback: true, message: 'x' }, true), false);
    assert.strictEqual(shouldAttemptNextProvider({ status: 429 }, true), true);
    assert.strictEqual(shouldAttemptNextProvider(new Error('invalid api key'), true), true);
    assert.strictEqual(shouldAttemptNextProvider(new Error('invalid api key'), false), false);
  });

  await testAsync('raceAbort reject ngay khi signal đã abort — không đợi promise treo', async () => {
    const ac = new AbortController();
    ac.abort(abortError('client'));
    const start = Date.now();
    await assert.rejects(() => raceAbort(never(), ac.signal), isAbortError);
    assert.ok(Date.now() - start < 80, 'đã abort sẵn vẫn chờ');
  });

  await testAsync('raceAbort reject khi abort giữa chừng', async () => {
    const ac = new AbortController();
    const start = Date.now();
    const p = raceAbort(never(), ac.signal);
    setTimeout(() => ac.abort(abortError('timeout')), 15);
    await assert.rejects(() => p, isAbortError);
    assert.ok(Date.now() - start < 200, `abort giữa chừng quá chậm: ${Date.now() - start}ms`);
  });

  await testAsync('raceAbort resolve nếu promise xong trước abort', async () => {
    const ac = new AbortController();
    const v = await raceAbort(Promise.resolve(42), ac.signal);
    assert.strictEqual(v, 42);
    ac.abort();
  });

  test('SSE: đóng khi chưa end abort controller', () => {
    const res = new EventEmitter();
    res.writableEnded = false;
    const bound = bindSseAbort(res, { timeoutMs: 0 });
    assert.strictEqual(bound.aborted(), false);
    res.emit('close');
    assert.strictEqual(bound.aborted(), true);
    assert.strictEqual(bound.signal.aborted, true);
    bound.dispose();
  });

  test('SSE: end bình thường không abort', () => {
    const res = new EventEmitter();
    res.writableEnded = false;
    const bound = bindSseAbort(res);
    res.writableEnded = true;
    res.emit('close');
    assert.strictEqual(bound.aborted(), false);
    bound.dispose();
  });

  test('listenSseAbort: close trước end vẫn là hủy (tương thích cũ)', () => {
    const res = new EventEmitter();
    res.writableEnded = false;
    const aborted = listenSseAbort(res);
    res.emit('close');
    assert.strictEqual(aborted(), true);
  });

  await testAsync('SSE timeout abort dù client vẫn mở', async () => {
    const res = new EventEmitter();
    res.writableEnded = false;
    const bound = bindSseAbort(res, { timeoutMs: 25 });
    const start = Date.now();
    await new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error('timeout bindSseAbort không abort')), 200);
      bound.signal.addEventListener(
        'abort',
        () => {
          clearTimeout(t);
          resolve();
        },
        { once: true }
      );
    });
    assert.ok(Date.now() - start < 150);
    assert.strictEqual(bound.aborted(), true);
    assert.strictEqual(bound.signal.reason?.abortKind, 'timeout');
    bound.dispose();
  });

  test('session: tab chậm không ghi đè tab nhanh cùng sessionId', () => {
    invalidateSessionCache();
    const sid = 'tab-race-1';
    const seqA = beginSessionRequest(sid);
    const seqB = beginSessionRequest(sid);
    assert.ok(seqB > seqA);

    const wroteA = remember(sid, { question: 'câu A chậm', matches: [{ id: 'A' }] }, seqA);
    assert.strictEqual(wroteA, false, 'request A cũ không được ghi đè');
    assert.strictEqual(recall(sid), null);

    const wroteB = remember(sid, { question: 'câu B nhanh', matches: [{ id: 'B' }] }, seqB);
    assert.strictEqual(wroteB, true);
    assert.strictEqual(recall(sid).matches[0].id, 'B');
    assert.strictEqual(recall(sid).question, 'câu B nhanh');
  });

  test('session: request mới hơn được ghi; seq cũ sau đó vẫn bị từ chối', () => {
    invalidateSessionCache();
    const sid = 'tab-race-2';
    const seqA = beginSessionRequest(sid);
    remember(sid, { question: 'A', matches: [{ id: 'A' }] }, seqA);
    const seqB = beginSessionRequest(sid);
    remember(sid, { question: 'B', matches: [{ id: 'B' }] }, seqB);
    assert.strictEqual(recall(sid).matches[0].id, 'B');
    assert.strictEqual(remember(sid, { question: 'A2', matches: [{ id: 'A2' }] }, seqA), false);
    assert.strictEqual(recall(sid).matches[0].id, 'B');
  });

  test('session: anonymous không cấp seq / không cache', () => {
    invalidateSessionCache();
    assert.strictEqual(beginSessionRequest('anonymous'), 0);
    assert.strictEqual(beginSessionRequest(''), 0);
    assert.strictEqual(remember('anonymous', { question: 'x', matches: [{ id: 'z' }] }, 1), false);
    assert.strictEqual(recall('anonymous'), null);
  });

  test('session: remember không seq vẫn last-write-wins (tương thích)', () => {
    invalidateSessionCache();
    remember('sess-compat', { question: '1', matches: [{ id: '1' }] });
    remember('sess-compat', { question: '2', matches: [{ id: '2' }] });
    assert.strictEqual(recall('sess-compat').matches[0].id, '2');
  });

  await testAsync('hybridSearch: abort trước embed thì không gọi Pinecone', async () => {
    const ac = new AbortController();
    ac.abort(abortError('client'));
    let queried = 0;
    let embedded = 0;
    await assertRejectsSoon(
      () =>
        hybridSearch(
          'Điều 5 Nghị định 01/2020/NĐ-CP?',
          { onlyActive: true },
          {
            embeddings: {
              embedQuery: async () => {
                embedded += 1;
                return [0.1, 0.2];
              },
            },
            pinecone: {
              Index: () => ({
                query: async () => {
                  queried += 1;
                  return { matches: [] };
                },
              }),
            },
            indexName: 'idx',
            signal: ac.signal,
          }
        ),
      isAbortError,
      200,
      'hybridSearch không abort khi signal đã hủy'
    );
    assert.strictEqual(embedded, 0, 'vẫn embed sau khi abort');
    assert.strictEqual(queried, 0, 'vẫn query Pinecone sau khi abort');
  });

  await testAsync('hybridSearch: abort khi embed treo — không đợi, không query', async () => {
    const ac = new AbortController();
    let queried = 0;
    setTimeout(() => ac.abort(abortError('timeout')), 20);
    const start = Date.now();
    await assertRejectsSoon(
      () =>
        hybridSearch(
          'hỏi gì đó',
          {},
          {
            embeddings: { embedQuery: () => never() },
            pinecone: {
              Index: () => ({
                query: async () => {
                  queried += 1;
                  return { matches: [] };
                },
              }),
            },
            indexName: 'idx',
            signal: ac.signal,
          }
        ),
      isAbortError,
      250,
      'hybridSearch treo khi embed không bao giờ xong'
    );
    assert.ok(Date.now() - start < 200, `abort embed chậm: ${Date.now() - start}ms`);
    assert.strictEqual(queried, 0);
  });

  await testAsync('hybridSearch: abort khi Pinecone query treo', async () => {
    const ac = new AbortController();
    setTimeout(() => ac.abort(abortError('timeout')), 20);
    const start = Date.now();
    await assertRejectsSoon(
      () =>
        hybridSearch(
          'hỏi không neo',
          {},
          {
            embeddings: { embedQuery: async () => [0.05, 0.05] },
            pinecone: {
              Index: () => ({
                query: () => never(),
              }),
            },
            indexName: 'idx',
            signal: ac.signal,
          }
        ),
      isAbortError,
      250,
      'hybridSearch treo khi Pinecone không trả'
    );
    assert.ok(Date.now() - start < 200, `abort query chậm: ${Date.now() - start}ms`);
  });

  await testAsync('streamAnswer: truyền signal vào llm.stream', async () => {
    const ac = new AbortController();
    let seen;
    const llm = {
      stream: async (_msgs, opts) => {
        seen = opts?.signal;
        return (async function* () {
          yield { content: 'ok' };
        })();
      },
    };
    await streamAnswer('Điều 1 nói gì?', [SAMPLE_MATCH], { llm, signal: ac.signal });
    assert.strictEqual(seen, ac.signal);
  });

  await testAsync('streamAnswer: abort giữa token — không chờ chunk sau', async () => {
    const ac = new AbortController();
    const tokens = [];
    const llm = {
      stream: async () =>
        (async function* () {
          yield { content: 'một' };
          await new Promise((r) => setTimeout(r, 800));
          yield { content: 'hai-không-được-lọt' };
        })(),
    };
    const start = Date.now();
    const p = streamAnswer('Điều 1 nói gì?', [SAMPLE_MATCH], { llm, signal: ac.signal }, (t) =>
      tokens.push(t)
    );
    setTimeout(() => ac.abort(abortError('client')), 25);
    await assertRejectsSoon(
      () => p,
      isAbortError,
      300,
      'streamAnswer không abort khi đang chờ token'
    );
    assert.ok(Date.now() - start < 250, `abort stream chậm: ${Date.now() - start}ms`);
    const joined = tokens.join('');
    assert.ok(!joined.includes('hai-không-được-lọt'), joined);
  });

  await testAsync('routeIntent: truyền signal vào llm.invoke', async () => {
    const ac = new AbortController();
    let seen;
    const llm = {
      invoke: async (_prompt, opts) => {
        seen = opts?.signal;
        return {
          content: '{"linh_vuc":"Chung","keywords":[],"needs_retrieval":true,"muc_dich":"tra_cuu"}',
        };
      },
    };
    await routeIntent('Thủ tục gì?', { llm, useLlm: true, signal: ac.signal });
    assert.strictEqual(seen, ac.signal);
  });

  await testAsync('routeIntent: abort khi invoke treo', async () => {
    const ac = new AbortController();
    setTimeout(() => ac.abort(abortError('timeout')), 20);
    const llm = { invoke: () => never() };
    const start = Date.now();
    await assertRejectsSoon(
      () => routeIntent('Hỏi dài không neo số hiệu để phải gọi LLM', { llm, useLlm: true, signal: ac.signal }),
      isAbortError,
      250,
      'routeIntent treo khi LLM không trả'
    );
    assert.ok(Date.now() - start < 200);
  });

  invalidateSessionCache();

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed) process.exit(1);
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
