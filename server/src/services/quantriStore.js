/**
 * Hồ sơ quản trị + bootstrap super-admin từ env.
 * Role lưu admin_profiles (và app_metadata) — không tin user_metadata.
 */

const { getSupabase, isConfigured } = require('./supabase');
const { listCategories } = require('./taxonomyStore');
const { collectDescendantIds, serializeAdmin, attachCategoryAccess, isSuperAdmin } = require('./adminAccess');
const { invalidateAdminAuth } = require('./adminAuthCache');

const SUPER_EMAIL = () =>
  String(process.env.SUPER_ADMIN_EMAIL || 'quan.duong@caodangvietmy.edu.vn')
    .trim()
    .toLowerCase();

async function countProfiles() {
  const sb = getSupabase();
  if (!sb) return { count: 0, error: null, configured: false };
  const { count, error } = await sb.from('admin_profiles').select('id', { count: 'exact', head: true });
  if (error) {
    console.warn('[quantri] count profiles:', error.message);
    return { count: 0, error: error.message, configured: true };
  }
  return { count: count || 0, error: null, configured: true };
}

async function loadAdminById(userId) {
  const sb = getSupabase();
  if (!sb || !userId) return null;
  const { data: profile, error } = await sb.from('admin_profiles').select('*').eq('id', userId).maybeSingle();
  if (error) throw error;
  if (!profile) return null;

  if (isSuperAdmin(profile)) {
    return attachCategoryAccess(profile, [], []);
  }

  const { data: grants, error: gErr } = await sb
    .from('admin_category_grants')
    .select('category_id')
    .eq('user_id', userId);
  if (gErr) throw gErr;

  const grantCategoryIds = (grants || []).map((g) => g.category_id);
  const cats = await listCategories();
  return attachCategoryAccess(profile, grantCategoryIds, cats.items || []);
}

async function replaceGrants(userId, categoryIds) {
  const sb = getSupabase();
  const ids = [...new Set((categoryIds || []).filter(Boolean))];
  await sb.from('admin_category_grants').delete().eq('user_id', userId);
  if (!ids.length) return;
  const rows = ids.map((category_id) => ({ user_id: userId, category_id }));
  const { error } = await sb.from('admin_category_grants').insert(rows);
  if (error) throw error;
}

async function upsertProfile({ id, email, display_name, role, is_active, must_change_password }) {
  const sb = getSupabase();
  const row = {
    id,
    email: String(email).trim().toLowerCase(),
    display_name: display_name || String(email).split('@')[0],
    role: role === 'super_admin' ? 'super_admin' : 'editor',
    is_active: is_active !== false,
    must_change_password: must_change_password !== false,
    updated_at: new Date().toISOString(),
  };
  const { data, error } = await sb.from('admin_profiles').upsert(row, { onConflict: 'id' }).select('*').single();
  if (error) throw error;
  return data;
}

async function findAuthUserByEmail(sb, email) {
  const needle = String(email).trim().toLowerCase();
  let page = 1;
  for (;;) {
    const { data, error } = await sb.auth.admin.listUsers({ page, perPage: 200 });
    if (error) throw error;
    const users = data?.users || [];
    const found = users.find((u) => String(u.email || '').toLowerCase() === needle);
    if (found) return found;
    if (users.length < 200) return null;
    page += 1;
    if (page > 20) return null;
  }
}

async function bootstrapSuperAdmin() {
  if (!isConfigured()) {
    return { ok: false, error: 'Chưa cấu hình Supabase SERVICE_ROLE' };
  }
  const counted = await countProfiles();
  if (counted.error) {
    return {
      ok: false,
      error: `Không đọc được bảng admin_profiles (${counted.error}). Chạy supabase/setup-all.sql trong SQL Editor.`,
    };
  }
  if (counted.count > 0) {
    return { ok: true, skipped: true, message: 'Đã có tài khoản quản trị' };
  }

  const email = SUPER_EMAIL();
  const sb = getSupabase();
  let user = await findAuthUserByEmail(sb, email);
  if (!user) {
    const password = process.env.SUPER_ADMIN_PASSWORD;
    if (!password) {
      return {
        ok: false,
        error:
          'Thiếu SUPER_ADMIN_PASSWORD trên server (Vercel env). Thêm biến này (≥ 8 ký tự), Redeploy, rồi đăng nhập lại.',
      };
    }
    const created = await sb.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      app_metadata: { role: 'super_admin' },
    });
    if (created.error) {
      let msg = created.error.message;
      if (/pwned|leaked|weak|hibp|password/i.test(msg) && /leak|pwned|weak|compromised/i.test(msg)) {
        msg =
          'SUPER_ADMIN_PASSWORD quá yếu hoặc đã bị lộ (Supabase từ chối). Đặt mật khẩu mới ≥ 8 ký tự, Redeploy, rồi đăng nhập lại.';
      }
      return { ok: false, error: msg };
    }
    user = created.data.user;
  } else {
    // Không ghi đè mật khẩu đã đổi — chỉ xác nhận email + gắn role.
    await sb.auth.admin.updateUserById(user.id, {
      email_confirm: true,
      app_metadata: { ...(user.app_metadata || {}), role: 'super_admin' },
    });
  }

  await upsertProfile({
    id: user.id,
    email,
    display_name: 'Quản trị hệ thống',
    role: 'super_admin',
    is_active: true,
    must_change_password: true,
  });

  return { ok: true, created: true, email };
}

/** Auth đã vào được nhưng thiếu dòng admin_profiles — gắn super-admin đúng email env. */
async function ensureSuperAdminProfile(user) {
  const email = String(user?.email || '').trim().toLowerCase();
  if (!user?.id || email !== SUPER_EMAIL()) return null;
  const existing = await loadAdminById(user.id);
  if (existing) return existing;
  await upsertProfile({
    id: user.id,
    email,
    display_name: 'Quản trị hệ thống',
    role: 'super_admin',
    is_active: true,
    must_change_password: false,
  });
  return loadAdminById(user.id);
}

async function listAdmins() {
  const sb = getSupabase();
  const { data: profiles, error } = await sb
    .from('admin_profiles')
    .select('*')
    .order('created_at', { ascending: true });
  if (error) throw error;
  const { data: grants, error: gErr } = await sb.from('admin_category_grants').select('user_id, category_id');
  if (gErr) throw gErr;
  const cats = await listCategories();
  const byUser = new Map();
  for (const g of grants || []) {
    if (!byUser.has(g.user_id)) byUser.set(g.user_id, []);
    byUser.get(g.user_id).push(g.category_id);
  }
  return (profiles || []).map((p) => {
    const grantCategoryIds = byUser.get(p.id) || [];
    return serializeAdmin({
      ...p,
      grantCategoryIds,
      allowedCategoryIds: collectDescendantIds(cats.items || [], grantCategoryIds),
    });
  });
}

async function createAdmin({ email, password, display_name, role, categoryIds, is_active }) {
  const sb = getSupabase();
  const normalized = String(email || '').trim().toLowerCase();
  if (!normalized || !password) {
    const err = new Error('Thiếu email hoặc mật khẩu');
    err.status = 400;
    throw err;
  }
  const created = await sb.auth.admin.createUser({
    email: normalized,
    password,
    email_confirm: true,
    app_metadata: { role: role === 'super_admin' ? 'super_admin' : 'editor' },
  });
  if (created.error) {
    const err = new Error(created.error.message);
    err.status = 400;
    throw err;
  }
  const user = created.data.user;
  await upsertProfile({
    id: user.id,
    email: normalized,
    display_name: display_name || normalized.split('@')[0],
    role: role === 'super_admin' ? 'super_admin' : 'editor',
    is_active: is_active !== false,
    must_change_password: true,
  });
  if (role !== 'super_admin') {
    await replaceGrants(user.id, categoryIds);
  }
  invalidateAdminAuth(user.id);
  return loadAdminById(user.id);
}

async function updateAdmin(id, patch) {
  const sb = getSupabase();
  const current = await loadAdminById(id);
  if (!current) {
    const err = new Error('Không tìm thấy cán bộ');
    err.status = 404;
    throw err;
  }

  const role = patch.role === 'super_admin' ? 'super_admin' : patch.role === 'editor' ? 'editor' : current.role;
  const next = await upsertProfile({
    id,
    email: current.email,
    display_name: patch.display_name != null ? patch.display_name : current.display_name,
    role,
    is_active: patch.is_active != null ? Boolean(patch.is_active) : current.is_active,
    must_change_password:
      patch.must_change_password != null ? Boolean(patch.must_change_password) : current.must_change_password,
  });

  const authPatch = {
    app_metadata: { role },
  };
  if (patch.password) authPatch.password = patch.password;
  await sb.auth.admin.updateUserById(id, authPatch);

  if (role === 'editor' && Array.isArray(patch.categoryIds)) {
    await replaceGrants(id, patch.categoryIds);
  }
  if (role === 'super_admin') {
    await replaceGrants(id, []);
  }

  invalidateAdminAuth(id);
  return loadAdminById(next.id);
}

async function deleteAdmin(id, actorId) {
  if (id === actorId) {
    const err = new Error('Không thể xóa chính mình');
    err.status = 400;
    throw err;
  }
  const sb = getSupabase();
  await sb.from('admin_profiles').delete().eq('id', id);
  const { error } = await sb.auth.admin.deleteUser(id);
  if (error) throw error;
  invalidateAdminAuth(id);
  return { ok: true };
}

async function markPasswordChanged(id) {
  const sb = getSupabase();
  const { error } = await sb
    .from('admin_profiles')
    .update({ must_change_password: false, updated_at: new Date().toISOString() })
    .eq('id', id);
  if (error) throw error;
  invalidateAdminAuth(id);
  return loadAdminById(id);
}

module.exports = {
  SUPER_EMAIL,
  countProfiles,
  loadAdminById,
  bootstrapSuperAdmin,
  listAdmins,
  createAdmin,
  updateAdmin,
  deleteAdmin,
  markPasswordChanged,
  ensureSuperAdminProfile,
};
