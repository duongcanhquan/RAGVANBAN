const { test } = require('node:test');
const assert = require('node:assert/strict');
const { GeminiEmbeddings, l2Normalize } = require('../src/services/geminiEmbeddings');

test('l2Normalize đơn vị', () => {
  const v = l2Normalize([3, 4]);
  assert.equal(v.length, 2);
  const n = Math.sqrt(v[0] * v[0] + v[1] * v[1]);
  assert.ok(Math.abs(n - 1) < 1e-9);
});

test('GeminiEmbeddings gửi gemini-embedding-001 và 768 chiều', async () => {
  const calls = [];
  const fakeFetch = async (url, opts) => {
    calls.push({ url, body: JSON.parse(opts.body) });
    return {
      ok: true,
      json: async () => ({
        embeddings: [{ values: [3, 4] }, { values: [0, 2] }],
      }),
    };
  };
  const emb = new GeminiEmbeddings({
    apiKey: 'AIza-test',
    model: 'text-embedding-004',
    outputDimensionality: 768,
    fetchImpl: fakeFetch,
  });
  const docs = await emb.embedDocuments(['a', 'b']);
  assert.equal(calls.length, 1);
  assert.match(calls[0].url, /models\/gemini-embedding-001:batchEmbedContents/);
  assert.equal(calls[0].body.requests[0].outputDimensionality, 768);
  assert.equal(calls[0].body.requests[0].taskType, 'RETRIEVAL_DOCUMENT');
  assert.equal(docs[0].length, 2);
  const n = Math.sqrt(docs[0][0] ** 2 + docs[0][1] ** 2);
  assert.ok(Math.abs(n - 1) < 1e-9);
});

test('embedQuery dùng RETRIEVAL_QUERY', async () => {
  let body;
  const emb = new GeminiEmbeddings({
    apiKey: 'AIza-test',
    model: 'gemini-embedding-001',
    fetchImpl: async (_url, opts) => {
      body = JSON.parse(opts.body);
      return { ok: true, json: async () => ({ embeddings: [{ values: [1, 0] }] }) };
    },
  });
  await emb.embedQuery('câu hỏi');
  assert.equal(body.requests[0].taskType, 'RETRIEVAL_QUERY');
});
