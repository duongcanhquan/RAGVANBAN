/**
 * Hybrid Search — embedding query + Pinecone metadata filter.
 * Loại trừ văn bản "Hết hiệu lực"; giữ "Còn hiệu lực" và "Bị thay thế một phần".
 */

const { ACTIVE_TRANG_THAI } = require('../ingestion/extractMetadata');

/**
 * @param {{ linh_vuc?: string, onlyActive?: boolean }} intent
 */
function buildMetadataFilter(intent = {}) {
  const onlyActive = intent.onlyActive !== false;
  const conditions = [];

  if (onlyActive) {
    conditions.push({ trang_thai: { $in: ACTIVE_TRANG_THAI } });
  }

  if (intent.linh_vuc && intent.linh_vuc !== 'Chung') {
    conditions.push({ linh_vuc: { $eq: intent.linh_vuc } });
  }

  if (conditions.length === 0) return undefined;
  if (conditions.length === 1) return conditions[0];
  return { $and: conditions };
}

function normalizeMatch(match) {
  const meta = match.metadata || {};
  const link = meta.link_goc || meta.url_file_goc || '';
  return {
    id: match.id,
    score: match.score,
    text: meta.text || meta.text_preview || '',
    so_hieu: meta.so_hieu || '',
    loai_van_ban: meta.loai_van_ban || '',
    ngay_ban_hanh: meta.ngay_ban_hanh || '',
    co_quan_ban_hanh: meta.co_quan_ban_hanh || '',
    trang_thai: meta.trang_thai || '',
    van_ban_thay_the: meta.van_ban_thay_the || [],
    link_goc: link,
    url_file_goc: link,
    ten_file: meta.ten_file || '',
    linh_vuc: meta.linh_vuc || '',
  };
}

function dedupeAndRank(matches) {
  const byKey = new Map();

  for (const m of matches) {
    const key = `${m.so_hieu}::${m.link_goc || m.url_file_goc || m.ten_file}`;
    const prev = byKey.get(key);
    if (!prev) {
      byKey.set(key, m);
      continue;
    }
    const prevDate = prev.ngay_ban_hanh || '';
    const nextDate = m.ngay_ban_hanh || '';
    if (nextDate > prevDate || (nextDate === prevDate && (m.score || 0) > (prev.score || 0))) {
      byKey.set(key, m);
    }
  }

  return Array.from(byKey.values()).sort((a, b) => (b.score || 0) - (a.score || 0));
}

async function hybridSearch(question, intent, deps) {
  const {
    embeddings,
    pinecone,
    indexName,
    namespace = '',
    topK = 6,
  } = deps;

  if (!embeddings || !pinecone || !indexName) {
    throw new Error('hybridSearch: thiếu embeddings / pinecone / indexName');
  }

  const vector = await embeddings.embedQuery(question);
  const filter = buildMetadataFilter({ ...intent, onlyActive: true });

  const index = pinecone.Index(indexName);
  const target = namespace ? index.namespace(namespace) : index;

  const result = await target.query({
    vector,
    topK,
    includeMetadata: true,
    filter,
  });

  let matches = (result.matches || []).map(normalizeMatch).filter((m) => m.text);

  if (matches.length === 0 && intent?.linh_vuc && intent.linh_vuc !== 'Chung') {
    const fallback = await target.query({
      vector,
      topK,
      includeMetadata: true,
      filter: buildMetadataFilter({ onlyActive: true }),
    });
    matches = (fallback.matches || []).map(normalizeMatch).filter((m) => m.text);
  }

  return dedupeAndRank(matches);
}

module.exports = {
  buildMetadataFilter,
  normalizeMatch,
  dedupeAndRank,
  hybridSearch,
};
