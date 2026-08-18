/**
 * Catalog tài liệu local khi chưa có Supabase — để Thư viện vẫn gắn chuyên mục.
 */

const fs = require('fs');
const path = require('path');
const { randomUUID } = require('crypto');

const LOCAL_PATH = path.resolve(__dirname, '../../data/documents.json');

function ensure() {
  const dir = path.dirname(LOCAL_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  if (!fs.existsSync(LOCAL_PATH)) {
    const data = { items: [] };
    fs.writeFileSync(LOCAL_PATH, JSON.stringify(data, null, 2), 'utf8');
    return data;
  }
  try {
    const parsed = JSON.parse(fs.readFileSync(LOCAL_PATH, 'utf8'));
    if (!Array.isArray(parsed.items)) parsed.items = [];
    return parsed;
  } catch {
    const data = { items: [] };
    fs.writeFileSync(LOCAL_PATH, JSON.stringify(data, null, 2), 'utf8');
    return data;
  }
}

function write(data) {
  fs.writeFileSync(LOCAL_PATH, JSON.stringify(data, null, 2), 'utf8');
}

function upsertLocalDocument(row) {
  const data = ensure();
  const id = row.id || randomUUID();
  const item = {
    id,
    file_name: row.fileName,
    so_hieu: row.soHieu || null,
    loai_van_ban: row.loaiVanBan || null,
    trang_thai: row.trangThai || null,
    chunk_count: row.chunkCount || 0,
    storage_path: row.storagePath || null,
    storage_url: row.storageUrl || row.linkGoc || null,
    drive_file_id: row.driveFileId || null,
    drive_web_view_link: row.driveWebViewLink || null,
    source: row.source || 'upload',
    category_id: row.categoryId || null,
    chuyen_mon: row.chuyenMon || null,
    folder_path: row.folderPath || null,
    metadata: row.metadata || {},
    created_at: row.created_at || new Date().toISOString(),
  };
  const idx = data.items.findIndex((d) => d.id === id);
  if (idx >= 0) data.items[idx] = { ...data.items[idx], ...item };
  else data.items.unshift(item);
  write(data);
  return { ok: true, id, source: 'local' };
}

function listLocalDocuments({ limit = 800 } = {}) {
  const items = ensure().items.slice(0, limit);
  return { ok: true, source: 'local', items };
}

function countLocalDocuments() {
  return { ok: true, count: ensure().items.length };
}

function updateLocalDocumentCategory(id, { categoryId, folderPath, chuyenMon }) {
  const data = ensure();
  const idx = data.items.findIndex((d) => d.id === id);
  if (idx < 0) return { ok: false, error: 'Không tìm thấy tài liệu local' };
  data.items[idx] = {
    ...data.items[idx],
    category_id: categoryId || null,
    folder_path: folderPath || null,
    chuyen_mon: chuyenMon || null,
    metadata: {
      ...(data.items[idx].metadata || {}),
      category_id: categoryId || null,
      folder_path: folderPath || null,
      chuyen_mon: chuyenMon || null,
    },
  };
  write(data);
  return { ok: true, id, source: 'local' };
}

module.exports = {
  upsertLocalDocument,
  listLocalDocuments,
  countLocalDocuments,
  updateLocalDocumentCategory,
  LOCAL_PATH,
};
