/**
 * Catalog tài liệu local khi chưa có Supabase — máy local.
 * Trên Vercel /var/task chỉ đọc: không được tạo hay ghi documents.json.
 */

const fs = require('fs');
const path = require('path');
const { randomUUID } = require('crypto');

const LOCAL_PATH = path.resolve(__dirname, '../../data/documents.json');

function isServerlessReadOnly(env = process.env) {
  return Boolean(env.VERCEL || env.AWS_LAMBDA_FUNCTION_NAME);
}

function emptyStore() {
  return { items: [] };
}

function readStore() {
  try {
    if (!fs.existsSync(LOCAL_PATH)) return emptyStore();
    const parsed = JSON.parse(fs.readFileSync(LOCAL_PATH, 'utf8'));
    if (!Array.isArray(parsed.items)) parsed.items = [];
    return parsed;
  } catch (err) {
    if (err && (err.code === 'EROFS' || err.code === 'EACCES')) return emptyStore();
    return emptyStore();
  }
}

function writeStore(data) {
  if (isServerlessReadOnly()) {
    const err = new Error(
      'Vercel không ghi được documents.json (hệ thống chỉ đọc). Cần SUPABASE_URL và SUPABASE_SERVICE_ROLE_KEY để lưu danh mục.'
    );
    err.code = 'LOCAL_CATALOG_READONLY';
    throw err;
  }
  try {
    const dir = path.dirname(LOCAL_PATH);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(LOCAL_PATH, JSON.stringify(data, null, 2), 'utf8');
  } catch (err) {
    if (err && (err.code === 'EROFS' || err.code === 'EACCES' || err.code === 'LOCAL_CATALOG_READONLY')) {
      const wrapped = new Error(
        'Không ghi được documents.json (hệ thống chỉ đọc). Cần Supabase cho danh mục tài liệu.'
      );
      wrapped.code = 'LOCAL_CATALOG_READONLY';
      throw wrapped;
    }
    throw err;
  }
}

function ensure() {
  return readStore();
}

function write(data) {
  writeStore(data);
}

function failReadonly(err) {
  return {
    ok: false,
    source: 'local',
    error: err?.message || 'Không ghi được catalog local',
  };
}

function upsertLocalDocument(row) {
  try {
    const data = ensure();
    const id = row.id || randomUUID();
    const item = {
      id,
      file_name: row.fileName,
      display_name: row.displayName || row.display_name || row.fileName,
      mo_ta: row.description || row.mo_ta || null,
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
  } catch (err) {
    return failReadonly(err);
  }
}

function listLocalDocuments({ limit = 800 } = {}) {
  const items = ensure().items.slice(0, limit);
  return { ok: true, source: 'local', items };
}

function countLocalDocuments() {
  return { ok: true, count: ensure().items.length };
}

function updateLocalDocumentCategory(id, { categoryId, folderPath, chuyenMon }) {
  try {
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
  } catch (err) {
    return failReadonly(err);
  }
}

function deleteLocalDocument(id) {
  try {
    const data = ensure();
    const before = data.items.length;
    data.items = data.items.filter((d) => d.id !== id);
    if (data.items.length === before) return { ok: false, error: 'Không tìm thấy tài liệu local' };
    write(data);
    return { ok: true, source: 'local' };
  } catch (err) {
    return failReadonly(err);
  }
}

function getLocalDocument(id) {
  return ensure().items.find((d) => d.id === id) || null;
}

function getLocalDocumentByFileName(fileName) {
  const name = String(fileName || '').trim();
  if (!name) return null;
  return ensure().items.find((d) => d.file_name === name) || null;
}

function updateLocalDocument(id, patch) {
  try {
    const data = ensure();
    const idx = data.items.findIndex((d) => d.id === id);
    if (idx < 0) return { ok: false, error: 'Không tìm thấy tài liệu local' };
    const cur = data.items[idx];
    data.items[idx] = {
      ...cur,
      file_name: patch.file_name != null ? patch.file_name : cur.file_name,
      display_name: patch.display_name !== undefined ? patch.display_name : cur.display_name,
      mo_ta: patch.mo_ta !== undefined ? patch.mo_ta : cur.mo_ta,
      so_hieu: patch.so_hieu !== undefined ? patch.so_hieu : cur.so_hieu,
      loai_van_ban: patch.loai_van_ban !== undefined ? patch.loai_van_ban : cur.loai_van_ban,
      trang_thai: patch.trang_thai !== undefined ? patch.trang_thai : cur.trang_thai,
      category_id: patch.category_id !== undefined ? patch.category_id : cur.category_id,
      folder_path: patch.folder_path !== undefined ? patch.folder_path : cur.folder_path,
      chuyen_mon: patch.chuyen_mon !== undefined ? patch.chuyen_mon : cur.chuyen_mon,
      storage_path: patch.storage_path !== undefined ? patch.storage_path : cur.storage_path,
      storage_url: patch.storage_url !== undefined ? patch.storage_url : cur.storage_url,
      chunk_count: patch.chunk_count !== undefined ? Number(patch.chunk_count) || 0 : cur.chunk_count,
      metadata: {
        ...(cur.metadata || {}),
        ...(patch.metadata || {}),
        ...(patch.display_name !== undefined ? { display_name: patch.display_name } : {}),
        ...(patch.mo_ta !== undefined ? { mo_ta: patch.mo_ta } : {}),
        ...(patch.sort_order !== undefined ? { sort_order: Number(patch.sort_order) || 0 } : {}),
      },
    };
    write(data);
    return { ok: true, source: 'local', item: data.items[idx] };
  } catch (err) {
    return failReadonly(err);
  }
}

module.exports = {
  upsertLocalDocument,
  listLocalDocuments,
  countLocalDocuments,
  updateLocalDocumentCategory,
  deleteLocalDocument,
  getLocalDocument,
  getLocalDocumentByFileName,
  updateLocalDocument,
  isServerlessReadOnly,
  LOCAL_PATH,
};
