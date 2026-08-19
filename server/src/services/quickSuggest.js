/**
 * Chip tìm nhanh trên chat: văn bản đã số hóa + từ khóa admin tự thêm.
 * Không dùng bộ mẫu CCCD / BHXH / GPXD.
 */

const { hydrateDocument } = require('./documentCatalog');

const DEMO_QUERIES = new Set(
  [
    'Thủ tục cấp lại CCCD cần giấy tờ gì?',
    'Nghị định nào còn hiệu lực về thủ tục hành chính?',
    'Quy định đóng bảo hiểm xã hội bắt buộc',
    'Đăng ký kinh doanh hộ cá thể gồm những bước nào?',
    'So sánh quy định nghỉ phép năm theo Bộ luật Lao động',
    'Xin cấp giấy phép xây dựng nhà ở cần hồ sơ gì?',
    'Văn bản quy định thời hạn giải quyết hồ sơ CCCD?',
    'Tôi mất CCCD, cần làm gì và mang giấy tờ gì?',
  ].map((s) => s.toLowerCase())
);

const DEMO_IDS = new Set(['k1', 'k2', 'k3', 'k4', 'k5', 'k6']);

function isDemoKeyword(it = {}) {
  const id = String(it.id || '');
  if (DEMO_IDS.has(id)) return true;
  const query = String(it.query || '').trim().toLowerCase();
  if (query && DEMO_QUERIES.has(query)) return true;
  const label = String(it.label || '').trim().toLowerCase();
  if (['cccd', 'bhxh', 'đkkd', 'dkkd', 'gpxd', 'nghỉ phép', 'nghi phep', 'hiệu lực vb'].includes(label)) {
    return true;
  }
  return false;
}

function keywordsFromDocuments(docs, { limit = 18 } = {}) {
  const items = [];
  const seen = new Set();
  for (const raw of docs || []) {
    const d = hydrateDocument(raw);
    const soHieu = String(d.so_hieu || '').trim();
    const name = String(d.display_name || d.file_name || '').trim();
    const label = soHieu || name;
    if (!label || label === 'Tài liệu') continue;
    const key = label.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    const query = soHieu
      ? `Văn bản ${soHieu} quy định những gì?`
      : `Tóm tắt nội dung văn bản «${name}»`;
    items.push({
      id: `doc-${d.id || items.length}`,
      label: label.slice(0, 80),
      query: query.slice(0, 400),
      mode: 'lookup',
    });
    if (items.length >= limit) break;
  }
  return items;
}

function mergePublicQuickKeywords({ catalogItems = [], savedItems = [], limit = 24 } = {}) {
  const custom = (savedItems || []).filter((it) => it && it.query && !isDemoKeyword(it));
  const fromDocs = keywordsFromDocuments(catalogItems, { limit });
  const seen = new Set();
  const out = [];
  const push = (it) => {
    const key = String(it.query || it.label || '')
      .trim()
      .toLowerCase();
    if (!key || seen.has(key)) return;
    seen.add(key);
    out.push({
      id: String(it.id || `k-${out.length}`),
      label: String(it.label || it.query).trim().slice(0, 80),
      query: String(it.query || it.label).trim().slice(0, 400),
      mode: ['lookup', 'advise', 'both'].includes(it.mode) ? it.mode : 'both',
    });
  };
  for (const it of custom) push(it);
  for (const it of fromDocs) push(it);
  return out.slice(0, limit);
}

module.exports = {
  isDemoKeyword,
  keywordsFromDocuments,
  mergePublicQuickKeywords,
  DEMO_IDS,
};
