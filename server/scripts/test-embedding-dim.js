/**
 * Dimension embedding phải khớp index Pinecone.
 * node scripts/test-embedding-dim.js
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  expectedEmbeddingDim,
  vectorDim,
  assertEmbeddingFitsIndex,
  embeddingDimHint,
} = require('../src/services/embeddingDim');

test('OpenAI text-embedding-3-small = 1536', () => {
  assert.equal(expectedEmbeddingDim('text-embedding-3-small'), 1536);
  assert.equal(expectedEmbeddingDim('openai/text-embedding-3-small'), 1536);
});

test('Gemini text-embedding-004 = 768', () => {
  assert.equal(expectedEmbeddingDim('text-embedding-004'), 768);
  assert.equal(expectedEmbeddingDim('models/text-embedding-004'), 768);
});

test('model lạ → null (không đoán bừa)', () => {
  assert.equal(expectedEmbeddingDim('custom-local-embed'), null);
  assert.equal(expectedEmbeddingDim(''), null);
});

test('vectorDim đọc vector hoặc batch', () => {
  assert.equal(vectorDim([0, 1, 2]), 3);
  assert.equal(vectorDim([[0, 1], [2, 3]]), 2);
  assert.equal(vectorDim(null), 0);
});

test('khớp thì không throw', () => {
  const r = assertEmbeddingFitsIndex({
    vectors: new Array(1536).fill(0.1),
    indexDim: 1536,
    model: 'text-embedding-3-small',
  });
  assert.equal(r.ok, true);
});

test('768 vs index 1536 thì throw, nêu cả hai model', () => {
  assert.throws(
    () =>
      assertEmbeddingFitsIndex({
        vectors: new Array(768).fill(0.1),
        indexDim: 1536,
        model: 'text-embedding-004',
      }),
    (err) => {
      assert.match(String(err.message), /768/);
      assert.match(String(err.message), /1536/);
      assert.match(String(err.message), /text-embedding-004|Gemini/i);
      assert.match(String(err.message), /3-small|1536/);
      assert.equal(err.code, 'EMBEDDING_DIM_MISMATCH');
      return true;
    }
  );
});

test('thiếu indexDim thì bỏ qua (mock/test)', () => {
  const r = assertEmbeddingFitsIndex({
    vectors: new Array(768).fill(0),
    indexDim: null,
    model: 'text-embedding-004',
  });
  assert.equal(r.ok, true);
});

test('getPineconeIndexDimension đọc describeIndex và cache', async () => {
  const { getPineconeIndexDimension, resetIndexDimCache } = require('../src/services/embeddingDim');
  resetIndexDimCache();
  let calls = 0;
  const pinecone = {
    describeIndex: async (name) => {
      calls += 1;
      assert.equal(name, 'van-ban-hanh-chinh');
      return { dimension: 1536 };
    },
  };
  assert.equal(await getPineconeIndexDimension(pinecone, 'van-ban-hanh-chinh'), 1536);
  assert.equal(await getPineconeIndexDimension(pinecone, 'van-ban-hanh-chinh'), 1536);
  assert.equal(calls, 1);
  const { peekPineconeIndexDimension } = require('../src/services/embeddingDim');
  assert.equal(peekPineconeIndexDimension('van-ban-hanh-chinh'), 1536);
  assert.equal(calls, 1);
});

test('peekPineconeIndexDimension không gọi mạng nếu chưa cache', () => {
  const { peekPineconeIndexDimension, resetIndexDimCache } = require('../src/services/embeddingDim');
  resetIndexDimCache();
  assert.equal(peekPineconeIndexDimension('van-ban-hanh-chinh'), null);
});

test('hint hướng dẫn tạo index', () => {
  assert.match(embeddingDimHint('text-embedding-004'), /768/);
  assert.match(embeddingDimHint('text-embedding-3-small'), /1536/);
  assert.match(embeddingDimHint('text-embedding-3-small'), /Custom|gõ 1536/i);
});

test('768 là cặp Gemini — không bắt buộc chip 1536 trên Pinecone', () => {
  const {
    modelsForIndexDim,
    pineconeCreateHint,
    recommendEmbeddingForIndex,
  } = require('../src/services/embeddingDim');
  assert.ok(modelsForIndexDim(768).some((m) => /Gemini|004/.test(m)));
  assert.equal(recommendEmbeddingForIndex(768).provider, 'gemini');
  assert.match(pineconeCreateHint(), /768/);
  assert.match(pineconeCreateHint(), /Custom|gõ 1536/i);
  assert.match(pineconeCreateHint(), /384|512|1024|2048/);
});
