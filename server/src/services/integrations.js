/**
 * Cài đặt tích hợp: bật/tắt Drive & n8n, service account, thư mục Drive theo người.
 */

const { randomBytes } = require('crypto');
const fs = require('fs');
const path = require('path');
const { getSetting, setSetting } = require('./appSettings');
const { parseDriveResource, resetDriveClient } = require('./googleDrive');
const { canUseCategory, isSuperAdmin } = require('./adminAccess');

const FLAGS_KEY = 'integration_flags';
const SA_KEY = 'google_sa';
const N8N_KEY = 'n8n_secret';
const SOURCES_KEY = 'drive_sources';

function defaultFlags() {
  return { driveEnabled: true, n8nEnabled: true };
}

function parseServiceAccount(raw) {
  if (!raw) return null;
  if (typeof raw === 'object' && raw.client_email && raw.private_key) return raw;
  const s = String(raw).trim();
  if (!s || s.includes('your-')) return null;
  try {
    const json = JSON.parse(s);
    if (json.client_email && json.private_key) return json;
  } catch {
    try {
      const json = JSON.parse(s.replace(/\\n/g, '\n'));
      if (json.client_email && json.private_key) return json;
    } catch {
      return null;
    }
  }
  return null;
}

async function getFlags() {
  const v = await getSetting(FLAGS_KEY);
  return { ...defaultFlags(), ...(v && typeof v === 'object' ? v : {}) };
}

async function setFlags(patch, admin) {
  if (!isSuperAdmin(admin)) {
    const err = new Error('Chỉ super-admin được bật/tắt tích hợp');
    err.status = 403;
    throw err;
  }
  const cur = await getFlags();
  const next = {
    driveEnabled: patch.driveEnabled != null ? Boolean(patch.driveEnabled) : cur.driveEnabled,
    n8nEnabled: patch.n8nEnabled != null ? Boolean(patch.n8nEnabled) : cur.n8nEnabled,
  };
  await setSetting(FLAGS_KEY, next);
  return next;
}

async function getSavedServiceAccount() {
  const raw = process.env.GOOGLE_SERVICE_ACCOUNT_JSON || process.env.GOOGLE_APPLICATION_CREDENTIALS;
  const fromEnv = parseServiceAccount(raw);
  if (fromEnv) return { source: 'env', json: fromEnv };
  if (raw && !String(raw).includes('your-')) {
    try {
      const asPath = path.resolve(raw);
      if (fs.existsSync(asPath)) {
        const json = parseServiceAccount(fs.readFileSync(asPath, 'utf8'));
        if (json) return { source: 'env-file', json };
      }
    } catch {
      /* ignore */
    }
  }
  const saved = await getSetting(SA_KEY);
  const json = parseServiceAccount(saved);
  if (json) return { source: 'settings', json };
  return { source: 'none', json: null };
}

async function saveServiceAccount(raw, admin) {
  if (!isSuperAdmin(admin)) {
    const err = new Error('Chỉ super-admin được lưu Google service account');
    err.status = 403;
    throw err;
  }
  const json = parseServiceAccount(raw);
  if (!json) {
    const err = new Error('JSON không hợp lệ — hãy dán nguyên file key tải từ Google Cloud');
    err.status = 400;
    throw err;
  }
  await setSetting(SA_KEY, {
    type: json.type || 'service_account',
    project_id: json.project_id,
    client_email: json.client_email,
    client_id: json.client_id,
    private_key_id: json.private_key_id,
    private_key: json.private_key,
  });
  resetDriveClient();
  return { ok: true, email: json.client_email };
}

async function getN8nSecret() {
  const env = String(process.env.N8N_WEBHOOK_SECRET || '').trim();
  if (env && !env.includes('your-')) return { source: 'env', secret: env };
  const saved = await getSetting(N8N_KEY);
  const secret = typeof saved === 'string' ? saved : saved?.secret;
  if (secret) return { source: 'settings', secret };
  return { source: 'none', secret: '' };
}

async function ensureN8nSecret(admin) {
  if (!isSuperAdmin(admin)) {
    const err = new Error('Chỉ super-admin được tạo secret n8n');
    err.status = 403;
    throw err;
  }
  const cur = await getN8nSecret();
  if (cur.secret && cur.source === 'env') return cur;
  const secret = randomBytes(24).toString('base64url');
  await setSetting(N8N_KEY, { secret });
  return { source: 'settings', secret };
}

function normalizeSource(it) {
  return {
    id: String(it.id),
    userId: it.userId || it.user_id || null,
    email: it.email || '',
    label: String(it.label || '').slice(0, 120),
    folderId: String(it.folderId || it.folder_id || ''),
    folderUrl: String(it.folderUrl || it.folder_url || ''),
    categoryId: it.categoryId || it.category_id || null,
    enabled: it.enabled !== false,
    isShared: Boolean(it.isShared || it.is_shared),
  };
}

async function listDriveSources() {
  const v = await getSetting(SOURCES_KEY);
  const items = Array.isArray(v?.items) ? v.items : Array.isArray(v) ? v : [];
  return items.map(normalizeSource).filter((s) => s.folderId);
}

async function saveDriveSources(items) {
  const next = items.map(normalizeSource).filter((s) => s.folderId);
  await setSetting(SOURCES_KEY, { items: next });
  return next;
}

async function upsertDriveSource(admin, input) {
  const parsed = parseDriveResource(input.folderUrl || input.folderId);
  if (parsed?.type === 'file') {
    const err = new Error('Cần link thư mục Drive (folders/...), không phải link một file');
    err.status = 400;
    throw err;
  }
  const folderId = parsed?.id || String(input.folderId || '').trim();
  if (!folderId) {
    const err = new Error('Dán link thư mục Google Drive (drive.google.com/drive/folders/...)');
    err.status = 400;
    throw err;
  }
  const categoryId = input.categoryId || null;
  if (categoryId && !canUseCategory(admin, categoryId) && !isSuperAdmin(admin)) {
    const err = new Error('Bạn không được gắn chuyên mục này');
    err.status = 403;
    throw err;
  }
  const isShared = Boolean(input.isShared) && isSuperAdmin(admin);
  const items = await listDriveSources();
  const id = input.id || `drv-${Date.now()}`;
  const row = normalizeSource({
    id,
    userId: isShared ? null : admin.id,
    email: admin.email,
    label: input.label || '',
    folderId,
    folderUrl: input.folderUrl || `https://drive.google.com/drive/folders/${folderId}`,
    categoryId,
    enabled: input.enabled !== false,
    isShared,
  });
  const idx = items.findIndex((s) => s.id === id);
  if (idx >= 0) {
    if (!isSuperAdmin(admin) && items[idx].userId !== admin.id) {
      const err = new Error('Không sửa được thư mục của người khác');
      err.status = 403;
      throw err;
    }
    items[idx] = { ...items[idx], ...row, id: items[idx].id };
  } else {
    items.push(row);
  }
  await saveDriveSources(items);
  return row;
}

async function removeDriveSource(admin, id) {
  const items = await listDriveSources();
  const row = items.find((s) => s.id === id);
  if (!row) return { ok: true };
  if (!isSuperAdmin(admin) && row.userId !== admin.id) {
    const err = new Error('Không xóa được thư mục của người khác');
    err.status = 403;
    throw err;
  }
  await saveDriveSources(items.filter((s) => s.id !== id));
  return { ok: true };
}

function sourcesVisibleTo(admin, items) {
  if (isSuperAdmin(admin)) return items;
  return items.filter((s) => s.isShared || s.userId === admin.id);
}

async function findSourceForFolder(folderId) {
  const items = await listDriveSources();
  return items.find((s) => s.enabled && s.folderId === folderId) || null;
}

module.exports = {
  FLAGS_KEY,
  SA_KEY,
  parseServiceAccount,
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
  findSourceForFolder,
};
