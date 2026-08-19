/**
 * Unit test apiCache — dedup inflight + TTL.
 */
import assert from 'node:assert/strict';
import { cachedJson, invalidateApiCache } from '../src/lib/apiCache.js';

let fetchCalls = 0;

globalThis.fetch = async (url) => {
  fetchCalls += 1;
  return {
    ok: true,
    json: async () => ({ url, n: fetchCalls }),
  };
};

async function run() {
  invalidateApiCache();
  fetchCalls = 0;

  const u = 'http://test.local/api/library/tree';
  const a = await cachedJson(u);
  const b = await cachedJson(u);
  assert.equal(fetchCalls, 1, 'lần 2 phải dùng cache');
  assert.deepEqual(a, b);

  const p1 = cachedJson('http://test.local/api/inflight');
  const p2 = cachedJson('http://test.local/api/inflight');
  const [x, y] = await Promise.all([p1, p2]);
  assert.equal(x.url, y.url);
  assert.equal(fetchCalls, 2, 'inflight chỉ 1 request mạng');

  invalidateApiCache('library');
  await cachedJson(u);
  assert.equal(fetchCalls, 3, 'invalidate prefix phải miss cache');

  console.log('✓ apiCache dedup + invalidate');
}

run().catch((err) => {
  console.error('✗', err.message);
  process.exit(1);
});
