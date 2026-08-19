/**
 * Xác thực JWT Supabase cho /quantri và API ghi.
 */

const { getSupabase, isConfigured } = require('../services/supabase');
const { loadAdminById } = require('../services/quantriStore');
const { isSuperAdmin } = require('../services/adminAccess');

function bearerToken(req) {
  const h = String(req.headers.authorization || '');
  const m = h.match(/^Bearer\s+(.+)$/i);
  return m ? m[1].trim() : '';
}

async function requireAdmin(req, res, next) {
  try {
    if (!isConfigured()) {
      res.status(503).json({ error: 'Chưa cấu hình Supabase — không thể xác thực quản trị' });
      return;
    }
    const token = bearerToken(req);
    if (!token) {
      res.status(401).json({ error: 'Chưa đăng nhập' });
      return;
    }
    const sb = getSupabase();
    const { data, error } = await sb.auth.getUser(token);
    if (error || !data?.user) {
      res.status(401).json({ error: 'Phiên đăng nhập hết hạn' });
      return;
    }
    const admin = await loadAdminById(data.user.id);
    if (!admin || !admin.is_active) {
      res.status(403).json({ error: 'Tài khoản không có quyền quản trị' });
      return;
    }
    req.admin = admin;
    req.authUser = data.user;
    next();
  } catch (err) {
    console.error('[requireAdmin]', err);
    res.status(500).json({ error: err.message || 'Lỗi xác thực' });
  }
}

function requireSuperAdmin(req, res, next) {
  requireAdmin(req, res, () => {
    if (!isSuperAdmin(req.admin)) {
      res.status(403).json({ error: 'Chỉ super-admin được thao tác này' });
      return;
    }
    next();
  });
}

module.exports = { requireAdmin, requireSuperAdmin, bearerToken };
