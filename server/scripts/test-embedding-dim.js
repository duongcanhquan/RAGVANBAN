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

test('Gemini text-embedding-004 / gemini-embedding-001 = 768', () => {
  assert.equal(expectedEmbeddingDim('text-embedding-004'), 768);
  assert.equal(expectedEmbeddingDim('models/text-embedding-004'), 768);
  assert.equal(expectedEmbeddingDim('gemini-embedding-001'), 768);
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

test('768 vs index 1536 thì throw, giữ index thì dùng OpenAI 1536', () => {
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
      assert.match(String(err.message), /text-embedding-004/);
      assert.match(String(err.message), /text-embedding-3-small|OpenAI/i);
      assert.doesNotMatch(String(err.message), /không ghép được Gemini/);
      assert.equal(err.code, 'EMBEDDING_DIM_MISMATCH');
      return true;
    }
  );
});

test('1536 vs index 1024 thì throw, giữ index thì dùng Mistral', () => {
  assert.throws(
    () =>
      assertEmbeddingFitsIndex({
        vectors: new Array(1536).fill(0.1),
        indexDim: 1024,
        model: 'text-embedding-3-small',
      }),
    (err) => {
      assert.match(String(err.message), /1536/);
      assert.match(String(err.message), /1024/);
      assert.match(String(err.message), /mistral-embed/i);
      assert.doesNotMatch(String(err.message), /text-embedding-004/);
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

test('768 là cặp Gemini; 1536 là ChatGPT / OpenAI', () => {
  const {
    modelsForIndexDim,
    pineconeCreateHint,
    recommendEmbeddingForIndex,
  } = require('../src/services/embeddingDim');
  assert.ok(modelsForIndexDim(768).some((m) => /Gemini|embedding-001/i.test(m)));
  assert.equal(recommendEmbeddingForIndex(768).provider, 'gemini');
  assert.equal(recommendEmbeddingForIndex(1536).provider, 'openai');
  assert.equal(recommendEmbeddingForIndex(1536).defaultModel, 'text-embedding-3-small');
  assert.match(pineconeCreateHint(), /768/);
  assert.match(pineconeCreateHint(), /1536/);
  assert.match(pineconeCreateHint(), /text-embedding-3-small/i);
  assert.match(pineconeCreateHint(), /1024/);
});

test('1024 là cặp Mistral; báo cáo lệch nêu action', () => {
  const {
    recommendEmbeddingForIndex,
    embeddingAlignmentReport,
  } = require('../src/services/embeddingDim');
  assert.equal(recommendEmbeddingForIndex(1024).provider, 'mistral');
  assert.equal(recommendEmbeddingForIndex(1024).defaultModel, 'mistral-embed');
  const report = embeddingAlignmentReport({
    model: 'text-embedding-3-small',
    indexDim: 1024,
  });
  assert.equal(report.ok, false);
  assert.equal(report.expectedDim, 1536);
  assert.equal(report.action.embeddingPrimary, 'mistral');
  assert.equal(report.action.embeddingModel, 'mistral-embed');
  assert.match(report.fixHint, /1024/);
  assert.match(report.fixHint, /mistral-embed/i);
  assert.ok(report.pairings.find((p) => p.dim === 1024 && p.yours));
});
