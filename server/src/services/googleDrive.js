/**
 * Google Drive — đọc file đã share cho service account.
 * Super-admin dán JSON một lần trong Cài đặt; mỗi cán bộ thêm link thư mục của mình.
 */

let driveClient = null;

function hasDriveCredentials() {
  const cred = process.env.GOOGLE_SERVICE_ACCOUNT_JSON || process.env.GOOGLE_APPLICATION_CREDENTIALS;
  if (!cred || String(cred).includes('your-')) return false;
  return true;
}

function resetDriveClient() {
  driveClient = null;
}

async function loadCredentials() {
  const { getSavedServiceAccount } = require('./integrations');
  const saved = await getSavedServiceAccount();
  if (saved.json) return saved.json;
  throw new Error(
    'Chưa có Google service account. Super-admin dán file JSON key trong Cài đặt → Google Drive.'
  );
}

async function hasAnyDriveKey() {
  try {
    await loadCredentials();
    return true;
  } catch {
    return false;
  }
}

/** Drive sẵn sàng đọc file riêng (không cần 1 folder ID toàn cục). */
async function isDriveConfigured() {
  return hasAnyDriveKey();
}

/**
 * @param {string} raw  URL Drive hoặc fileId
 * @returns {{ type: 'file'|'folder', id: string } | null}
 */
function parseDriveResource(raw) {
  const s = String(raw || '').trim();
  if (!s) return null;
  if (/^[a-zA-Z0-9_-]{20,}$/.test(s)) {
    return { type: 'file', id: s };
  }
  let u;
  try {
    u = new URL(s);
  } catch {
    return null;
  }
  const host = u.hostname.toLowerCase();
  if (!host.endsWith('google.com') && !host.endsWith('googleusercontent.com')) {
    return null;
  }
  const fileM = u.pathname.match(/\/file\/d\/([^/]+)/);
  if (fileM) return { type: 'file', id: fileM[1] };
  const folderM = u.pathname.match(/\/(?:drive\/)?folders\/([^/]+)/);
  if (folderM) return { type: 'folder', id: folderM[1] };
  const docM = u.pathname.match(/\/(?:document|spreadsheets|presentation)\/d\/([^/]+)/);
  if (docM) return { type: 'file', id: docM[1] };
  const id = u.searchParams.get('id');
  if (id) return { type: 'file', id };
  return null;
}

async function getDrive() {
  if (driveClient) return driveClient;
  const { google } = require('googleapis');
  const credentials = await loadCredentials();
  const auth = new google.auth.GoogleAuth({
    credentials,
    scopes: ['https://www.googleapis.com/auth/drive.readonly'],
  });
  driveClient = google.drive({ version: 'v3', auth });
  return driveClient;
}

async function listDocsInFolder(folderId = process.env.GOOGLE_DRIVE_FOLDER_ID) {
  const id = String(folderId || '').replace(/'/g, '');
  if (!id) throw new Error('Thiếu folderId');
  const drive = await getDrive();
  const mimeClause = [...ALLOWED_DRIVE_MIME]
    .map((m) => `mimeType='${m}'`)
    .concat(["mimeType contains 'image/'"])
    .join(' or ');
  const q = `'${id}' in parents and trashed=false and (${mimeClause})`;

  const files = [];
  let pageToken;
  do {
    const res = await drive.files.list({
      q,
      fields: 'nextPageToken,files(id,name,mimeType,webViewLink,modifiedTime,size)',
      pageSize: 100,
      pageToken,
      supportsAllDrives: true,
      includeItemsFromAllDrives: true,
    });
    files.push(...(res.data.files || []));
    pageToken = res.data.nextPageToken;
  } while (pageToken);

  return files;
}

async function listPdfInFolder(folderId) {
  return listDocsInFolder(folderId);
}

const ALLOWED_DRIVE_MIME = new Set([
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-powerpoint',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'application/vnd.google-apps.document',
  'application/vnd.google-apps.spreadsheet',
  'application/vnd.google-apps.presentation',
  'text/plain',
  'text/markdown',
]);

const GOOGLE_NATIVE_EXPORT = {
  'application/vnd.google-apps.document': {
    exportMime: 'application/pdf',
    ext: '.pdf',
  },
  'application/vnd.google-apps.spreadsheet': {
    exportMime: 'application/pdf',
    ext: '.pdf',
  },
  'application/vnd.google-apps.presentation': {
    exportMime: 'application/pdf',
    ext: '.pdf',
  },
};

function driveExportPlan(mimeType) {
  return GOOGLE_NATIVE_EXPORT[String(mimeType || '')] || null;
}

async function downloadViaApi(fileId) {
  const drive = await getDrive();
  const metaRes = await drive.files.get({
    fileId,
    fields: 'id,name,mimeType,webViewLink,webContentLink,modifiedTime',
    supportsAllDrives: true,
  });
  const meta = metaRes.data;
  if (meta.mimeType && !ALLOWED_DRIVE_MIME.has(meta.mimeType) && !String(meta.mimeType).startsWith('image/')) {
    throw new Error(`Định dạng Drive chưa hỗ trợ: ${meta.mimeType}`);
  }

  const native = driveExportPlan(meta.mimeType);
  if (native) {
    const exported = await drive.files.export(
      { fileId, mimeType: native.exportMime },
      { responseType: 'arraybuffer' }
    );
    const baseName = String(meta.name || fileId).replace(/\.[^.]+$/, '');
    return {
      buffer: Buffer.from(exported.data),
      fileName: `${baseName}${native.ext}`,
      mimeType: native.exportMime,
      driveFileId: meta.id,
      driveWebViewLink: meta.webViewLink || `https://drive.google.com/file/d/${fileId}/view`,
      modifiedTime: meta.modifiedTime,
    };
  }

  const res = await drive.files.get(
    { fileId, alt: 'media', supportsAllDrives: true },
    { responseType: 'arraybuffer' }
  );

  return {
    buffer: Buffer.from(res.data),
    fileName: meta.name || `${fileId}.pdf`,
    mimeType: meta.mimeType || 'application/pdf',
    driveFileId: meta.id,
    driveWebViewLink: meta.webViewLink || `https://drive.google.com/file/d/${fileId}/view`,
    modifiedTime: meta.modifiedTime,
  };
}

async function downloadPublicDriveFile(fileId) {
  const url = `https://drive.google.com/uc?export=download&confirm=t&id=${encodeURIComponent(fileId)}`;
  const res = await fetch(url, {
    redirect: 'follow',
    headers: { 'User-Agent': 'HCC-VanBanThongMinh/1.0' },
  });
  if (!res.ok) {
    throw new Error(`Không tải được file Drive công khai (HTTP ${res.status})`);
  }
  const ctype = String(res.headers.get('content-type') || '');
  if (/text\/html/i.test(ctype)) {
    throw new Error(
      'Google trả về trang HTML — file chưa public hoặc chưa Share cho service account. Share Viewer cho email service account, hoặc bật “Anyone with the link”.'
    );
  }
  const buffer = Buffer.from(await res.arrayBuffer());
  let fileName = `${fileId}.pdf`;
  const disp = res.headers.get('content-disposition') || '';
  const m = disp.match(/filename\*?=(?:UTF-8'')?"?([^";]+)"?/i);
  if (m) fileName = decodeURIComponent(m[1]);
  return {
    buffer,
    fileName,
    mimeType: ctype.split(';')[0].trim() || 'application/pdf',
    driveFileId: fileId,
    driveWebViewLink: `https://drive.google.com/file/d/${fileId}/view`,
    modifiedTime: null,
  };
}

async function getFileParentIds(fileId) {
  const drive = await getDrive();
  const meta = await drive.files.get({
    fileId,
    fields: 'parents',
    supportsAllDrives: true,
  });
  return meta.data.parents || [];
}

async function downloadPdf(fileId) {
  if (await hasAnyDriveKey()) {
    try {
      return await downloadViaApi(fileId);
    } catch (err) {
      const publicFile = await downloadPublicDriveFile(fileId).catch(() => null);
      if (publicFile) return publicFile;
      throw err;
    }
  }
  return downloadPublicDriveFile(fileId);
}

module.exports = {
  hasDriveCredentials,
  hasAnyDriveKey,
  isDriveConfigured,
  resetDriveClient,
  parseDriveResource,
  listPdfInFolder,
  listDocsInFolder,
  getFileParentIds,
  downloadPdf,
  getDrive,
  driveExportPlan,
};
