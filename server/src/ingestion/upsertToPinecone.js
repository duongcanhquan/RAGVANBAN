/**
 * Embed chunks + upsert Pinecone theo batch.
 */

const { compactSoHieu } = require('./legalChunker');

function asList(v) {
  if (Array.isArray(v)) return v.map(String).map((s) => compactSoHieu(s) || s).filter(Boolean);
  if (v) return [compactSoHieu(String(v)) || String(v)].filter(Boolean);
  return [];
}

function pineconeHandle(pinecone, indexName, namespace = '') {
  const index = pinecone.Index(indexName);
  return namespace ? index.namespace(namespace) : index;
}

function vectorIdFor(tenFile, chunkIndex, documentId) {
  const prefix = documentId ? String(documentId).slice(0, 36) : 'doc';
  return `${prefix}-${tenFile || 'file'}-${chunkIndex}`
    .replace(/[^a-zA-Z0-9._-]/g, '_')
    .slice(0, 512);
}

function fileNamePrefix(tenFile) {
  return `doc-${String(tenFile || 'file')}`.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 400);
}

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
    const documentId = meta.document_id || (idPrefix !== 'doc' ? idPrefix : '');
    const safeId = vectorIdFor(meta.ten_file || 'file', meta.chunk_index ?? i, documentId || 'doc');

    const link = String(meta.link_goc || meta.url_file_goc || '');

    const metadata = {
      so_hieu: compactSoHieu(meta.so_hieu) || String(meta.so_hieu || ''),
      loai_van_ban: String(meta.loai_van_ban || ''),
      ngay_ban_hanh: String(meta.ngay_ban_hanh || ''),
      co_quan_ban_hanh: String(meta.co_quan_ban_hanh || ''),
      trang_thai: String(meta.trang_thai || ''),
      van_ban_thay_the: asList(meta.van_ban_thay_the),
      van_ban_sua_doi: asList(meta.van_ban_sua_doi),
      van_ban_bai_bo: asList(meta.van_ban_bai_bo),
      van_ban_goc: compactSoHieu(meta.van_ban_goc) || String(meta.van_ban_goc || ''),
      dieu: String(meta.dieu || ''),
      khoan: String(meta.khoan || ''),
      heading: String(meta.heading || '').slice(0, 240),
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
    replaceFileName,
    previousIds,
  } = deps;

  if (!chunks.length) return { upserted: 0, ids: [] };

  if (!embeddings || !pinecone || !indexName) {
    throw new Error('upsertChunksToPinecone: thiếu embeddings / pinecone / indexName');
  }

  const fileName =
    replaceFileName ||
    String(chunks[0]?.metadata?.ten_file || '').trim();
  const texts = chunks.map((c) => c.pageContent);
  const vectors = await embeddings.embedDocuments(texts);
  const records = buildPineconeRecords(chunks, vectors);

  if (fileName || (Array.isArray(previousIds) && previousIds.length)) {
    const deleted = await deleteVectorsByFileName(fileName, {
      pinecone,
      indexName,
      namespace,
      ids: previousIds,
    });
    if (deleted && deleted.ok === false && !deleted.skipped) {
      throw new Error(deleted.error || 'Không xóa được vector cũ trước khi ghi đè');
    }
  }

  const target = pineconeHandle(pinecone, indexName, namespace);

  let upserted = 0;
  for (let i = 0; i < records.length; i += batchSize) {
    const batch = records.slice(i, i + batchSize);
    await target.upsert(batch);
    upserted += batch.length;
    console.log(`  upsert batch ${Math.floor(i / batchSize) + 1}: +${batch.length} (total ${upserted})`);
  }

  return { upserted, ids: records.map((r) => r.id) };
}

async function deleteVectorsByFileName(fileName, deps = {}) {
  const { pinecone, indexName, namespace = '', ids: knownIds } = deps;
  const name = String(fileName || '').trim();
  if (!pinecone || !indexName) return { ok: false, skipped: true };
  if (!name && !(Array.isArray(knownIds) && knownIds.length)) return { ok: false, skipped: true };

  const target = pineconeHandle(pinecone, indexName, namespace);
  try {
    const idList = Array.isArray(knownIds) ? knownIds.filter(Boolean) : [];
    if (idList.length) {
      if (typeof target.deleteMany === 'function') {
        await target.deleteMany(idList);
      } else if (typeof target.delete === 'function') {
        await target.delete({ ids: idList });
      }
    }
    if (name) {
      if (typeof target.deleteMany === 'function') {
        await target.deleteMany({ filter: { ten_file: { $eq: name } } });
      } else if (typeof target.delete === 'function') {
        await target.delete({ filter: { ten_file: { $eq: name } } });
      } else if (!idList.length) {
        return { ok: false, error: 'Pinecone SDK không hỗ trợ xóa theo filter' };
      }
    }
    return { ok: true };
  } catch (err) {
    console.warn('[pinecone] delete:', err.message);
    return { ok: false, error: err.message };
  }
}

async function listVectorIdsByPrefix(target, prefix, limit = 200) {
  const ids = [];
  let paginationToken;
  if (typeof target.listPaginated !== 'function') return ids;
  do {
    const page = await target.listPaginated({
      prefix,
      limit: Math.min(100, limit - ids.length),
      paginationToken,
    });
    const batch = (page?.vectors || page?.data || []).map((v) => v.id || v).filter(Boolean);
    ids.push(...batch);
    paginationToken = page?.pagination?.next || page?.nextPaginationToken;
  } while (paginationToken && ids.length < limit);
  return ids;
}

async function updateVectorsMetadataByFileName(fileName, patch, deps = {}) {
  const { pinecone, indexName, namespace = '', ids: knownIds } = deps;
  const name = String(fileName || '').trim();
  if (!name || !pinecone || !indexName) return { ok: false, skipped: true, updated: 0 };

  const metaPatch = {};
  if (patch.so_hieu !== undefined) metaPatch.so_hieu = compactSoHieu(patch.so_hieu) || String(patch.so_hieu || '');
  if (patch.trang_thai !== undefined) metaPatch.trang_thai = String(patch.trang_thai || '');
  if (patch.loai_van_ban !== undefined) metaPatch.loai_van_ban = String(patch.loai_van_ban || '');
  if (patch.ten_file !== undefined) metaPatch.ten_file = String(patch.ten_file || '');
  if (patch.linh_vuc !== undefined) metaPatch.linh_vuc = String(patch.linh_vuc || '');
  if (!Object.keys(metaPatch).length) return { ok: true, updated: 0 };

  const target = pineconeHandle(pinecone, indexName, namespace);
  let ids = Array.isArray(knownIds) ? knownIds.filter(Boolean) : [];
  if (!ids.length) {
    try {
      ids = await listVectorIdsByPrefix(target, fileNamePrefix(name));
    } catch (err) {
      console.warn('[pinecone] list ids:', err.message);
    }
  }
  if (!ids.length) return { ok: false, needReingest: true, updated: 0 };

  let updated = 0;
  for (const id of ids) {
    try {
      await target.update({ id, metadata: metaPatch });
      updated += 1;
    } catch (err) {
      console.warn('[pinecone] update', id, err.message);
    }
  }
  return { ok: updated > 0, updated, ids: ids.length };
}

module.exports = {
  buildPineconeRecords,
  upsertChunksToPinecone,
  deleteVectorsByFileName,
  updateVectorsMetadataByFileName,
  vectorIdFor,
  fileNamePrefix,
};
