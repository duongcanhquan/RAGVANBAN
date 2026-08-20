const { test } = require('node:test');
const assert = require('node:assert/strict');
const { parseServiceAccount } = require('../src/services/integrations');

test('parseServiceAccount nhận JSON key Google', () => {
  const json = parseServiceAccount(
    JSON.stringify({
      type: 'service_account',
      client_email: 'rag@proj.iam.gserviceaccount.com',
      private_key: '-----BEGIN PRIVATE KEY-----\\nabc\\n-----END PRIVATE KEY-----\\n',
    })
  );
  assert.equal(json.client_email, 'rag@proj.iam.gserviceaccount.com');
  assert.ok(json.private_key);
});

test('getIntegrationHealth Drive/n8n OFF khi thiếu key nhưng cờ mặc định bật', async () => {
  const { getIntegrationHealth } = require('../src/services/integrations');
  const h = await getIntegrationHealth();
  assert.equal(h.drive.enabled, true);
  assert.equal(h.n8n.enabled, true);
  if (!h.drive.hasKey) assert.equal(h.drive.reason, 'missing_key');
  if (!h.n8n.hasSecret) assert.equal(h.n8n.reason, 'missing_secret');
});

test('workflow n8n production không trỏ localhost', () => {
  const fs = require('fs');
  const path = require('path');
  const wf = JSON.parse(
    fs.readFileSync(path.resolve(__dirname, '../../docs/n8n/ragvanban-sync.workflow.json'), 'utf8')
  );
  const http = (wf.nodes || []).find((n) => n.type === 'n8n-nodes-base.httpRequest');
  assert.ok(http, 'thiếu HTTP node');
  assert.match(String(http.parameters.url || ''), /https:\/\/YOUR-APP\.vercel\.app\/api\/webhooks\/n8n/);
  assert.doesNotMatch(String(http.parameters.url || ''), /127\.0\.0\.1|localhost/);
  const schedule = (wf.nodes || []).find((n) => n.type === 'n8n-nodes-base.scheduleTrigger');
  assert.equal(schedule?.parameters?.rule?.interval?.[0]?.hoursInterval, 4);
  assert.ok(
    Number(http.parameters?.options?.timeout) >= 240000,
    'n8n HTTP timeout phải gần maxDuration 300s của Vercel, không cắt sớm 120s'
  );
  assert.doesNotMatch(
    String(http.parameters?.jsonBody || ''),
    /JSON\.stringify/,
    'jsonBody phải là {{ $json }}, không JSON.stringify'
  );
  const drive = (wf.nodes || []).find((n) => n.type === 'n8n-nodes-base.googleDriveTrigger');
  assert.equal(drive?.parameters?.event, 'fileCreated');
});

test('Vercel cron đồng bộ Drive không phụ thuộc n8n Active', () => {
  const vercel = JSON.parse(
    require('fs').readFileSync(require('path').resolve(__dirname, '../../vercel.json'), 'utf8')
  );
  const cron = (vercel.crons || []).find((c) => c.path === '/api/cron/drive-sync');
  assert.ok(cron, 'thiếu cron /api/cron/drive-sync');
  assert.match(String(cron.schedule), /15|\*\/15/);
  const learn = (vercel.crons || []).find((c) => c.path === '/api/cron/ai-learn');
  assert.ok(learn, 'thiếu cron /api/cron/ai-learn');
});

test('policy app_settings không đọc secret cho anon', () => {
  const sql = require('fs').readFileSync(
    require('path').resolve(__dirname, '../../supabase/migrations/006_app_settings.sql'),
    'utf8'
  );
  assert.match(sql, /key = 'quick_keywords'/);
  assert.doesNotMatch(sql, /using \(true\)/);
  const setup = require('fs').readFileSync(
    require('path').resolve(__dirname, '../../supabase/setup-all.sql'),
    'utf8'
  );
  assert.match(setup, /key = 'quick_keywords'/);
});

test('index.js import isR2Configured cho /api/health', () => {
  const src = require('fs').readFileSync(
    require('path').resolve(__dirname, '../src/index.js'),
    'utf8'
  );
  assert.match(src, /require\('\.\/services\/r2'\)/);
  assert.match(src, /isR2Configured/);
  assert.match(src, /\/api\/health/);
});

test('chat feedback route và logId trong SSE done', () => {
  const src = require('fs').readFileSync(
    require('path').resolve(__dirname, '../src/routes/chat.js'),
    'utf8'
  );
  assert.match(src, /router\.post\('\/feedback'/);
  assert.match(src, /logId:\s*logRow\?\.id/);
});

test('cron local không chấp nhận chỉ x-vercel-cron khi thiếu CRON_SECRET', () => {
  const { cronAuthorizedForTest } = require('../src/routes/cron');
  const prevSecret = process.env.CRON_SECRET;
  const prevVercel = process.env.VERCEL;
  delete process.env.CRON_SECRET;
  delete process.env.VERCEL;
  try {
    assert.equal(
      cronAuthorizedForTest({ headers: { 'x-vercel-cron': '1' } }),
      false
    );
  } finally {
    if (prevSecret !== undefined) process.env.CRON_SECRET = prevSecret;
    else delete process.env.CRON_SECRET;
    if (prevVercel !== undefined) process.env.VERCEL = prevVercel;
    else delete process.env.VERCEL;
  }
});
