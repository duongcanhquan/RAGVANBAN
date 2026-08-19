/**
 * Hybrid Search — embedding + neo số hiệu/Điều + VB liên quan + rerank từ khóa.
 */

const { ACTIVE_TRANG_THAI } = require('../ingestion/extractMetadata');
const {
  collectRelatedSoHieu,
  parseQuestionAnchors,
  compactSoHieu,
  soHieuFilterValues,
} = require('../ingestion/legalChunker');
const { rerankLegal } = require('./rerank');
const { raceAbort, throwIfAborted } = require('./abortControl');

function buildMetadataFilter(intent = {}) {
  const onlyActive = intent.onlyActive !== false;
  const conditions = [];

  if (onlyActive) {
    conditions.push({ trang_thai: { $in: ACTIVE_TRANG_THAI } });
  }

  if (intent.linh_vuc && intent.linh_vuc !== 'Chung') {
    conditions.push({ linh_vuc: { $eq: intent.linh_vuc } });
  }

  if (intent.so_hieu_in?.length) {
    conditions.push({ so_hieu: { $in: soHieuFilterValues(intent.so_hieu_in) } });
  }

  if (intent.dieu) {
    conditions.push({ dieu: { $eq: String(intent.dieu) } });
  }

  if (conditions.length === 0) return undefined;
  if (conditions.length === 1) return conditions[0];
  return { $and: conditions };
}

function normalizeMatch(match) {
  const meta = match.metadata || {};
  const link = meta.link_goc || meta.url_file_goc || '';
  const list = (v) => (Array.isArray(v) ? v.map(String).filter(Boolean) : v ? [String(v)] : []);
  return {
    id: match.id,
    score: match.score,
    text: meta.text || meta.text_preview || '',
    so_hieu: compactSoHieu(meta.so_hieu) || meta.so_hieu || '',
    loai_van_ban: meta.loai_van_ban || '',
    ngay_ban_hanh: meta.ngay_ban_hanh || '',
    co_quan_ban_hanh: meta.co_quan_ban_hanh || '',
    trang_thai: meta.trang_thai || '',
    van_ban_thay_the: list(meta.van_ban_thay_the),
    van_ban_sua_doi: list(meta.van_ban_sua_doi),
    van_ban_bai_bo: list(meta.van_ban_bai_bo),
    van_ban_goc: compactSoHieu(meta.van_ban_goc) || meta.van_ban_goc || '',
    dieu: meta.dieu || '',
    khoan: meta.khoan || '',
    heading: meta.heading || '',
    related: Boolean(meta.related || match.related),
    link_goc: link,
    url_file_goc: link,
    ten_file: meta.ten_file || '',
    linh_vuc: meta.linh_vuc || '',
  };
}

function rankMatches(matches, options = {}) {
  const maxPerDoc = Number(options.maxPerDoc) || 4;
  const maxTotal = Number(options.maxTotal) || 12;
  const byDoc = new Map();

  for (const m of matches || []) {
    const key = `${m.so_hieu || ''}::${m.link_goc || m.url_file_goc || m.ten_file || m.id || ''}`;
    if (!byDoc.has(key)) byDoc.set(key, []);
    const bucket = byDoc.get(key);
    const dup = m.id
      ? bucket.some((x) => x.id === m.id)
      : bucket.some((x) => x.text === m.text && String(x.dieu || '') === String(m.dieu || ''));
    if (!dup) bucket.push(m);
  }

  const picked = [];
  for (const list of byDoc.values()) {
    list.sort((a, b) => {
      const ds = (b.score || 0) - (a.score || 0);
      if (Math.abs(ds) > 0.001) return ds;
      return String(b.ngay_ban_hanh || '').localeCompare(String(a.ngay_ban_hanh || ''));
    });
    picked.push(...list.slice(0, maxPerDoc));
  }

  picked.sort((a, b) => {
    const ds = (b.score || 0) - (a.score || 0);
    if (ds) return ds;
    return String(b.ngay_ban_hanh || '').localeCompare(String(a.ngay_ban_hanh || ''));
  });

  return picked.slice(0, maxTotal);
}

function dedupeAndRank(matches) {
  return rankMatches(matches, { maxPerDoc: 4, maxTotal: 24 });
}

async function queryIndex(target, vector, topK, filter, signal) {
  throwIfAborted(signal);
  const result = await raceAbort(
    target.query({
      vector,
      topK,
      includeMetadata: true,
      filter,
    }),
    signal
  );
  return (result.matches || []).map(normalizeMatch).filter((m) => m.text);
}

async function hybridSearch(question, intent, deps) {
  const {
    embeddings,
    pinecone,
    indexName,
    namespace = '',
    topK = 16,
    maxPerDoc = 4,
    maxTotal = 12,
    signal,
  } = deps;

  if (!embeddings || !pinecone || !indexName) {
    throw new Error('hybridSearch: thiếu embeddings / pinecone / indexName');
  }

  throwIfAborted(signal);

  const anchors = parseQuestionAnchors(question);
  const vector = await raceAbort(embeddings.embedQuery(question), signal);
  throwIfAborted(signal);
  const onlyActive = intent?.onlyActive !== false && anchors.onlyActive !== false;
  const filter = buildMetadataFilter({ ...intent, onlyActive });

  const index = pinecone.Index(indexName);
  const target = namespace ? index.namespace(namespace) : index;

  const queries = [queryIndex(target, vector, topK, filter, signal)];

  if (anchors.soHieu.length) {
    queries.push(
      queryIndex(
        target,
        vector,
        Math.min(10, topK),
        buildMetadataFilter({
          onlyActive,
          so_hieu_in: anchors.soHieu,
          dieu: anchors.dieu || undefined,
        }),
        signal
      )
    );
    if (anchors.dieu) {
      queries.push(
        queryIndex(
          target,
          vector,
          8,
          buildMetadataFilter({ onlyActive, so_hieu_in: anchors.soHieu }),
          signal
        )
      );
    }
  }

  const batches = await Promise.all(queries);
  throwIfAborted(signal);
  let matches = batches.flat();

  if (matches.length === 0 && intent?.linh_vuc && intent.linh_vuc !== 'Chung') {
    matches = await queryIndex(
      target,
      vector,
      topK,
      buildMetadataFilter({ onlyActive }),
      signal
    );
  }

  const relatedIds = collectRelatedSoHieu(matches);
  if (relatedIds.length) {
    const dieuFromHits =
      anchors.dieu ||
      matches.map((m) => m.dieu).find((d) => d && d !== 'mo_dau') ||
      '';
    const relatedQueries = [
      queryIndex(
        target,
        vector,
        Math.min(8, topK),
        buildMetadataFilter({
          onlyActive,
          so_hieu_in: relatedIds,
        }),
        signal
      ),
    ];
    if (dieuFromHits) {
      relatedQueries.push(
        queryIndex(
          target,
          vector,
          8,
          buildMetadataFilter({
            onlyActive,
            so_hieu_in: relatedIds,
            dieu: dieuFromHits,
          }),
          signal
        )
      );
    }
    const extra = (await Promise.all(relatedQueries)).flat();
    matches = matches.concat(extra.map((m) => ({ ...m, related: true })));
  }

  throwIfAborted(signal);
  const reranked = rerankLegal(question, matches, intent);
  return rankMatches(reranked, { maxPerDoc, maxTotal });
}

module.exports = {
  buildMetadataFilter,
  normalizeMatch,
  rankMatches,
  dedupeAndRank,
  hybridSearch,
  collectRelatedSoHieu,
  compactSoHieu,
  soHieuFilterValues,
};
