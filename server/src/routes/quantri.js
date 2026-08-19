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
const { getQuickKeywords, setQuickKeywords } = require('../services/appSettings');
const { isR2Configured } = require('../services/r2');
const {
  getFlags,
  setFlags,
  getSavedServiceAccount,
  saveServiceAccount,
  getN8nSecret,
  ensureN8nSecret,
  listDriveSources,
  upsertDriveSource,
  removeDriveSource,
  sourcesVisibleTo,
} = require('../services/integrations');

const router = express.Router();

router.get('/status', async (_req, res, next) => {
  try {
    const counted = isConfigured() ? await countProfiles() : { count: 0, error: null };
    const password = String(process.env.SUPER_ADMIN_PASSWORD || '');
    res.json({
      supabase: isConfigured(),
      needsBootstrap: isConfigured() && !counted.error && counted.count === 0,
      profileCount: counted.count,
      profileError: counted.error,
      hasPasswordEnv: Boolean(password) && !password.includes('your-'),
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

router.get('/quick-keywords', requireAdmin, async (_req, res, next) => {
  try {
    res.json(await getQuickKeywords());
  } catch (err) {
    next(err);
  }
});

router.put('/quick-keywords', requireAdmin, async (req, res, next) => {
  try {
    res.json(await setQuickKeywords(req.body || {}));
  } catch (err) {
    next(err);
  }
});

router.get('/integrations', requireAdmin, async (req, res, next) => {
  try {
    const [flags, sa, n8n, sources] = await Promise.all([
      getFlags(),
      getSavedServiceAccount(),
      getN8nSecret(),
      listDriveSources(),
    ]);
    const isSuper = req.admin.role === 'super_admin';
    res.json({
      ok: true,
      r2: isR2Configured(),
      drive: {
        enabled: flags.driveEnabled,
        hasKey: Boolean(sa.json),
        email: sa.json?.client_email || null,
        source: sa.source,
      },
      n8n: {
        enabled: flags.n8nEnabled,
        secretConfigured: Boolean(n8n.secret),
        secret: isSuper && n8n.secret ? n8n.secret : null,
        webhookPath: '/api/webhooks/n8n',
      },
      sources: sourcesVisibleTo(req.admin, sources),
    });
  } catch (err) {
    next(err);
  }
});

router.patch('/integrations/flags', requireSuperAdmin, async (req, res, next) => {
  try {
    const flags = await setFlags(req.body || {}, req.admin);
    res.json({ ok: true, ...flags });
  } catch (err) {
    next(err);
  }
});

router.put('/integrations/google-sa', requireSuperAdmin, async (req, res, next) => {
  try {
    const result = await saveServiceAccount(req.body?.json || req.body, req.admin);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

router.post('/integrations/n8n-secret', requireSuperAdmin, async (req, res, next) => {
  try {
    const result = await ensureN8nSecret(req.admin);
    res.json({ ok: true, secret: result.secret, source: result.source });
  } catch (err) {
    next(err);
  }
});

router.post('/integrations/drive-sources', requireAdmin, async (req, res, next) => {
  try {
    const row = await upsertDriveSource(req.admin, req.body || {});
    res.status(201).json({ ok: true, item: row });
  } catch (err) {
    next(err);
  }
});

router.patch('/integrations/drive-sources/:id', requireAdmin, async (req, res, next) => {
  try {
    const row = await upsertDriveSource(req.admin, { ...(req.body || {}), id: req.params.id });
    res.json({ ok: true, item: row });
  } catch (err) {
    next(err);
  }
});

router.delete('/integrations/drive-sources/:id', requireAdmin, async (req, res, next) => {
  try {
    res.json(await removeDriveSource(req.admin, req.params.id));
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
