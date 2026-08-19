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
  getFlags,
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
  pineconeCreds,
  getBrainSync,
} = require('../services/llmConfig');
const { getLLM, getEmbeddings, hasLiveKeys, listAvailableProviders, liveKeysReport } = require('../services/llmFactory');
const { getPinecone } = require('../services/clients');
const {
  embeddingAlignmentReport,
  getPineconeIndexDimension,
  peekPineconeIndexDimension,
  expectedEmbeddingDim,
} = require('../services/embeddingDim');
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

async function embeddingDimPayload({ waitForIndex = false } = {}) {
  try {
    const creds = providerCreds(getBrainSync().embeddingPrimary || 'openai');
    const pc = pineconeCreds();
    let indexDim = peekPineconeIndexDimension(pc.indexName);
    if (indexDim == null && waitForIndex) {
      indexDim = await getPineconeIndexDimension(getPinecone(), pc.indexName);
    } else if (indexDim == null) {
      getPineconeIndexDimension(getPinecone(), pc.indexName).catch(() => {});
    }
    return embeddingAlignmentReport({ model: creds.embeddingModel, indexDim });
  } catch {
    return embeddingAlignmentReport({});
  }
}

function embeddingDimPayloadFast() {
  try {
    const creds = providerCreds(getBrainSync().embeddingPrimary || 'openai');
    const pc = pineconeCreds();
    getPineconeIndexDimension(getPinecone(), pc.indexName).catch(() => {});
    return embeddingAlignmentReport({
      model: creds.embeddingModel,
      indexDim: peekPineconeIndexDimension(pc.indexName),
    });
  } catch {
    return embeddingAlignmentReport({});
  }
}

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
    const [health, sources] = await Promise.all([getIntegrationHealth(), listDriveSources()]);
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

router.post('/integrations/n8n-ping', requireSuperAdmin, async (_req, res, next) => {
  try {
    const health = await getIntegrationHealth();
    if (!health.n8n.enabled) {
      res.status(400).json({
        ok: false,
        error: 'Webhook n8n đang tắt. Bật công tắc rồi thử lại.',
      });
      return;
    }
    if (!health.n8n.hasSecret) {
      res.status(400).json({ ok: false, error: 'Chưa có secret. Bấm Tạo secret.' });
      return;
    }
    res.json({
      ok: true,
      webhookReady: true,
      n8nOn: health.n8n.on,
      hint:
        'App sẵn sàng nhận webhook. n8n Cloud phải Import workflow, dán URL+secret, bật Active. Không cần n8n nếu bấm Đồng bộ Drive ngay bên dưới.',
    });
  } catch (err) {
    next(err);
  }
});

router.post('/integrations/drive-sync', requireSuperAdmin, async (req, res, next) => {
  try {
    const flags = await getFlags();
    if (!flags.driveEnabled) {
      res.status(403).json({ ok: false, error: 'Google Drive đang tắt trong Cài đặt' });
      return;
    }
    const { syncDriveFolder } = require('../services/driveIngest');
    const result = await syncDriveFolder({
      limit: Math.min(20, Number(req.body?.limit) || 8),
      folderId: req.body?.folderId || null,
    });
    const failed = (result.results || []).filter((r) => r.ok === false);
    res.json({
      ok: failed.length === 0,
      ...result,
      failed: failed.length,
      error: failed[0]?.error,
    });
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
      missing: liveKeysReport().missing,
      embeddingDim: embeddingDimPayloadFast(),
      ...publicBrainPayload(),
    });
  } catch (err) {
    next(err);
  }
});

router.get('/brain/embedding-dim', requireSuperAdmin, async (_req, res, next) => {
  try {
    await ensureBrain();
    res.json({ ok: true, embeddingDim: await embeddingDimPayload({ waitForIndex: true }) });
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
      missing: liveKeysReport().missing,
      embeddingDim: await embeddingDimPayload({ waitForIndex: true }),
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
      const dims = Array.isArray(vec) ? vec.length : 0;
      const expected = expectedEmbeddingDim(creds.embeddingModel);
      const pc = pineconeCreds();
      const indexDim = await getPineconeIndexDimension(getPinecone(), pc.indexName);
      const align = embeddingAlignmentReport({ model: creds.embeddingModel, indexDim });
      res.json({
        ok: true,
        purpose,
        provider,
        dims,
        expectedDim: expected,
        indexDim,
        mismatch: Boolean(indexDim && dims && indexDim !== dims),
        hint: align.hint,
        fixHint: align.fixHint,
      });
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

router.get('/voice-talk', requireAdmin, async (_req, res, next) => {
  try {
    const talk = await getTalk();
    res.json({ ok: true, talk: publicTalkPayload(talk) });
  } catch (err) {
    next(err);
  }
});

router.put('/voice-talk', requireAdmin, async (req, res, next) => {
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

router.get('/skills', requireAdmin, async (_req, res, next) => {
  try {
    const { getSkills } = require('../services/skillStore');
    const { getLearnState } = require('../services/learnLoop');
    const { listScenarios } = require('../services/knowledgeStore');
    const [items, learn, scenarios] = await Promise.all([
      getSkills(),
      getLearnState(),
      listScenarios({ limit: 40 }),
    ]);
    res.json({
      ok: true,
      items,
      learn,
      samples: scenarios.items || [],
      samplesSource: scenarios.source,
    });
  } catch (err) {
    next(err);
  }
});

router.put('/skills', requireSuperAdmin, async (req, res, next) => {
  try {
    const { saveSkills, upsertSkill, deleteSkill } = require('../services/skillStore');
    if (req.body?.deleteSlug) {
      const saved = await deleteSkill(req.body.deleteSlug);
      return res.json(saved);
    }
    if (req.body?.skill) {
      const saved = await upsertSkill(req.body.skill);
      return res.json(saved);
    }
    if (Array.isArray(req.body?.items)) {
      const saved = await saveSkills(req.body.items);
      return res.json(saved);
    }
    res.status(400).json({ ok: false, error: 'Thiếu skill hoặc items' });
  } catch (err) {
    next(err);
  }
});

router.post('/learn/run', requireSuperAdmin, async (_req, res, next) => {
  try {
    const { runDailyLearn } = require('../services/learnLoop');
    res.json(await runDailyLearn());
  } catch (err) {
    next(err);
  }
});

router.post('/learn/dismiss', requireSuperAdmin, async (req, res, next) => {
  try {
    const { dismissLearn } = require('../services/learnLoop');
    res.json(await dismissLearn(req.body?.id));
  } catch (err) {
    next(err);
  }
});

router.post('/learn/approve', requireSuperAdmin, async (req, res, next) => {
  try {
    const { approveLearn } = require('../services/learnLoop');
    const result = await approveLearn(req.body?.suggestion, {
      createdBy: req.admin?.email || 'admin',
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

module.exports = router;
