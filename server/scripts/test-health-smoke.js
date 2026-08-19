/**
 * Smoke test /api/health — không cần API key Pinecone.
 * Chạy server trước: npm run dev (server) hoặc node src/index.js
 * node scripts/test-health-smoke.js [baseUrl]
 */
const assert = require('assert');

async function run() {
  const base = process.argv[2] || 'http://127.0.0.1:5000';
  const url = `${base.replace(/\/$/, '')}/api/health`;
  let res;
  try {
    res = await fetch(url);
  } catch (err) {
    console.error(`✗ Không kết nối ${url}\n  ${err.message}`);
    console.error('  Gợi ý: cd server && npm run dev');
    process.exitCode = 1;
    return;
  }

  assert.equal(res.status, 200, `HTTP ${res.status}`);
  const body = await res.json();
  assert.equal(body.status, 'ok');
  assert.equal(typeof body.r2, 'boolean', 'r2 phải là boolean (isR2Configured đã import)');
  assert.equal(typeof body.ragReady, 'boolean');
  assert.equal(typeof body.supabase, 'boolean');
  console.log(`✓ GET /api/health → 200 (r2=${body.r2}, ragReady=${body.ragReady})`);
}

run().catch((err) => {
  console.error('✗', err.message);
  process.exitCode = 1;
});
