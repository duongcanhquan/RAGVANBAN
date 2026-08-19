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

test('policy app_settings không đọc secret cho anon', () => {
  const sql = require('fs').readFileSync(
    require('path').resolve(__dirname, '../../supabase/migrations/006_app_settings.sql'),
    'utf8'
  );
  assert.match(sql, /key = 'quick_keywords'/);
  assert.doesNotMatch(sql, /using \(true\)/);
});
