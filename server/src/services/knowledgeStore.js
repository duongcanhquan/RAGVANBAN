/**
 * Kho tình huống mẫu — Supabase hoặc file JSON local (cá nhân / offline).
 */

const fs = require('fs');
const path = require('path');
const { randomUUID } = require('crypto');
const { getSupabase, isConfigured } = require('./supabase');

const LOCAL_PATH = path.resolve(__dirname, '../../data/scenarios.json');

function ensureLocalFile() {
  try {
    if (fs.existsSync(LOCAL_PATH)) return;
  } catch {
    return;
  }
  if (process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME) return;
  const dir = path.dirname(LOCAL_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    LOCAL_PATH,
    JSON.stringify({ scenarios: [] }, null, 2),
    'utf8'
  );
}

function isDemoScenario(s = {}) {
  if (String(s.created_by || '') === 'system') return true;
  return String(s.title || '').trim() === 'Xin cấp lại CCCD bị mất';
}

function withoutDemoScenarios(items) {
  return (items || []).filter((s) => !isDemoScenario(s));
}

function readLocal() {
  try {
    if (!fs.existsSync(LOCAL_PATH)) return { scenarios: [] };
    return JSON.parse(fs.readFileSync(LOCAL_PATH, 'utf8'));
  } catch {
    return { scenarios: [] };
  }
}

function writeLocal(data) {
  if (process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME) {
    const err = new Error('Vercel không ghi được scenarios.json. Cần Supabase.');
    err.code = 'LOCAL_FS_READONLY';
    throw err;
  }
  ensureLocalFile();
  fs.writeFileSync(LOCAL_PATH, JSON.stringify(data, null, 2), 'utf8');
}

async function listScenarios({ limit = 100, q = '' } = {}) {
  const sb = getSupabase();
  if (sb && isConfigured()) {
    let query = sb
      .from('scenarios')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(limit);
    if (q) {
      query = query.or(
        `title.ilike.%${q}%,situation.ilike.%${q}%,suggested_question.ilike.%${q}%`
      );
    }
    const { data, error } = await query;
    if (!error) return { ok: true, source: 'supabase', items: withoutDemoScenarios(data || []) };
    console.warn('[scenarios] supabase list:', error.message);
  }

  let items = readLocal().scenarios || [];
  if (q) {
    const needle = q.toLowerCase();
    items = items.filter((s) =>
      [s.title, s.situation, s.suggested_question, ...(s.tags || [])]
        .join(' ')
        .toLowerCase()
        .includes(needle)
    );
  }
  return { ok: true, source: 'local', items: withoutDemoScenarios(items).slice(0, limit) };
}

async function createScenario(input) {
  const row = {
    title: String(input.title || '').trim().slice(0, 200),
    situation: String(input.situation || '').trim().slice(0, 8000),
    suggested_question: String(input.suggested_question || input.suggestedQuestion || '').trim().slice(0, 2000),
    sample_answer: String(input.sample_answer || input.sampleAnswer || '').trim().slice(0, 20000),
    tags: Array.isArray(input.tags)
      ? input.tags.map((t) => String(t).trim()).filter(Boolean).slice(0, 20)
      : String(input.tags || '')
          .split(/[,;]/)
          .map((t) => t.trim())
          .filter(Boolean)
          .slice(0, 20),
    created_by: String(input.created_by || input.createdBy || 'anonymous').slice(0, 120),
  };

  if (!row.title || !row.situation) {
    return { ok: false, error: 'Cần title và situation' };
  }

  const sb = getSupabase();
  if (sb && isConfigured()) {
    const { data, error } = await sb
      .from('scenarios')
      .insert({ ...row, use_count: 0 })
      .select('*')
      .single();
    if (!error) return { ok: true, source: 'supabase', item: data };
    console.warn('[scenarios] supabase insert:', error.message);
  }

  const store = readLocal();
  const item = {
    id: randomUUID(),
    ...row,
    use_count: 0,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
  store.scenarios.unshift(item);
  writeLocal(store);
  return { ok: true, source: 'local', item };
}

async function deleteScenario(id) {
  const sb = getSupabase();
  if (sb && isConfigured()) {
    const { error } = await sb.from('scenarios').delete().eq('id', id);
    if (!error) return { ok: true, source: 'supabase' };
  }
  const store = readLocal();
  store.scenarios = (store.scenarios || []).filter((s) => s.id !== id);
  writeLocal(store);
  return { ok: true, source: 'local' };
}

async function bumpUse(id) {
  const sb = getSupabase();
  if (sb && isConfigured()) {
    const { data: cur } = await sb.from('scenarios').select('use_count').eq('id', id).maybeSingle();
    if (cur) {
      await sb
        .from('scenarios')
        .update({ use_count: (cur.use_count || 0) + 1, updated_at: new Date().toISOString() })
        .eq('id', id);
    }
  }
  const store = readLocal();
  const item = (store.scenarios || []).find((s) => s.id === id);
  if (item) {
    item.use_count = (item.use_count || 0) + 1;
    item.updated_at = new Date().toISOString();
    writeLocal(store);
    return { ok: true, item };
  }
  return { ok: true };
}

/**
 * Tìm tình huống liên quan câu hỏi (keyword đơn giản) để làm giàu context.
 */
async function findRelevantScenarios(question, limit = 2) {
  const { items } = await listScenarios({ limit: 80 });
  const tokens = String(question || '')
    .toLowerCase()
    .split(/\s+/)
    .filter((t) => t.length > 2);
  if (!tokens.length) return [];

  const scored = items
    .map((s) => {
      const hay = [s.title, s.situation, s.suggested_question, ...(s.tags || [])]
        .join(' ')
        .toLowerCase();
      let score = 0;
      for (const t of tokens) {
        if (hay.includes(t)) score += 1;
      }
      return { s, score };
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((x) => x.s);

  return scored;
}

function formatScenariosForPrompt(scenarios) {
  if (!scenarios?.length) return '';
  return scenarios
    .map((s, i) => {
      const q = s.suggested_question || s.situation || '';
      const a = s.sample_answer || '';
      return `[Bài mẫu ${i + 1}] ${s.title}
Cách hỏi: ${q}
${a ? `Cách trả lời mẫu (học bố cục, KHÔNG copy số liệu nếu khác context lần này):\n${a}` : 'Chưa có câu trả lời mẫu.'}`;
    })
    .join('\n\n');
}

module.exports = {
  listScenarios,
  createScenario,
  deleteScenario,
  bumpUse,
  findRelevantScenarios,
  formatScenariosForPrompt,
  LOCAL_PATH,
};
