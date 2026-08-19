/**
 * Xóa / sửa tài liệu quản trị: catalog + Pinecone + R2.
 */

const { getPinecone } = require('./clients');
const { deleteVectorsByFileName } = require('../ingestion/upsertToPinecone');
const { deleteFromR2 } = require('./r2');
const {
  getDocument,
  updateDocument,
  deleteDocumentRow,
  updateDocumentCategory,
} = require('./supabase');
const { listCategories, pathForCategory } = require('./taxonomyStore');
const { canUseCategory, isSuperAdmin } = require('./adminAccess');

function assertCanTouchDoc(admin, doc) {
  if (isSuperAdmin(admin)) return;
  const categoryId = doc?.category_id || doc?.metadata?.category_id || null;
  if (!canUseCategory(admin, categoryId)) {
    const err = new Error('Bạn không được quản lý tài liệu này');
    err.status = 403;
    throw err;
  }
}

async function removeDocument(admin, id) {
  const found = await getDocument(id);
  if (!found.ok) {
    const err = new Error(found.error || 'Không tìm thấy tài liệu');
    err.status = 404;
    throw err;
  }
  assertCanTouchDoc(admin, found.item);

  const fileName = found.item.file_name;
  const storagePath = found.item.storage_path || found.item.metadata?.storage_path || '';

  let pinecone = { skipped: true };
  try {
    pinecone = await deleteVectorsByFileName(fileName, {
      pinecone: getPinecone(),
      indexName: process.env.PINECONE_INDEX_NAME || 'van-ban-hanh-chinh',
      namespace: process.env.PINECONE_NAMESPACE || '',
    });
  } catch (e) {
    pinecone = { ok: false, error: e.message };
  }

  const r2 = storagePath ? await deleteFromR2(storagePath) : { skipped: true };
  const deleted = await deleteDocumentRow(id);
  if (!deleted.ok) {
    const err = new Error(deleted.error || 'Không xóa được bản ghi tài liệu');
    err.status = 500;
    throw err;
  }
  return { ok: true, pinecone, r2, deleted: true };
}

async function patchDocument(admin, id, body) {
  const found = await getDocument(id);
  if (!found.ok) {
    const err = new Error(found.error || 'Không tìm thấy tài liệu');
    err.status = 404;
    throw err;
  }
  assertCanTouchDoc(admin, found.item);

  let categoryId = body.categoryId !== undefined ? body.categoryId || null : undefined;
  if (categoryId !== undefined && !isSuperAdmin(admin) && !canUseCategory(admin, categoryId)) {
    const err = new Error('Bạn không được chuyển vào chuyên mục này');
    err.status = 403;
    throw err;
  }

  const cats = await listCategories();
  const folderPath =
    categoryId !== undefined
      ? categoryId
        ? pathForCategory(cats.items || [], categoryId)
        : ''
      : undefined;
  const cat =
    categoryId !== undefined ? (cats.items || []).find((c) => c.id === categoryId) : null;

  if (categoryId !== undefined) {
    await updateDocumentCategory(id, {
      categoryId,
      folderPath,
      chuyenMon: cat?.name || null,
    });
  }

  const updated = await updateDocument(id, {
    file_name: body.file_name ?? body.fileName,
    so_hieu: body.so_hieu ?? body.soHieu,
    loai_van_ban: body.loai_van_ban ?? body.loaiVanBan,
    trang_thai: body.trang_thai ?? body.trangThai,
  });

  return { ok: true, item: updated.item || found.item, categoryId, folderPath };
}

function filterDocsForAdmin(admin, items) {
  if (isSuperAdmin(admin)) return items;
  return (items || []).filter((d) =>
    canUseCategory(admin, d.category_id || d.metadata?.category_id || null)
  );
}

module.exports = {
  removeDocument,
  patchDocument,
  filterDocsForAdmin,
  assertCanTouchDoc,
};
