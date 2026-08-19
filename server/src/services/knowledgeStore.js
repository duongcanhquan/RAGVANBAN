/**
 * Kho tình huống Q&A — admin/quản lý nhập sẵn theo hạng mục.
 * Supabase hoặc file JSON local.
 */

const fs = require('fs');
const path = require('path');
const { randomUUID } = require('crypto');
const { getSupabase, isConfigured } = require('./supabase');
const { expandCategoryIds } = require('./categoryScope');

const LOCAL_PATH = path.resolve(__dirname, '../../data/scenarios.json');

let omitCategoryColumn = false;

function ensureLocalFile() {
  try {
    if (fs.existsSync(LOCAL_PATH)) return;
  } catch {
    return;
  }
  if (process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME) return;
  const dir = path.dirname(LOCAL_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(LOCAL_PATH, JSON.stringify({ scenarios: [] }, null, 2), 'utf8');
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

function sanitizeSearch(q) {
  return String(q || '')
    .replace(/[%_,()]/g, ' ')
    .trim()
    .slice(0, 120);
}

function buildScenarioRow(input = {}) {
  const question = String(
    input.suggested_question || input.suggestedQuestion || input.question || ''
  )
    .trim()
    .slice(0, 2000);
  const answer = String(input.sample_answer || input.sampleAnswer || input.answer || '')
    .trim()
    .slice(0, 20000);
  const title = String(input.title || question)
    .trim()
    .slice(0, 200);
  const situation = String(input.situation || question)
    .trim()
    .slice(0, 8000);
  const categoryId = String(input.category_id || input.categoryId || '').trim() || null;
  const tags = Array.isArray(input.tags)
    ? input.tags.map((t) => String(t).trim()).filter(Boolean).slice(0, 20)
    : String(input.tags || '')
        .split(/[,;]/)
        .map((t) => t.trim())
        .filter(Boolean)
        .slice(0, 20);

  return {
    title,
    situation,
    suggested_question: question,
    sample_answer: answer,
    tags,
    category_id: categoryId,
    created_by: String(input.created_by || input.createdBy || 'anonymous').slice(0, 120),
  };
}

function presentScenario(item = {}) {
  const question = item.suggested_question || item.question || '';
  const answer = item.sample_answer || item.answer || '';
  return {
    ...item,
    question,
    answer,
    category_id: item.category_id || null,
  };
}

function matchesQuery(item, needle) {
  if (!needle) return true;
  return [item.title, item.situation, item.suggested_question, item.sample_answer, ...(item.tags || [])]
    .join(' ')
    .toLowerCase()
    .includes(needle);
}

function filterScenarioItems(items, { q = '', categoryIds = [] } = {}) {
  const needle = String(q || '').toLowerCase().trim();
  const cats = new Set((categoryIds || []).map(String).filter(Boolean));
  return (items || []).filter((s) => {
    if (cats.size) {
      const cid = String(s.category_id || '');
      if (!cid || !cats.has(cid)) return false;
    }
    return matchesQuery(s, needle);
  });
}

async function expandCategoryFilter(categoryId) {
  const id = String(categoryId || '').trim();
  if (!id) return [];
  try {
    const { listCategories } = require('./taxonomyStore');
    const cats = await listCategories();
    return expandCategoryIds(cats.items || [], [id]);
  } catch {
    return [id];
  }
}

function isMissingCategoryColumn(error) {
  const msg = String(error?.message || error || '').toLowerCase();
  return msg.includes('category_id') && (msg.includes('column') || msg.includes('schema cache') || msg.includes('does not exist'));
}

async function listScenarios({ limit = 100, q = '', categoryId = '' } = {}) {
  const needle = sanitizeSearch(q);
  const categoryIds = await expandCategoryFilter(categoryId);
  const sb = getSupabase();
  if (sb && isConfigured()) {
    let query = sb.from('scenarios').select('*').order('created_at', { ascending: false }).limit(Math.min(limit, 400));
    if (needle) {
      query = query.or(
        `title.ilike.%${needle}%,situation.ilike.%${needle}%,suggested_question.ilike.%${needle}%,sample_answer.ilike.%${needle}%`
      );
    }
    if (categoryIds.length && !omitCategoryColumn) {
      query = query.in('category_id', categoryIds.slice(0, 80));
    }
    const { data, error } = await query;
    if (!error) {
      let items = withoutDemoScenarios(data || []).map(presentScenario);
      if (categoryIds.length && omitCategoryColumn) {
        items = filterScenarioItems(items, { categoryIds });
      }
      return { ok: true, source: 'supabase', items: items.slice(0, limit) };
    }
    if (isMissingCategoryColumn(error)) omitCategoryColumn = true;
    else console.warn('[scenarios] supabase list:', error.message);
  }

  let items = withoutDemoScenarios(readLocal().scenarios || []);
  items = filterScenarioItems(items, { q: needle, categoryIds }).map(presentScenario);
  return { ok: true, source: 'local', items: items.slice(0, limit) };
}

async function getScenario(id) {
  const sid = String(id || '').trim();
  if (!sid) return { ok: false, error: 'Thiếu id' };
  const sb = getSupabase();
  if (sb && isConfigured()) {
    const { data, error } = await sb.from('scenarios').select('*').eq('id', sid).maybeSingle();
    if (!error && data) return { ok: true, item: presentScenario(data), source: 'supabase' };
  }
  const listed = await listScenarios({ limit: 400 });
  const item = (listed.items || []).find((s) => s.id === sid);
  if (!item) return { ok: false, error: 'Không tìm thấy tình huống' };
  return { ok: true, item, source: listed.source };
}

async function createScenario(input) {
  const row = buildScenarioRow(input);
  if (!row.title || !row.situation) {
    return { ok: false, error: 'Cần câu hỏi (hoặc tiêu đề) và mô tả tình huống' };
  }

  const sb = getSupabase();
  if (sb && isConfigured()) {
    const payload = { ...row, use_count: 0 };
    if (omitCategoryColumn) delete payload.category_id;
    const { data, error } = await sb.from('scenarios').insert(payload).select('*').single();
    if (!error) return { ok: true, source: 'supabase', item: presentScenario(data) };
    if (isMissingCategoryColumn(error) && payload.category_id) {
      omitCategoryColumn = true;
      const retry = { ...payload };
      delete retry.category_id;
      const second = await sb.from('scenarios').insert(retry).select('*').single();
      if (!second.error) return { ok: true, source: 'supabase', item: presentScenario(second.data) };
    }
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
  return { ok: true, source: 'local', item: presentScenario(item) };
}

async function updateScenario(id, input) {
  const sid = String(id || '').trim();
  if (!sid) return { ok: false, error: 'Thiếu id' };
  const row = buildScenarioRow(input);
  if (!row.title || !row.situation) {
    return { ok: false, error: 'Cần câu hỏi (hoặc tiêu đề) và mô tả tình huống' };
  }
  const patch = {
    title: row.title,
    situation: row.situation,
    suggested_question: row.suggested_question,
    sample_answer: row.sample_answer,
    tags: row.tags,
    updated_at: new Date().toISOString(),
  };
  if (!omitCategoryColumn) patch.category_id = row.category_id;

  const sb = getSupabase();
  if (sb && isConfigured()) {
    const { data, error } = await sb.from('scenarios').update(patch).eq('id', sid).select('*').single();
    if (!error) return { ok: true, source: 'supabase', item: presentScenario(data) };
    if (isMissingCategoryColumn(error)) {
      omitCategoryColumn = true;
      const retry = { ...patch };
      delete retry.category_id;
      const second = await sb.from('scenarios').update(retry).eq('id', sid).select('*').single();
      if (!second.error) return { ok: true, source: 'supabase', item: presentScenario(second.data) };
    }
    console.warn('[scenarios] supabase update:', error.message);
  }

  const store = readLocal();
  const item = (store.scenarios || []).find((s) => s.id === sid);
  if (!item) return { ok: false, error: 'Không tìm thấy tình huống' };
  Object.assign(item, patch, { category_id: row.category_id });
  writeLocal(store);
  return { ok: true, source: 'local', item: presentScenario(item) };
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
    return { ok: true, item: presentScenario(item) };
  }
  return { ok: true };
}

async function findRelevantScenarios(question, limit = 2) {
  const { items } = await listScenarios({ limit: 80 });
  const tokens = String(question || '')
    .toLowerCase()
    .split(/\s+/)
    .filter((t) => t.length > 2);
  if (!tokens.length) return [];

  const scored = items
    .map((s) => {
      const hay = [s.title, s.situation, s.suggested_question, s.sample_answer, ...(s.tags || [])]
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
    .slice(0, 1)
    .map((s) => {
      const q = String(s.suggested_question || s.situation || '').slice(0, 180);
      const a = String(s.sample_answer || '').slice(0, 280);
      return `[Bài mẫu] ${s.title}${q ? `\nHỏi: ${q}` : ''}${a ? `\nBố cục mẫu: ${a}` : ''}`;
    })
    .join('\n');
}

module.exports = {
  listScenarios,
  getScenario,
  createScenario,
  updateScenario,
  deleteScenario,
  bumpUse,
  findRelevantScenarios,
  formatScenariosForPrompt,
  buildScenarioRow,
  filterScenarioItems,
  presentScenario,
  LOCAL_PATH,
};
