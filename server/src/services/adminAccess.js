/**
 * Quyền upload theo chuyên mục: grant một node = được cả cây con.
 */

function collectDescendantIds(flat, rootIds) {
  const byParent = new Map();
  for (const c of flat || []) {
    const p = c.parent_id || '';
    if (!byParent.has(p)) byParent.set(p, []);
    byParent.get(p).push(c.id);
  }
  const allowed = new Set((rootIds || []).filter(Boolean));
  const stack = [...allowed];
  while (stack.length) {
    const id = stack.pop();
    for (const child of byParent.get(id) || []) {
      if (!allowed.has(child)) {
        allowed.add(child);
        stack.push(child);
      }
    }
  }
  return allowed;
}

function isSuperAdmin(admin) {
  return Boolean(admin && admin.is_active && admin.role === 'super_admin');
}

function canUseCategory(admin, categoryId) {
  if (!admin || !admin.is_active) return false;
  if (isSuperAdmin(admin)) return true;
  if (!categoryId) return false;
  const set = admin.allowedCategoryIds;
  if (set instanceof Set) return set.has(categoryId);
  return Array.isArray(set) && set.includes(categoryId);
}

function assertCanUseCategory(admin, categoryId) {
  if (isSuperAdmin(admin)) return;
  if (!categoryId) {
    const err = new Error('Chọn chuyên mục / hạng mục / ngành trước khi nạp tài liệu');
    err.status = 403;
    throw err;
  }
  if (!canUseCategory(admin, categoryId)) {
    const err = new Error('Bạn không được upload vào chuyên mục này');
    err.status = 403;
    throw err;
  }
}

function assertCanManageCategory(admin, categoryId, { creatingRoot = false } = {}) {
  if (!admin || !admin.is_active) {
    const err = new Error('Không có quyền quản trị');
    err.status = 403;
    throw err;
  }
  if (isSuperAdmin(admin)) return;
  if (creatingRoot || !categoryId) {
    const err = new Error('Chỉ super-admin được tạo chuyên mục gốc');
    err.status = 403;
    throw err;
  }
  if (!canUseCategory(admin, categoryId)) {
    const err = new Error('Bạn không được quản lý chuyên mục này');
    err.status = 403;
    throw err;
  }
}

function serializeAdmin(admin) {
  if (!admin) return null;
  const ids = admin.allowedCategoryIds;
  return {
    id: admin.id,
    email: admin.email,
    display_name: admin.display_name,
    role: admin.role,
    is_active: admin.is_active,
    must_change_password: Boolean(admin.must_change_password),
    grantCategoryIds: admin.grantCategoryIds || [],
    allowedCategoryIds: ids instanceof Set ? [...ids] : ids || [],
  };
}

/** Super-admin không cần load cả cây chuyên mục trên mỗi request. */
function attachCategoryAccess(profile, grantCategoryIds, categoryItems) {
  const grant = (grantCategoryIds || []).filter(Boolean);
  if (isSuperAdmin(profile)) {
    return { ...profile, grantCategoryIds: grant, allowedCategoryIds: new Set() };
  }
  return {
    ...profile,
    grantCategoryIds: grant,
    allowedCategoryIds: collectDescendantIds(categoryItems || [], grant),
  };
}

module.exports = {
  collectDescendantIds,
  isSuperAdmin,
  canUseCategory,
  assertCanUseCategory,
  assertCanManageCategory,
  serializeAdmin,
  attachCategoryAccess,
};
