/**
 * Cài đặt app (từ khóa tìm nhanh) — Supabase app_settings hoặc JSON local.
 */

const fs = require('fs');
const path = require('path');
const { getSupabase, isConfigured } = require('./supabase');

const LOCAL_PATH = path.resolve(__dirname, '../../data/app-settings.json');
const QUICK_KEY = 'quick_keywords';

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
    if (!fs.existsSync(LOCAL_PATH)) return { [QUICK_KEY]: { items: DEFAULT_KEYWORDS } };
    return JSON.parse(fs.readFileSync(LOCAL_PATH, 'utf8'));
  } catch {
    return { [QUICK_KEY]: { items: DEFAULT_KEYWORDS } };
  }
}

function writeLocal(data) {
  const dir = path.dirname(LOCAL_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(LOCAL_PATH, JSON.stringify(data, null, 2), 'utf8');
}

async function getSetting(key) {
  const sb = getSupabase();
  if (sb && isConfigured()) {
    const { data, error } = await sb.from('app_settings').select('value').eq('key', key).maybeSingle();
    if (!error && data) return data.value;
    if (error && !/does not exist|schema cache/i.test(error.message || '')) {
      console.warn('[appSettings] get', key, error.message);
    }
  }
  const local = readLocal();
  return local[key] ?? null;
}

async function setSetting(key, value) {
  const sb = getSupabase();
  if (sb && isConfigured()) {
    const { error } = await sb.from('app_settings').upsert({
      key,
      value,
      updated_at: new Date().toISOString(),
    });
    if (!error) return { ok: true, source: 'supabase', value };
    const missing = /does not exist|schema cache/i.test(error.message || '');
    if (!missing) {
      console.warn('[appSettings] set', key, error.message);
      return { ok: false, source: 'supabase', error: error.message };
    }
  }
  const local = readLocal();
  local[key] = value;
  writeLocal(local);
  return { ok: true, source: 'local', value };
}

async function getQuickKeywords() {
  const sb = getSupabase();
  if (sb && isConfigured()) {
    const { data, error } = await sb.from('app_settings').select('value').eq('key', QUICK_KEY).maybeSingle();
    if (!error && data?.value) return { ok: true, source: 'supabase', ...normalizeKeywords(data.value) };
    if (error && !/does not exist|schema cache/i.test(error.message || '')) {
      console.warn('[appSettings]', error.message);
    }
  }
  const local = readLocal();
  const value = local[QUICK_KEY] || { items: DEFAULT_KEYWORDS };
  return { ok: true, source: 'local', ...normalizeKeywords(value) };
}

async function setQuickKeywords(input) {
  const value = normalizeKeywords(input);
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
  DEFAULT_KEYWORDS,
  QUICK_KEY,
  LOCAL_PATH,
};
