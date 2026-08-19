/**
 * Phạm vi Tra cứu / Tư vấn: mục đã chọn + mọi mục con, rồi map sang catalog/Pinecone.
 */

const { createTtlMap } = require('./ttlMap');

const IN_CAP = 100;
const scopeCache = createTtlMap({ ttlMs: 30_000, max: 80 });

function normalizeSelectedIds(raw) {
  return [...new Set((Array.isArray(raw) ? raw : [raw]).map((s) => String(s || '').trim()).filter(Boolean))].slice(
    0,
    40
  );
}

function expandCategoryIds(flat, selectedIds) {
  const selected = new Set(normalizeSelectedIds(selectedIds));
  if (!selected.size) return [];
  const byParent = new Map();
  for (const c of flat || []) {
    const p = String(c?.parent_id || '');
    if (!p) continue;
    if (!byParent.has(p)) byParent.set(p, []);
    byParent.get(p).push(String(c.id));
  }
  const out = new Set(selected);
  const queue = [...selected];
  while (queue.length) {
    const id = queue.pop();
    for (const child of byParent.get(id) || []) {
      if (!out.has(child)) {
        out.add(child);
        queue.push(child);
      }
    }
  }
  return [...out];
}

function hasCategoryScope(intent = {}) {
  return Boolean(
    intent.category_id_in?.length || intent.document_id_in?.length || intent.ten_file_in?.length
  );
}

function scopeKey(intentOrScope = {}) {
  const ids = intentOrScope.category_id_in || intentOrScope.categoryIds || [];
  return [...ids].map(String).sort().join(',');
}

function capList(list) {
  return [...new Set((list || []).map((s) => String(s || '').trim()).filter(Boolean))].slice(0, IN_CAP);
}

async function resolveCategoryScope(rawIds) {
  const selected = normalizeSelectedIds(rawIds);
  if (!selected.length) return null;
  const cacheKey = selected.slice().sort().join(',');
  const cached = scopeCache.get(cacheKey);
  if (cached) return cached;
  const { listCategories, pathForCategory } = require('./taxonomyStore');
  const { listDocuments } = require('./supabase');
  const cats = await listCategories();
  const flat = cats.items || [];
  const known = new Set(flat.map((c) => String(c.id)));
  const picked = selected.filter((id) => known.has(id));
  if (!picked.length) return null;
  const expanded = expandCategoryIds(flat, picked);
  const expandedSet = new Set(expanded);
  const labels = picked.map((id) => pathForCategory(flat, id) || flat.find((c) => c.id === id)?.name || id);
  const listed = await listDocuments({ limit: 2000 });
  const docs = (listed.items || []).filter((d) => {
    const cid = d.category_id || d.metadata?.category_id;
    return cid && expandedSet.has(String(cid));
  });
  const result = {
    categoryIds: expanded,
    documentIds: capList(docs.map((d) => d.id)),
    fileNames: capList(docs.map((d) => d.file_name)),
    labels,
    selectedIds: picked,
  };
  scopeCache.set(cacheKey, result);
  return result;
}

function applyScopeToIntent(intent, scope) {
  if (!intent || !scope) return intent;
  intent.category_id_in = capList(scope.categoryIds);
  intent.document_id_in = capList(scope.documentIds);
  intent.ten_file_in = capList(scope.fileNames);
  intent.scopeLabels = scope.labels || [];
  intent.skipLinhVucFilter = true;
  return intent;
}

function applyDocumentScope(intent, rawDocIds) {
  if (!intent) return intent;
  const ids = capList(normalizeSelectedIds(rawDocIds));
  if (!ids.length) return intent;
  intent.document_id_in = capList([...(intent.document_id_in || []), ...ids]);
  intent.skipLinhVucFilter = true;
  if (!intent.scopeLabels?.length) {
    intent.scopeLabels = [`${ids.length} văn bản đã chọn`];
  }
  return intent;
}

module.exports = {
  IN_CAP,
  normalizeSelectedIds,
  expandCategoryIds,
  hasCategoryScope,
  scopeKey,
  resolveCategoryScope,
  applyScopeToIntent,
  applyDocumentScope,
  capList,
};
