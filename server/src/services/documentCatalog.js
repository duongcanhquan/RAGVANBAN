/**
 * Tên / mô tả / link tài liệu cho danh mục — không phụ thuộc cột DB đã migrate hay chưa.
 */

function trimText(value, max = 2000) {
  return String(value || '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);
}

function catalogFieldsFromIngest(options = {}) {
  const fileName = String(options.fileName || '').trim() || 'van-ban';
  const display_name =
    trimText(options.displayName || options.title || options.display_name, 240) || fileName;
  const mo_ta = trimText(options.description || options.moTa || options.mo_ta, 2000);
  return {
    display_name,
    mo_ta,
    metadata: {
      display_name,
      mo_ta,
    },
  };
}

function hydrateDocument(d = {}) {
  const meta = d.metadata && typeof d.metadata === 'object' ? d.metadata : {};
  const display_name =
    trimText(d.display_name || meta.display_name, 240) || String(d.file_name || '').trim() || 'Tài liệu';
  const mo_ta = trimText(d.mo_ta || meta.mo_ta || meta.description, 2000);
  const storage_url =
    d.storage_url ||
    d.drive_web_view_link ||
    meta.link_goc ||
    meta.url_file_goc ||
    null;
  const so_hieu = d.so_hieu || meta.so_hieu || null;
  const content_sha256 = d.content_sha256 || meta.content_sha256 || null;
  return {
    ...d,
    display_name,
    mo_ta,
    storage_url,
    content_sha256,
    label: [so_hieu, display_name].filter(Boolean).join(' · ') || display_name,
  };
}

function catalogPersistError(result, { supabaseConfigured } = {}) {
  const id = result?.id || null;
  if (!id) {
    return (
      result?.error ||
      'Số hóa vector xong nhưng không ghi được danh mục tài liệu. Kiểm tra bảng documents trên Supabase.'
    );
  }
  if (supabaseConfigured && result.source === 'local') {
    return (
      result.error ||
      'Không ghi được danh mục trên Supabase (đã rơi về file local — thư viện không đọc được). ' +
        'Kiểm tra SUPABASE_SERVICE_ROLE_KEY và bảng documents, rồi tải lên lại.'
    );
  }
  if (result.ok === false) {
    return result.error || 'Không ghi được danh mục tài liệu.';
  }
  return null;
}

function assertCatalogPersisted(result, opts) {
  const msg = catalogPersistError(result, opts);
  if (msg) {
    const err = new Error(msg);
    err.code = 'CATALOG_PERSIST_FAILED';
    throw err;
  }
  return result;
}

function originalStoreError(stored) {
  if (stored?.ok) return null;
  if (stored?.skipped) {
    return 'Chưa lưu được file gốc (chưa cấu hình Cloudflare R2 hoặc Supabase Storage). Không tính số hóa thành công.';
  }
  return stored?.error || stored?.reason || 'Lưu file gốc thất bại.';
}

function assertOriginalStored(stored) {
  const msg = originalStoreError(stored);
  if (msg) {
    const err = new Error(msg);
    err.code = 'ORIGINAL_STORE_FAILED';
    throw err;
  }
  return stored;
}

module.exports = {
  trimText,
  catalogFieldsFromIngest,
  hydrateDocument,
  catalogPersistError,
  assertCatalogPersisted,
  originalStoreError,
  assertOriginalStored,
};
