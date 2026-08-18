/**
 * Embed chunks + upsert Pinecone theo batch.
 */

/**
 * @param {Array<{ pageContent: string, metadata: object }>} documents
 * @param {number[][]} vectors
 * @param {string} idPrefix
 */
function buildPineconeRecords(documents, vectors, idPrefix = 'doc') {
  if (documents.length !== vectors.length) {
    throw new Error('buildPineconeRecords: documents và vectors lệch số lượng');
  }

  return documents.map((doc, i) => {
    const meta = doc.metadata || {};
    const safeId = `${idPrefix}-${meta.ten_file || 'file'}-${meta.chunk_index ?? i}`
      .replace(/[^a-zA-Z0-9._-]/g, '_')
      .slice(0, 512);

    const link = String(meta.link_goc || meta.url_file_goc || '');
    const vanBanThayThe = Array.isArray(meta.van_ban_thay_the)
      ? meta.van_ban_thay_the.map(String)
      : [];

    const metadata = {
      so_hieu: String(meta.so_hieu || ''),
      loai_van_ban: String(meta.loai_van_ban || ''),
      ngay_ban_hanh: String(meta.ngay_ban_hanh || ''),
      co_quan_ban_hanh: String(meta.co_quan_ban_hanh || ''),
      trang_thai: String(meta.trang_thai || ''),
      van_ban_thay_the: vanBanThayThe,
      link_goc: link,
      url_file_goc: link,
      ten_file: String(meta.ten_file || ''),
      linh_vuc: String(meta.linh_vuc || ''),
      chunk_index: Number(meta.chunk_index ?? i),
      text: String(doc.pageContent || '').slice(0, 35000),
    };

    return {
      id: safeId,
      values: vectors[i],
      metadata,
    };
  });
}

/**
 * @param {import('@langchain/core/documents').Document[]} chunks
 * @param {object} deps
 */
async function upsertChunksToPinecone(chunks, deps) {
  const {
    embeddings,
    pinecone,
    indexName,
    namespace = '',
    batchSize = Number(process.env.UPSERT_BATCH_SIZE) || 64,
  } = deps;

  if (!chunks.length) return { upserted: 0 };

  if (!embeddings || !pinecone || !indexName) {
    throw new Error('upsertChunksToPinecone: thiếu embeddings / pinecone / indexName');
  }

  const texts = chunks.map((c) => c.pageContent);
  const vectors = await embeddings.embedDocuments(texts);
  const records = buildPineconeRecords(chunks, vectors);

  const index = pinecone.Index(indexName);
  const target = namespace ? index.namespace(namespace) : index;

  let upserted = 0;
  for (let i = 0; i < records.length; i += batchSize) {
    const batch = records.slice(i, i + batchSize);
    await target.upsert(batch);
    upserted += batch.length;
    console.log(`  upsert batch ${Math.floor(i / batchSize) + 1}: +${batch.length} (total ${upserted})`);
  }

  return { upserted };
}

module.exports = { buildPineconeRecords, upsertChunksToPinecone };
