/**
 * Cài đặt app (từ khóa tìm nhanh) — Supabase app_settings hoặc JSON local.
 */

const fs = require('fs');
const path = require('path');
const { getSupabase, isConfigured } = require('./supabase');
const { createTtlMap } = require('./ttlMap');
const { isDemoKeyword } = require('./quickSuggest');

const LOCAL_PATH = path.resolve(__dirname, '../../data/app-settings.json');
const QUICK_KEY = 'quick_keywords';
const settingCache = createTtlMap({ ttlMs: 15_000, max: 40 });

const DEFAULT_KEYWORDS = [
  { id: 'k1', label: 'CCCD', query: 'Thủ tục cấp lại CCCD cần giấy tờ gì?', mode: 'advise' },
  { id: 'k2', label: 'Hiệu lực VB', query: 'Nghị định nào còn hiệu lực về thủ tục hành chính?', mode: 'lookup' },
  { id: 'k3', label: 'BHXH', query: 'Quy định đóng bảo hiểm xã hội bắt buộc', mode: 'lookup' },
  { id: 'k4', label: 'ĐKKD', query: 'Đăng ký kinh doanh hộ cá thể gồm những bước nào?', mode: 'advise' },
  { id: 'k5', label: 'Nghỉ phép', query: 'So sánh quy định nghỉ phép năm theo Bộ luật Lao động', mode: 'lookup' },
  { id: 'k6', label: 'GPXD', query: 'Xin cấp giấy phép xây dựng nhà ở cần hồ sơ gì?', mode: 'advise' },
];

function normalizeKeywords(raw) {
  const items = Array.isArray(raw?.items) ? raw.items : Array.isArray(raw) ? raw : [];
  return {
    items: items
      .map((it, i) => ({
        id: String(it.id || `k-${i}-${Date.now()}`),
        label: String(it.label || it.query || '').trim().slice(0, 80),
        query: String(it.query || it.label || '').trim().slice(0, 400),
        mode: ['lookup', 'advise', 'both'].includes(it.mode) ? it.mode : 'both',
      }))
      .filter((it) => it.query),
  };
}

function readLocal() {
  try {
    if (!fs.existsSync(LOCAL_PATH)) return {};
    return JSON.parse(fs.readFileSync(LOCAL_PATH, 'utf8'));
  } catch {
    return {};
  }
}

function writeLocal(data) {
  const dir = path.dirname(LOCAL_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(LOCAL_PATH, JSON.stringify(data, null, 2), 'utf8');
}

async function getSetting(key) {
  const cached = settingCache.get(key);
  if (cached !== undefined) return cached;
  const sb = getSupabase();
  if (sb && isConfigured()) {
    const { data, error } = await sb.from('app_settings').select('value').eq('key', key).maybeSingle();
    if (!error && data) {
      settingCache.set(key, data.value);
      return data.value;
    }
    if (error && !/does not exist|schema cache/i.test(error.message || '')) {
      console.warn('[appSettings] get', key, error.message);
    }
  }
  const local = readLocal();
  const value = local[key] ?? null;
  settingCache.set(key, value);
  return value;
}

async function setSetting(key, value) {
  settingCache.delete(key);
  const sb = getSupabase();
  if (sb && isConfigured()) {
    const { error } = await sb.from('app_settings').upsert({
      key,
      value,
      updated_at: new Date().toISOString(),
    });
    if (!error) {
      settingCache.set(key, value);
      return { ok: true, source: 'supabase', value };
    }
    const missing = /does not exist|schema cache/i.test(error.message || '');
    if (!missing) {
      console.warn('[appSettings] set', key, error.message);
      return { ok: false, source: 'supabase', error: error.message };
    }
    return {
      ok: false,
      source: 'supabase',
      error:
        'Thiếu bảng app_settings. Chạy supabase/migrations/006_app_settings.sql trên project Supabase.',
    };
  }
  if (process.env.VERCEL) {
    return {
      ok: false,
      source: 'none',
      error:
        'Vercel cần SUPABASE_SERVICE_ROLE_KEY (service role, không phải anon) để lưu bộ não. Không ghi được file local.',
    };
  }
  const local = readLocal();
  local[key] = value;
  writeLocal(local);
  settingCache.set(key, value);
  return { ok: true, source: 'local', value };
}

function assertDurableSave(result, label = 'cài đặt', env = process.env) {
  if (!result?.ok) {
    throw new Error(result?.error || `Không lưu được ${label}`);
  }
  if (env.VERCEL && result.source === 'local') {
    throw new Error(
      `Vercel không giữ file local. Kiểm tra SUPABASE_SERVICE_ROLE_KEY (service role, không phải anon) và đã chạy supabase/migrations/006_app_settings.sql.`
    );
  }
  return result;
}

function withoutDemo(value) {
  const norm = normalizeKeywords(value);
  return { items: norm.items.filter((it) => !isDemoKeyword(it)) };
}

async function getQuickKeywords() {
  const sb = getSupabase();
  if (sb && isConfigured()) {
    const { data, error } = await sb.from('app_settings').select('value').eq('key', QUICK_KEY).maybeSingle();
    if (!error && data?.value) return { ok: true, source: 'supabase', ...withoutDemo(data.value) };
    if (error && !/does not exist|schema cache/i.test(error.message || '')) {
      console.warn('[appSettings]', error.message);
    }
  }
  const local = readLocal();
  const value = local[QUICK_KEY] || { items: [] };
  return { ok: true, source: 'local', ...withoutDemo(value) };
}

async function setQuickKeywords(input) {
  const value = normalizeKeywords(input);
  settingCache.delete(QUICK_KEY);
  const sb = getSupabase();
  if (sb && isConfigured()) {
    const { error } = await sb.from('app_settings').upsert({
      key: QUICK_KEY,
      value,
      updated_at: new Date().toISOString(),
    });
    if (!error) return { ok: true, source: 'supabase', ...value };
    if (!/does not exist|schema cache/i.test(error.message || '')) {
      console.warn('[appSettings] save:', error.message);
    }
  }
  const local = readLocal();
  local[QUICK_KEY] = value;
  writeLocal(local);
  return { ok: true, source: 'local', ...value };
}

module.exports = {
  getQuickKeywords,
  setQuickKeywords,
  getSetting,
  setSetting,
  assertDurableSave,
  DEFAULT_KEYWORDS,
  QUICK_KEY,
  LOCAL_PATH,
};
