/**
 * Xóa / sửa tài liệu quản trị: catalog + Pinecone + R2.
 */

const { getPinecone, pineconeIndexTarget, ensureBrain } = require('./clients');
const { deleteVectorsByFileName, updateVectorsMetadataByFileName } = require('../ingestion/upsertToPinecone');
const { deleteFromR2, moveR2Object } = require('./r2');
const {
  getDocument,
  updateDocument,
  deleteDocumentRow,
  updateDocumentCategory,
} = require('./supabase');
const { listCategories, pathForCategory } = require('./taxonomyStore');
const { canUseCategory, isSuperAdmin } = require('./adminAccess');
const { invalidateSessionCache } = require('./sessionSearchCache');
const { compactSoHieu } = require('../ingestion/legalChunker');
const { VALID_TRANG_THAI } = require('../ingestion/extractMetadata');

function normalizeCatalogPatch(body = {}) {
  const patch = {};
  const soRaw = body.so_hieu ?? body.soHieu;
  if (soRaw !== undefined) {
    const compacted = compactSoHieu(soRaw) || String(soRaw || '').trim();
    patch.so_hieu = compacted || null;
  }
  const loai = body.loai_van_ban ?? body.loaiVanBan;
  if (loai !== undefined) patch.loai_van_ban = String(loai || '').trim() || null;
  const status = body.trang_thai ?? body.trangThai;
  if (status !== undefined) {
    const s = String(status || '').trim();
    if (VALID_TRANG_THAI.has(s)) patch.trang_thai = s;
  }
  const fileName = body.file_name ?? body.fileName;
  if (fileName !== undefined) patch.file_name = String(fileName || '').trim() || undefined;
  const displayName = body.display_name ?? body.displayName;
  if (displayName !== undefined) patch.display_name = String(displayName || '').trim() || null;
  const moTa = body.mo_ta ?? body.moTa ?? body.description;
  if (moTa !== undefined) patch.mo_ta = String(moTa || '').trim() || null;
  if (body.sort_order !== undefined || body.sortOrder !== undefined) {
    patch.sort_order = body.sort_order ?? body.sortOrder;
  }
  return patch;
}

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
  const previousIds = found.item.metadata?.pinecone_ids || [];
  const storagePath = found.item.storage_path || found.item.metadata?.storage_path || '';

  let pinecone = { skipped: true };
  try {
    await ensureBrain();
    const pc = pineconeIndexTarget();
    pinecone = await deleteVectorsByFileName(fileName, {
      pinecone: getPinecone(),
      indexName: pc.indexName,
      namespace: pc.namespace,
      ids: previousIds,
    });
  } catch (e) {
    pinecone = { ok: false, error: e.message };
  }

  if (pinecone && pinecone.ok === false && !pinecone.skipped) {
    const err = new Error(pinecone.error || 'Không xóa được vector trên Pinecone');
    err.status = 502;
    throw err;
  }

  const r2 = storagePath ? await deleteFromR2(storagePath) : { skipped: true };
  const deleted = await deleteDocumentRow(id);
  if (!deleted.ok) {
    const err = new Error(deleted.error || 'Không xóa được bản ghi tài liệu');
    err.status = 500;
    throw err;
  }
  invalidateSessionCache();
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
  const prevCategoryId = found.item.category_id || found.item.metadata?.category_id || null;
  const categoryChanged =
    categoryId !== undefined && String(categoryId || '') !== String(prevCategoryId || '');
  const folderPath =
    categoryId !== undefined
      ? categoryId
        ? pathForCategory(cats.items || [], categoryId)
        : ''
      : undefined;
  const cat =
    categoryId !== undefined ? (cats.items || []).find((c) => c.id === categoryId) : null;

  if (categoryChanged) {
    await updateDocumentCategory(id, {
      categoryId,
      folderPath,
      chuyenMon: cat?.name || null,
    });

    const oldPath = found.item.storage_path || found.item.metadata?.storage_path || '';
    if (oldPath && String(oldPath).startsWith('van-ban/')) {
      const moved = await moveR2Object(oldPath, folderPath || '');
      if (moved.ok && moved.path && moved.path !== oldPath) {
        await updateDocument(id, {
          storage_path: moved.path,
          storage_url: moved.publicUrl,
        });
      }
    }
  }

  const catalog = normalizeCatalogPatch(body);
  if (Object.keys(catalog).length) {
    if (catalog.display_name !== undefined || catalog.mo_ta !== undefined) {
      catalog.metadata = {
        ...(found.item.metadata || {}),
        ...(catalog.display_name !== undefined ? { display_name: catalog.display_name } : {}),
        ...(catalog.mo_ta !== undefined ? { mo_ta: catalog.mo_ta } : {}),
      };
    }
    const updated = await updateDocument(id, catalog);
    if (updated && updated.ok === false) {
      const err = new Error(updated.error || 'Không cập nhật được tài liệu');
      err.status = 500;
      throw err;
    }
    if (updated?.item) found.item = { ...found.item, ...updated.item };
  }

  const next = found.item;
  const metaChanged =
    catalog.so_hieu !== undefined ||
    catalog.trang_thai !== undefined ||
    catalog.file_name !== undefined ||
    catalog.loai_van_ban !== undefined ||
    categoryChanged;
  let pinecone = { skipped: true };
  if (metaChanged) {
    try {
      await ensureBrain();
      const pc = pineconeIndexTarget();
      pinecone = await updateVectorsMetadataByFileName(
        found.item.file_name,
        {
          so_hieu: next.so_hieu,
          trang_thai: next.trang_thai,
          loai_van_ban: next.loai_van_ban,
          ten_file: next.file_name,
          category_id: next.category_id || categoryId || '',
          document_id: next.id,
          folder_path: next.folder_path || folderPath || '',
        },
        {
          pinecone: getPinecone(),
          indexName: pc.indexName,
          namespace: pc.namespace,
          ids: found.item.metadata?.pinecone_ids,
        }
      );
    } catch (e) {
      pinecone = { ok: false, error: e.message };
    }
  }

  return { ok: true, item: next, categoryId, folderPath, pinecone };
}

async function reorderDocuments(admin, items) {
  const list = Array.isArray(items) ? items.slice(0, 400) : [];
  if (!list.length) {
    const err = new Error('Thiếu danh sách sắp xếp');
    err.status = 400;
    throw err;
  }
  const results = [];
  for (const it of list) {
    const id = String(it.id || '').trim();
    if (!id) continue;
    try {
      const body = {};
      if (it.categoryId !== undefined) body.categoryId = it.categoryId || null;
      if (it.sortOrder !== undefined || it.sort_order !== undefined) {
        body.sort_order = it.sortOrder ?? it.sort_order;
      }
      results.push({ id, ...(await patchDocument(admin, id, body)) });
    } catch (e) {
      results.push({ id, ok: false, error: e.message });
    }
  }
  const failed = results.filter((r) => r.ok === false).length;
  return { ok: failed === 0, failed, results };
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
  reorderDocuments,
  filterDocsForAdmin,
  assertCanTouchDoc,
  normalizeCatalogPatch,
};
