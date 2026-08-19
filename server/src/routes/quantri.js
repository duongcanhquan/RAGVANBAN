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
const { r2Status, pingR2Write } = require('../services/r2');
const {
  setFlags,
  saveServiceAccount,
  getN8nSecret,
  getIntegrationHealth,
  ensureN8nSecret,
  listDriveSources,
  upsertDriveSource,
  removeDriveSource,
  sourcesVisibleTo,
} = require('../services/integrations');
const {
  ensureBrain,
  publicBrainPayload,
  saveBrain,
  sanitizeBrain,
  providerCreds,
} = require('../services/llmConfig');
const { getLLM, getEmbeddings, hasLiveKeys, listAvailableProviders } = require('../services/llmFactory');
const {
  getVoice,
  setVoice,
  applyPreset,
  publicVoicePayload,
  composeSystemPrompt,
} = require('../services/voiceConfig');
const { getTalk, setTalk, publicTalkPayload } = require('../services/voiceTalk');
const { getRagConfig, setRagConfig, publicRagPayload } = require('../services/ragConfig');
const { reingestDocument, reingestAll } = require('../services/reingest');

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

router.put('/quick-keywords', requireSuperAdmin, async (req, res, next) => {
  try {
    res.json(await setQuickKeywords(req.body || {}));
  } catch (err) {
    next(err);
  }
});

router.get('/integrations', requireAdmin, async (req, res, next) => {
  try {
    const isSuper = req.admin.role === 'super_admin';
    const health = await getIntegrationHealth();
    const sources = await listDriveSources();
    res.json({
      ok: true,
      r2: r2Status(),
      drive: {
        enabled: health.drive.enabled,
        hasKey: health.drive.hasKey,
        email: health.drive.email,
        source: health.drive.source,
        on: health.drive.on,
        reason: health.drive.reason,
      },
      n8n: {
        enabled: health.n8n.enabled,
        secretConfigured: health.n8n.hasSecret,
        secret: isSuper ? (await getN8nSecret()).secret || null : null,
        webhookPath: '/api/webhooks/n8n',
        on: health.n8n.on,
        reason: health.n8n.reason,
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

router.get('/brain', requireSuperAdmin, async (_req, res, next) => {
  try {
    await ensureBrain();
    res.json({
      ok: true,
      ragReady: hasLiveKeys(),
      status: listAvailableProviders(),
      ...publicBrainPayload(),
    });
  } catch (err) {
    next(err);
  }
});

router.put('/brain', requireSuperAdmin, async (req, res, next) => {
  try {
    const saved = await saveBrain(req.body || {});
    res.json({
      ok: true,
      ragReady: hasLiveKeys(),
      status: listAvailableProviders(),
      config: sanitizeBrain(saved),
      ...publicBrainPayload(),
    });
  } catch (err) {
    next(err);
  }
});

router.post('/brain/test', requireSuperAdmin, async (req, res, next) => {
  try {
    await ensureBrain();
    const purpose = String(req.body?.purpose || 'chat');
    const provider = String(req.body?.provider || '').trim();
    if (!provider) {
      res.status(400).json({ ok: false, error: 'Thiếu provider' });
      return;
    }
    const creds = providerCreds(provider);
    if (!creds.hasKey) {
      res.status(400).json({ ok: false, error: `Chưa có API key cho ${creds.name || provider}` });
      return;
    }
    if (purpose === 'embedding') {
      const emb = getEmbeddings(provider);
      const vec = await emb.embedQuery('thử nghiệm embedding văn bản hành chính');
      res.json({ ok: true, purpose, provider, dims: Array.isArray(vec) ? vec.length : 0 });
      return;
    }
    const llm = getLLM(provider, { temperature: 0, streaming: false });
    const out = await llm.invoke('Trả lời đúng một từ: OK');
    const text = typeof out?.content === 'string' ? out.content : JSON.stringify(out?.content || out);
    res.json({ ok: true, purpose, provider, sample: String(text).slice(0, 240) });
  } catch (err) {
    res.status(400).json({
      ok: false,
      error: err.message || 'Gọi thử thất bại',
      provider: req.body?.provider,
      purpose: req.body?.purpose,
    });
  }
});

router.get('/voice', requireSuperAdmin, async (_req, res, next) => {
  try {
    const voice = await getVoice();
    res.json({ ok: true, ...publicVoicePayload(voice) });
  } catch (err) {
    next(err);
  }
});

router.put('/voice', requireSuperAdmin, async (req, res, next) => {
  try {
    const body = req.body || {};
    const next = body.preset && !body.role ? applyPreset(body.preset, await getVoice()) : body;
    const saved = await setVoice(next);
    res.json({
      ok: true,
      source: saved.source,
      ...publicVoicePayload(saved.voice),
      preview: {
        lookup: composeSystemPrompt('lookup', saved.voice),
        advise: composeSystemPrompt('advise', saved.voice),
        compare: composeSystemPrompt('compare', saved.voice),
      },
    });
  } catch (err) {
    next(err);
  }
});

router.get('/voice-talk', requireSuperAdmin, async (_req, res, next) => {
  try {
    const talk = await getTalk();
    res.json({ ok: true, talk: publicTalkPayload(talk) });
  } catch (err) {
    next(err);
  }
});

router.put('/voice-talk', requireSuperAdmin, async (req, res, next) => {
  try {
    const saved = await setTalk(req.body || {});
    res.json({ ok: true, source: saved.source, talk: publicTalkPayload(saved.talk) });
  } catch (err) {
    next(err);
  }
});

router.get('/rag', requireSuperAdmin, async (_req, res, next) => {
  try {
    const rag = await getRagConfig();
    res.json({ ok: true, rag, public: publicRagPayload(rag), r2: r2Status() });
  } catch (err) {
    next(err);
  }
});

router.put('/rag', requireSuperAdmin, async (req, res, next) => {
  try {
    const saved = await setRagConfig(req.body || {});
    res.json({ ok: true, source: saved.source, rag: saved.rag });
  } catch (err) {
    next(err);
  }
});

router.post('/rag/reindex', requireAdmin, async (req, res, next) => {
  try {
    const id = String(req.body?.documentId || req.body?.id || '').trim();
    if (!id) {
      res.status(400).json({ ok: false, error: 'Thiếu documentId' });
      return;
    }
    const result = await reingestDocument(req.admin, id);
    res.json({ ok: true, ...result });
  } catch (err) {
    next(err);
  }
});

router.post('/rag/reindex-all', requireSuperAdmin, async (req, res, next) => {
  try {
    const result = await reingestAll(req.admin, { limit: req.body?.limit, offset: req.body?.offset });
    res.json(result);
  } catch (err) {
    next(err);
  }
});

router.post('/integrations/r2-ping', requireSuperAdmin, async (_req, res, next) => {
  try {
    res.json(await pingR2Write());
  } catch (err) {
    next(err);
  }
});

module.exports = router;
