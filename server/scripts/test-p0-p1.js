/**
 * P0/P1 — chuẩn hóa số hiệu, vector sạch, cấu hình RAG, catalog patch.
 * node scripts/test-p0-p1.js
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { chunkTextWithMetadata } = require('../src/ingestion/chunkDocuments');
const {
  upsertChunksToPinecone,
  deleteVectorsByFileName,
  updateVectorsMetadataByFileName,
} = require('../src/ingestion/upsertToPinecone');
const { normalizeCatalogPatch } = require('../src/services/documentAdmin');
const { normalizeRag } = require('../src/services/ragConfig');
const { compactSoHieu } = require('../src/ingestion/legalChunker');

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

function mockPinecone() {
  const calls = { deleteMany: [], upsert: [], update: [] };
  const ns = {
    deleteMany: async (arg) => {
      calls.deleteMany.push(arg);
    },
    upsert: async (batch) => {
      calls.upsert.push(batch);
    },
    update: async (arg) => {
      calls.update.push(arg);
    },
    listPaginated: async () => ({ vectors: [] }),
  };
  return {
    calls,
    client: {
      Index: () => ns,
    },
    ns,
  };
}

async function run() {
  test('ingest/xóa không còn đọc PINECONE_INDEX_NAME trực tiếp', () => {
    const files = [
      path.resolve(__dirname, '../src/services/ingestFile.js'),
      path.resolve(__dirname, '../src/services/documentAdmin.js'),
    ];
    for (const f of files) {
      const src = fs.readFileSync(f, 'utf8');
      assert.ok(
        !/process\.env\.PINECONE_INDEX_NAME/.test(src),
        `${path.basename(f)} vẫn đọc env index`
      );
      assert.ok(/pineconeIndexTarget/.test(src), `${path.basename(f)} thiếu pineconeIndexTarget`);
    }
  });

  await testAsync('chunk pháp lý gắn van_ban_bai_bo từ đoạn Điều', async () => {
    const text = `
Nghị định số 01/2024/NĐ-CP

Điều 1. Phạm vi
Quy định chung.

Điều 10. Điều khoản thi hành
Bãi bỏ Nghị định số 99/2015/NĐ-CP.
`;
    const docs = await chunkTextWithMetadata(
      text,
      { so_hieu: '01/2024/NĐ-CP', ten_file: 'a.pdf', van_ban_bai_bo: [] },
      { chunkSize: 80 }
    );
    const d10 = docs.find((d) => d.metadata.dieu === '10');
    assert.ok(d10, 'thiếu chunk Điều 10');
    const list = d10.metadata.van_ban_bai_bo || [];
    assert.ok(
      list.some((s) => compactSoHieu(s).includes('99/2015')),
      JSON.stringify(list)
    );
  });

  await testAsync('upsertChunksToPinecone embed rồi mới xóa vector cũ', async () => {
    const { client, calls } = mockPinecone();
    await upsertChunksToPinecone(
      [
        {
          pageContent: 'Điều 1',
          metadata: { ten_file: 'vb.pdf', chunk_index: 0, so_hieu: '01/2024/NĐ-CP' },
        },
      ],
      {
        embeddings: { embedDocuments: async (t) => t.map(() => [0.1, 0.2]) },
        pinecone: client,
        indexName: 'van-ban-hanh-chinh',
        replaceFileName: 'vb.pdf',
      }
    );
    assert.ok(calls.deleteMany.length >= 1, 'không gọi xóa');
    assert.deepStrictEqual(calls.deleteMany[0], { filter: { ten_file: { $eq: 'vb.pdf' } } });
    assert.ok(calls.upsert.length >= 1);
  });

  await testAsync('deleteVectorsByFileName còn xóa theo pinecone_ids', async () => {
    const { client, calls } = mockPinecone();
    await deleteVectorsByFileName('old.pdf', {
      pinecone: client,
      indexName: 'idx',
      ids: ['doc-old.pdf-0', 'doc-old.pdf-1'],
    });
    const idDelete = calls.deleteMany.find((a) => Array.isArray(a));
    assert.ok(idDelete, 'phải xóa theo mảng id');
    assert.deepStrictEqual(idDelete, ['doc-old.pdf-0', 'doc-old.pdf-1']);
  });

  await testAsync('updateVectorsMetadataByFileName compact so_hieu trên id đã biết', async () => {
    const { client, calls } = mockPinecone();
    const r = await updateVectorsMetadataByFileName(
      'a.pdf',
      { so_hieu: '68 / 2016 / NĐ-CP', trang_thai: 'Hết hiệu lực' },
      { pinecone: client, indexName: 'idx', ids: ['id-1'] }
    );
    assert.strictEqual(r.ok, true);
    assert.strictEqual(r.updated, 1);
    assert.strictEqual(calls.update[0].metadata.so_hieu, '68/2016/NĐ-CP');
    assert.strictEqual(calls.update[0].metadata.trang_thai, 'Hết hiệu lực');
  });

  test('normalizeCatalogPatch compact số hiệu và chặn trạng thái lạ', () => {
    const p = normalizeCatalogPatch({
      soHieu: ' 01 / 2024 / NĐ-CP ',
      trangThai: 'còn hiệu lực gấp',
    });
    assert.strictEqual(p.so_hieu, '01/2024/NĐ-CP');
    assert.strictEqual(p.trang_thai, undefined);
    const ok = normalizeCatalogPatch({ trangThai: 'Hết hiệu lực' });
    assert.strictEqual(ok.trang_thai, 'Hết hiệu lực');
  });

  test('normalizeRag onlyActiveDefault=false được giữ', () => {
    const r = normalizeRag({ onlyActiveDefault: false, topK: 8, maxPerDoc: 3, maxTotal: 10 });
    assert.strictEqual(r.onlyActiveDefault, false);
    assert.strictEqual(r.topK, 8);
    assert.strictEqual(r.maxPerDoc, 3);
  });

  test('assertUploadSize chặn file lớn hơn cấu hình', () => {
    const { assertUploadSize } = require('../src/services/ragConfig');
    assert.doesNotThrow(() => assertUploadSize(1000, 2000));
    assert.throws(() => assertUploadSize(5000, 2000), /vượt/);
  });

  test('prompt extract schema có van_ban_bai_bo', () => {
    const src = fs.readFileSync(
      path.resolve(__dirname, '../src/ingestion/extractMetadata.js'),
      'utf8'
    );
    assert.ok(/"van_ban_bai_bo": string\[\]/.test(src));
  });

  console.log(`\nKết quả: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exitCode = 1;
}

run().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
