/**
 * Cây chuyên mục / chuyên môn / sub-folder — Supabase hoặc JSON local.
 */

const fs = require('fs');
const path = require('path');
const { randomUUID } = require('crypto');
const { getSupabase, isConfigured } = require('./supabase');

const LOCAL_PATH = path.resolve(__dirname, '../../data/taxonomy.json');

/** Bộ chuyên mục mặc định — hành chính công Việt Nam */
const DEFAULT_TREE = [
  {
    name: 'Hành chính công',
    slug: 'hanh-chinh-cong',
    kind: 'chuyen_muc',
    children: [
      { name: 'Thủ tục hành chính', slug: 'thu-tuc-hanh-chinh', kind: 'chuyen_mon' },
      { name: 'Căn cước · Cư trú', slug: 'can-cuoc-cu-tru', kind: 'chuyen_mon' },
      { name: 'Hộ tịch', slug: 'ho-tich', kind: 'chuyen_mon' },
    ],
  },
  {
    name: 'Lao động · BHXH',
    slug: 'lao-dong-bhxh',
    kind: 'chuyen_muc',
    children: [
      { name: 'Hợp đồng · Tiền lương', slug: 'hop-dong-luong', kind: 'chuyen_mon' },
      { name: 'Bảo hiểm xã hội', slug: 'bao-hiem-xa-hoi', kind: 'chuyen_mon' },
      { name: 'An toàn lao động', slug: 'an-toan-lao-dong', kind: 'chuyen_mon' },
    ],
  },
  {
    name: 'Thuế · Tài chính',
    slug: 'thue-tai-chinh',
    kind: 'chuyen_muc',
    children: [
      { name: 'Thuế thu nhập', slug: 'thue-thu-nhap', kind: 'chuyen_mon' },
      { name: 'Thuế GTGT · Hải quan', slug: 'thue-gtgt', kind: 'chuyen_mon' },
      { name: 'Ngân sách · Phí lệ phí', slug: 'ngan-sach-phi', kind: 'chuyen_mon' },
    ],
  },
  {
    name: 'Đất đai · Xây dựng',
    slug: 'dat-dai-xay-dung',
    kind: 'chuyen_muc',
    children: [
      { name: 'Đất đai · Nhà ở', slug: 'dat-dai-nha-o', kind: 'chuyen_mon' },
      { name: 'Giấy phép xây dựng', slug: 'giay-phep-xay-dung', kind: 'chuyen_mon' },
    ],
  },
  {
    name: 'Doanh nghiệp · Đầu tư',
    slug: 'doanh-nghiep',
    kind: 'chuyen_muc',
    children: [
      { name: 'Đăng ký kinh doanh', slug: 'dang-ky-kinh-doanh', kind: 'chuyen_mon' },
      { name: 'Giấy phép · Điều kiện', slug: 'giay-phep-dieu-kien', kind: 'chuyen_mon' },
    ],
  },
  {
    name: 'Tư pháp · Khiếu nại',
    slug: 'tu-phap',
    kind: 'chuyen_muc',
    children: [
      { name: 'Khiếu nại · Tố cáo', slug: 'khieu-nai-to-cao', kind: 'chuyen_mon' },
      { name: 'Hỗ trợ pháp lý', slug: 'ho-tro-phap-ly', kind: 'chuyen_mon' },
    ],
  },
  {
    name: 'Chưa phân loại',
    slug: 'chua-phan-loai',
    kind: 'folder',
    children: [],
  },
];

function slugify(name) {
  return String(name || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 80) || `muc-${Date.now()}`;
}

function flattenSeed(nodes, parentId = null, acc = [], sortBase = 0) {
  nodes.forEach((n, i) => {
    const id = randomUUID();
    acc.push({
      id,
      parent_id: parentId,
      name: n.name,
      slug: n.slug || slugify(n.name),
      kind: n.kind || 'folder',
      description: n.description || '',
      sort_order: sortBase + i,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });
    if (n.children?.length) flattenSeed(n.children, id, acc, 0);
  });
  return acc;
}

function ensureLocal() {
  const dir = path.dirname(LOCAL_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  if (!fs.existsSync(LOCAL_PATH)) {
    const categories = flattenSeed(DEFAULT_TREE);
    const data = { categories, docCategoryMap: {} };
    fs.writeFileSync(LOCAL_PATH, JSON.stringify(data, null, 2), 'utf8');
    return data;
  }
  try {
    return JSON.parse(fs.readFileSync(LOCAL_PATH, 'utf8'));
  } catch {
    const categories = flattenSeed(DEFAULT_TREE);
    const data = { categories, docCategoryMap: {} };
    writeLocal(data);
    return data;
  }
}

function writeLocal(data) {
  fs.writeFileSync(LOCAL_PATH, JSON.stringify(data, null, 2), 'utf8');
}

function buildCategoryTree(flat) {
  const byId = new Map(flat.map((c) => [c.id, { ...c, children: [], type: 'category', label: c.name }]));
  const roots = [];
  for (const c of byId.values()) {
    if (c.parent_id && byId.has(c.parent_id)) {
      byId.get(c.parent_id).children.push(c);
    } else {
      roots.push(c);
    }
  }
  const sortRec = (nodes) => {
    nodes.sort((a, b) => (a.sort_order - b.sort_order) || a.name.localeCompare(b.name, 'vi'));
    nodes.forEach((n) => sortRec(n.children));
  };
  sortRec(roots);
  return roots;
}

function pathForCategory(flat, categoryId) {
  const byId = new Map(flat.map((c) => [c.id, c]));
  const parts = [];
  let cur = byId.get(categoryId);
  const guard = new Set();
  while (cur && !guard.has(cur.id)) {
    guard.add(cur.id);
    parts.unshift(cur.name);
    cur = cur.parent_id ? byId.get(cur.parent_id) : null;
  }
  return parts.join(' / ');
}

async function listCategories() {
  const sb = getSupabase();
  if (sb && isConfigured()) {
    const { data, error } = await sb
      .from('doc_categories')
      .select('*')
      .order('sort_order', { ascending: true });
    if (!error && data?.length) {
      return { ok: true, source: 'supabase', items: data, tree: buildCategoryTree(data) };
    }
    if (error) console.warn('[taxonomy] list supabase:', error.message);
    // empty table → seed
    if (!error && (!data || !data.length)) {
      await seedSupabase(sb);
      const retry = await sb.from('doc_categories').select('*').order('sort_order', { ascending: true });
      if (!retry.error) {
        return {
          ok: true,
          source: 'supabase',
          items: retry.data || [],
          tree: buildCategoryTree(retry.data || []),
        };
      }
    }
  }

  const local = ensureLocal();
  if (!local.categories?.length) {
    local.categories = flattenSeed(DEFAULT_TREE);
    writeLocal(local);
  }
  return {
    ok: true,
    source: 'local',
    items: local.categories,
    tree: buildCategoryTree(local.categories),
  };
}

async function seedSupabase(sb) {
  const flat = flattenSeed(DEFAULT_TREE);
  const byId = new Map(flat.map((r) => [r.id, r]));
  const depthOf = (id, guard = new Set()) => {
    const row = byId.get(id);
    if (!row || !row.parent_id) return 0;
    if (guard.has(id)) return 0;
    guard.add(id);
    return 1 + depthOf(row.parent_id, guard);
  };
  flat.sort((a, b) => depthOf(a.id) - depthOf(b.id));
  for (const row of flat) {
    const { error } = await sb.from('doc_categories').insert({
      id: row.id,
      parent_id: row.parent_id,
      name: row.name,
      slug: row.slug,
      kind: row.kind,
      description: row.description,
      sort_order: row.sort_order,
    });
    if (error) console.warn('[taxonomy] seed row:', error.message);
  }
}

async function createCategory({ name, parentId = null, kind = 'folder', description = '', sortOrder = 0 }) {
  const row = {
    name: String(name || '').trim(),
    parent_id: parentId || null,
    kind: ['chuyen_muc', 'chuyen_mon', 'folder'].includes(kind) ? kind : 'folder',
    slug: slugify(name),
    description: String(description || '').slice(0, 500),
    sort_order: Number(sortOrder) || 0,
  };
  if (!row.name) return { ok: false, error: 'Thiếu tên chuyên mục' };

  const sb = getSupabase();
  if (sb && isConfigured()) {
    const { data, error } = await sb.from('doc_categories').insert(row).select('*').single();
    if (!error) return { ok: true, source: 'supabase', item: data };
    console.warn('[taxonomy] create supabase:', error.message);
  }

  const local = ensureLocal();
  const item = {
    id: randomUUID(),
    ...row,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
  local.categories.push(item);
  writeLocal(local);
  return { ok: true, source: 'local', item };
}

async function updateCategory(id, patch) {
  const updates = {};
  if (patch.name != null) {
    updates.name = String(patch.name).trim();
    updates.slug = slugify(updates.name);
  }
  if (patch.parentId !== undefined) updates.parent_id = patch.parentId || null;
  if (patch.kind) updates.kind = patch.kind;
  if (patch.description != null) updates.description = String(patch.description).slice(0, 500);
  if (patch.sortOrder != null) updates.sort_order = Number(patch.sortOrder) || 0;
  updates.updated_at = new Date().toISOString();

  const sb = getSupabase();
  if (sb && isConfigured()) {
    const { data, error } = await sb.from('doc_categories').update(updates).eq('id', id).select('*').single();
    if (!error) return { ok: true, source: 'supabase', item: data };
  }

  const local = ensureLocal();
  const idx = local.categories.findIndex((c) => c.id === id);
  if (idx < 0) return { ok: false, error: 'Không tìm thấy chuyên mục' };
  local.categories[idx] = { ...local.categories[idx], ...updates };
  writeLocal(local);
  return { ok: true, source: 'local', item: local.categories[idx] };
}

function wouldCycle(flat, id, newParentId) {
  if (!newParentId) return false;
  if (id === newParentId) return true;
  const byId = new Map((flat || []).map((c) => [c.id, c]));
  let cur = byId.get(newParentId);
  const guard = new Set();
  while (cur && !guard.has(cur.id)) {
    if (cur.id === id) return true;
    guard.add(cur.id);
    cur = cur.parent_id ? byId.get(cur.parent_id) : null;
  }
  return false;
}

async function reorderCategories(moves) {
  const list = Array.isArray(moves) ? moves : [];
  if (!list.length) return { ok: true, updated: 0 };

  const current = await listCategories();
  const flat = current.items || [];
  for (const m of list) {
    const nextParent = m.parentId === undefined ? undefined : m.parentId || null;
    if (nextParent && wouldCycle(flat, m.id, nextParent)) {
      return { ok: false, error: 'Không chuyển được vào thư mục con của chính nó' };
    }
  }

  const sb = getSupabase();
  if (sb && isConfigured()) {
    for (const m of list) {
      const updates = { updated_at: new Date().toISOString() };
      if (m.sortOrder != null) updates.sort_order = Number(m.sortOrder) || 0;
      if (m.parentId !== undefined) updates.parent_id = m.parentId || null;
      const { error } = await sb.from('doc_categories').update(updates).eq('id', m.id);
      if (error) console.warn('[taxonomy] reorder:', error.message);
    }
  }

  const local = ensureLocal();
  for (const m of list) {
    const idx = local.categories.findIndex((c) => c.id === m.id);
    if (idx < 0) continue;
    if (m.sortOrder != null) local.categories[idx].sort_order = Number(m.sortOrder) || 0;
    if (m.parentId !== undefined) local.categories[idx].parent_id = m.parentId || null;
    local.categories[idx].updated_at = new Date().toISOString();
  }
  writeLocal(local);
  return { ok: true, updated: list.length };
}

async function deleteCategory(id) {
  const sb = getSupabase();
  if (sb && isConfigured()) {
    const { error } = await sb.from('doc_categories').delete().eq('id', id);
    if (!error) return { ok: true, source: 'supabase' };
  }
  const local = ensureLocal();
  const removeIds = new Set([id]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const c of local.categories) {
      if (c.parent_id && removeIds.has(c.parent_id) && !removeIds.has(c.id)) {
        removeIds.add(c.id);
        changed = true;
      }
    }
  }
  local.categories = local.categories.filter((c) => !removeIds.has(c.id));
  for (const [docId, catId] of Object.entries(local.docCategoryMap || {})) {
    if (removeIds.has(catId)) delete local.docCategoryMap[docId];
  }
  writeLocal(local);
  return { ok: true, source: 'local' };
}

function setLocalDocCategory(docId, categoryId) {
  const local = ensureLocal();
  if (!local.docCategoryMap) local.docCategoryMap = {};
  if (categoryId) local.docCategoryMap[docId] = categoryId;
  else delete local.docCategoryMap[docId];
  writeLocal(local);
}

function getLocalDocCategory(docId) {
  const local = ensureLocal();
  return local.docCategoryMap?.[docId] || null;
}

function getAllLocalDocMap() {
  return ensureLocal().docCategoryMap || {};
}

function foldVi(s) {
  return String(s || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

/**
 * Gợi ý chuyên mục từ metadata / câu hỏi.
 */
function suggestCategoryId(flat, { linhVuc, loaiVanBan, fileName, text } = {}) {
  const hay = foldVi(
    [linhVuc, loaiVanBan, fileName, String(text || '').slice(0, 400)].filter(Boolean).join(' ')
  );

  const rules = [
    { re: /thue|gtgt|thu nhap|hai quan|ngan sach/, slug: 'thue-tai-chinh' },
    { re: /lao dong|bhxh|bao hiem|luong|nghi phep/, slug: 'lao-dong-bhxh' },
    { re: /dat dai|nha o|xay dung|giay phep xay/, slug: 'dat-dai-xay-dung' },
    { re: /doanh nghiep|dang ky kinh doanh|giay phep/, slug: 'doanh-nghiep' },
    { re: /cccd|can cuoc|cu tru|ho tich/, slug: 'hanh-chinh-cong' },
    { re: /khieu nai|to cao|tu phap/, slug: 'tu-phap' },
    { re: /thu tuc|hanh chinh/, slug: 'hanh-chinh-cong' },
  ];

  for (const rule of rules) {
    if (!rule.re.test(hay)) continue;
    const parent = flat.find((c) => c.slug === rule.slug);
    if (!parent) continue;
    const child = flat.find(
      (c) => c.parent_id === parent.id && hay.includes(foldVi(c.name).slice(0, 6))
    );
    if (/cccd|can cuoc|cu tru/.test(hay)) {
      const cm = flat.find((c) => c.slug === 'can-cuoc-cu-tru');
      if (cm) return cm.id;
    }
    if (/bhxh|bao hiem/.test(hay)) {
      const cm = flat.find((c) => c.slug === 'bao-hiem-xa-hoi');
      if (cm) return cm.id;
    }
    if (/thue thu nhap|tncn/.test(hay)) {
      const cm = flat.find((c) => c.slug === 'thue-thu-nhap');
      if (cm) return cm.id;
    }
    if (child) return child.id;
    const firstChild = flat
      .filter((c) => c.parent_id === parent.id)
      .sort((a, b) => a.sort_order - b.sort_order)[0];
    return firstChild?.id || parent.id;
  }

  const uncategorized = flat.find((c) => c.slug === 'chua-phan-loai');
  return uncategorized?.id || null;
}

module.exports = {
  listCategories,
  createCategory,
  updateCategory,
  deleteCategory,
  reorderCategories,
  wouldCycle,
  buildCategoryTree,
  pathForCategory,
  suggestCategoryId,
  setLocalDocCategory,
  getLocalDocCategory,
  getAllLocalDocMap,
  ensureLocal,
  slugify,
  DEFAULT_TREE,
  LOCAL_PATH,
};
