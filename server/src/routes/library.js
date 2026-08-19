/**
 * Thư viện theo cây chuyên mục / chuyên môn / sub-folder.
 *
 * GET    /api/library/tree
 * GET    /api/library/categories
 * POST   /api/library/categories
 * PATCH  /api/library/categories/:id
 * DELETE /api/library/categories/:id
 * PATCH  /api/library/documents/:id   { categoryId }
 * GET    /api/library/search?q=
 */

const express = require('express');
const fs = require('fs');
const path = require('path');
const {
  listDocuments,
  updateDocumentCategory,
  isConfigured,
} = require('../services/supabase');
const { listPdfFiles } = require('../ingestion/listPdfs');
const {
  listCategories,
  createCategory,
  updateCategory,
  deleteCategory,
  pathForCategory,
  setLocalDocCategory,
  getAllLocalDocMap,
} = require('../services/taxonomyStore');
const { requireAdmin, requireSuperAdmin } = require('../middleware/requireAdmin');
const { assertCanUseCategory } = require('../services/adminAccess');

const router = express.Router();

function localPdfNodes() {
  const dirs = [
    path.resolve(__dirname, '../../data'),
    path.resolve(__dirname, '../../../data'),
    path.resolve(__dirname, '../../data/uploads'),
  ];
  const catMap = getAllLocalDocMap();
  const seen = new Set();
  const nodes = [];
  for (const dir of dirs) {
    try {
      if (!fs.existsSync(dir)) continue;
      for (const file of listPdfFiles(dir)) {
        const abs = path.resolve(file);
        if (seen.has(abs)) continue;
        seen.add(abs);
        const id = `local:${abs}`;
        nodes.push({
          id,
          file_name: path.basename(file),
          so_hieu: null,
          loai_van_ban: 'Local PDF',
          trang_thai: 'Chưa metadata',
          storage_url: null,
          source: 'local',
          category_id: catMap[id] || null,
          path: abs,
        });
      }
    } catch {
      // ignore
    }
  }
  return nodes;
}

function normalizeDoc(d, catMap, flatCategories) {
  const categoryId =
    d.category_id || catMap[d.id] || d.metadata?.category_id || null;
  const folderPath =
    d.folder_path ||
    (categoryId ? pathForCategory(flatCategories, categoryId) : '') ||
    d.metadata?.folder_path ||
    '';
  return {
    id: d.id,
    file_name: d.file_name,
    so_hieu: d.so_hieu,
    loai_van_ban: d.loai_van_ban || d.metadata?.loai_van_ban || null,
    trang_thai: d.trang_thai || d.metadata?.trang_thai || null,
    storage_url: d.storage_url || d.drive_web_view_link || d.metadata?.link_goc || null,
    drive_web_view_link: d.drive_web_view_link || null,
    chunk_count: d.chunk_count,
    source: d.source || d.metadata?.source || 'upload',
    category_id: categoryId,
    chuyen_mon: d.chuyen_mon || d.metadata?.chuyen_mon || null,
    folder_path: folderPath,
    created_at: d.created_at,
    label: [d.so_hieu, d.file_name].filter(Boolean).join(' · ') || d.file_name,
    type: 'document',
  };
}

/**
 * Gắn documents vào category tree; document nằm ở node chuyên môn/folder.
 */
function attachDocsToCategoryTree(catTree, docs) {
  const byCat = new Map();
  const uncategorized = [];

  for (const doc of docs) {
    if (doc.category_id) {
      if (!byCat.has(doc.category_id)) byCat.set(doc.category_id, []);
      byCat.get(doc.category_id).push(doc);
    } else {
      uncategorized.push(doc);
    }
  }

  const walk = (node) => {
    const children = (node.children || []).map(walk);
    const ownDocs = (byCat.get(node.id) || []).sort((a, b) =>
      String(a.label).localeCompare(String(b.label), 'vi')
    );
    const docCount =
      ownDocs.length + children.reduce((s, c) => s + (c.docCount || 0), 0);
    return {
      id: node.id,
      label: node.name || node.label,
      name: node.name,
      slug: node.slug,
      kind: node.kind,
      type: 'category',
      parent_id: node.parent_id,
      sort_order: node.sort_order,
      description: node.description,
      docCount,
      documents: ownDocs,
      children,
    };
  };

  const tree = catTree.map(walk);

  if (uncategorized.length) {
    tree.push({
      id: 'uncategorized',
      label: 'Chưa gắn chuyên mục',
      name: 'Chưa gắn chuyên mục',
      kind: 'folder',
      type: 'category',
      docCount: uncategorized.length,
      documents: uncategorized.sort((a, b) =>
        String(a.label).localeCompare(String(b.label), 'vi')
      ),
      children: [],
    });
  }

  return tree;
}

router.get('/categories', async (_req, res, next) => {
  try {
    const result = await listCategories();
    res.json(result);
  } catch (err) {
    next(err);
  }
});

router.post('/categories', requireSuperAdmin, async (req, res, next) => {
  try {
    const result = await createCategory({
      name: req.body?.name,
      parentId: req.body?.parentId || null,
      kind: req.body?.kind || 'folder',
      description: req.body?.description || '',
      sortOrder: req.body?.sortOrder,
    });
    if (!result.ok) {
      res.status(400).json(result);
      return;
    }
    res.status(201).json(result);
  } catch (err) {
    next(err);
  }
});

router.patch('/categories/:id', requireSuperAdmin, async (req, res, next) => {
  try {
    const result = await updateCategory(req.params.id, {
      name: req.body?.name,
      parentId: req.body?.parentId,
      kind: req.body?.kind,
      description: req.body?.description,
      sortOrder: req.body?.sortOrder,
    });
    if (!result.ok) {
      res.status(400).json(result);
      return;
    }
    res.json(result);
  } catch (err) {
    next(err);
  }
});

router.delete('/categories/:id', requireSuperAdmin, async (req, res, next) => {
  try {
    const result = await deleteCategory(req.params.id);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

router.patch('/documents/:id', requireAdmin, async (req, res, next) => {
  try {
    const categoryId = req.body?.categoryId || null;
    assertCanUseCategory(req.admin, categoryId);
    const cats = await listCategories();
    const folderPath = categoryId ? pathForCategory(cats.items || [], categoryId) : '';
    const cat = (cats.items || []).find((c) => c.id === categoryId);

    setLocalDocCategory(req.params.id, categoryId);

    const updated = await updateDocumentCategory(req.params.id, {
      categoryId,
      folderPath,
      chuyenMon: cat?.name || null,
    });

    res.json({
      ok: true,
      categoryId,
      folderPath,
      supabase: updated,
    });
  } catch (err) {
    next(err);
  }
});

router.get('/tree', async (_req, res, next) => {
  try {
    const cats = await listCategories();
    const listed = await listDocuments({ limit: 800 });
    let docs = listed.items || [];
    let source = listed.source || 'none';

    if (!docs.length) {
      docs = localPdfNodes();
      source = docs.length ? 'local-pdf' : source;
    }

    const catMap = getAllLocalDocMap();
    const normalized = docs.map((d) => normalizeDoc(d, catMap, cats.items || []));
    const tree = attachDocsToCategoryTree(cats.tree || [], normalized);

    res.json({
      ok: true,
      supabase: isConfigured(),
      source,
      taxonomySource: cats.source,
      total: normalized.length,
      categories: cats.items || [],
      tree,
    });
  } catch (err) {
    next(err);
  }
});

router.get('/search', async (req, res, next) => {
  try {
    const q = String(req.query.q || '').trim().toLowerCase();
    const categoryId = String(req.query.categoryId || '').trim();
    const cats = await listCategories();
    const listed = await listDocuments({ limit: 800 });
    let docs = listed.items || [];
    if (!docs.length) docs = localPdfNodes();
    const catMap = getAllLocalDocMap();
    let items = docs.map((d) => normalizeDoc(d, catMap, cats.items || []));

    if (categoryId) {
      items = items.filter((d) => d.category_id === categoryId);
    }
    if (q) {
      items = items.filter((d) =>
        [d.file_name, d.so_hieu, d.loai_van_ban, d.trang_thai, d.folder_path, d.chuyen_mon]
          .filter(Boolean)
          .join(' ')
          .toLowerCase()
          .includes(q)
      );
    }
    res.json({ ok: true, items, total: items.length });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
