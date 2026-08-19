/**
 * /api/quantri — trạng thái, bootstrap, hồ sơ, quản lý cán bộ.
 */

const express = require('express');
const { isConfigured } = require('../services/supabase');
const { requireAdmin, requireSuperAdmin } = require('../middleware/requireAdmin');
const { serializeAdmin } = require('../services/adminAccess');
const {
  countProfiles,
  bootstrapSuperAdmin,
  listAdmins,
  createAdmin,
  updateAdmin,
  deleteAdmin,
  markPasswordChanged,
} = require('../services/quantriStore');
const { listCategories } = require('../services/taxonomyStore');

const router = express.Router();

router.get('/status', async (_req, res, next) => {
  try {
    const n = isConfigured() ? await countProfiles() : 0;
    res.json({
      supabase: isConfigured(),
      needsBootstrap: isConfigured() && n === 0,
      hasPasswordEnv: Boolean(process.env.SUPER_ADMIN_PASSWORD),
    });
  } catch (err) {
    next(err);
  }
});

router.post('/bootstrap', async (_req, res, next) => {
  try {
    const result = await bootstrapSuperAdmin();
    res.status(result.ok ? 200 : 400).json(result);
  } catch (err) {
    next(err);
  }
});

router.get('/me', requireAdmin, async (req, res) => {
  res.json({ ok: true, me: serializeAdmin(req.admin) });
});

router.post('/me/password-changed', requireAdmin, async (req, res, next) => {
  try {
    const admin = await markPasswordChanged(req.admin.id);
    res.json({ ok: true, me: serializeAdmin(admin) });
  } catch (err) {
    next(err);
  }
});

router.get('/categories', requireAdmin, async (_req, res, next) => {
  try {
    const cats = await listCategories();
    res.json(cats);
  } catch (err) {
    next(err);
  }
});

router.get('/users', requireSuperAdmin, async (_req, res, next) => {
  try {
    const items = await listAdmins();
    res.json({ ok: true, items });
  } catch (err) {
    next(err);
  }
});

router.post('/users', requireSuperAdmin, async (req, res, next) => {
  try {
    const admin = await createAdmin({
      email: req.body?.email,
      password: req.body?.password,
      display_name: req.body?.display_name,
      role: req.body?.role,
      categoryIds: req.body?.categoryIds,
      is_active: req.body?.is_active,
    });
    res.status(201).json({ ok: true, me: serializeAdmin(admin) });
  } catch (err) {
    next(err);
  }
});

router.patch('/users/:id', requireSuperAdmin, async (req, res, next) => {
  try {
    const admin = await updateAdmin(req.params.id, req.body || {});
    res.json({ ok: true, me: serializeAdmin(admin) });
  } catch (err) {
    next(err);
  }
});

router.delete('/users/:id', requireSuperAdmin, async (req, res, next) => {
  try {
    const result = await deleteAdmin(req.params.id, req.admin.id);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
