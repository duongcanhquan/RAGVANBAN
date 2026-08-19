const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  hintKey,
  mergeBrain,
  applySavedKeys,
  defaultsFromEnv,
  CHAT_PROVIDERS,
  EMBEDDING_PROVIDERS,
  PROVIDER_CATALOG,
} = require('../src/services/llmConfig');

test('catalog có OpenRouter + Groq + Gemini + custom', () => {
  const ids = PROVIDER_CATALOG.map((p) => p.id);
  assert.ok(ids.includes('openrouter'));
  assert.ok(ids.includes('groq'));
  assert.ok(ids.includes('gemini'));
  assert.ok(ids.includes('custom'));
  assert.ok(CHAT_PROVIDERS.includes('openrouter'));
  assert.ok(EMBEDDING_PROVIDERS.includes('openrouter'));
  assert.equal(
    PROVIDER_CATALOG.find((p) => p.id === 'deepseek').supportsEmbed,
    false
  );
});

test('hintKey che key', () => {
  assert.equal(hintKey('sk-abcdefghij'), 'sk-…ghij');
});

test('mergeBrain ưu tiên key trong DB, giữ env nếu DB trống', () => {
  const base = defaultsFromEnv();
  base.providers.openai.apiKey = 'sk-env-openai-keyxx';
  const merged = mergeBrain(base, {
    chatPrimary: 'openrouter',
    providers: {
      openai: { chatModel: 'gpt-4o', apiKey: '' },
      openrouter: { enabled: true, apiKey: 'sk-or-v1-secretkey99', chatModel: 'google/gemini-2.0-flash-exp:free' },
    },
  });
  assert.equal(merged.chatPrimary, 'openrouter');
  assert.equal(merged.providers.openai.apiKey, 'sk-env-openai-keyxx');
  assert.equal(merged.providers.openai.chatModel, 'gpt-4o');
  assert.equal(merged.providers.openrouter.apiKey, 'sk-or-v1-secretkey99');
});

test('applySavedKeys giữ key cũ khi client gửi rỗng', () => {
  const prev = defaultsFromEnv();
  prev.providers.groq.apiKey = 'gsk-keep-this-key-ok';
  const next = applySavedKeys(
    {
      providers: {
        groq: { enabled: true, apiKey: '', chatModel: 'llama-3.3-70b-versatile' },
      },
    },
    prev
  );
  assert.equal(next.providers.groq.apiKey, 'gsk-keep-this-key-ok');
});
