/**
 * Google Drive — đọc file có sẵn trên Drive của bạn.
 *
 * Env:
 *   GOOGLE_SERVICE_ACCOUNT_JSON  — đường dẫn file JSON, hoặc chuỗi JSON
 *   GOOGLE_DRIVE_FOLDER_ID       — thư mục mặc định (chỉ khi sync cả folder)
 */

const fs = require('fs');
const path = require('path');

let driveClient = null;

function hasDriveCredentials() {
  const cred = process.env.GOOGLE_SERVICE_ACCOUNT_JSON || process.env.GOOGLE_APPLICATION_CREDENTIALS;
  if (!cred || String(cred).includes('your-')) return false;
  return true;
}

function isDriveConfigured() {
  const folder = process.env.GOOGLE_DRIVE_FOLDER_ID;
  if (!folder || String(folder).includes('your-')) return false;
  return hasDriveCredentials();
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

function loadCredentials() {
  const raw = process.env.GOOGLE_SERVICE_ACCOUNT_JSON || process.env.GOOGLE_APPLICATION_CREDENTIALS;
  if (!raw) throw new Error('Thiếu GOOGLE_SERVICE_ACCOUNT_JSON');

  const asPath = path.resolve(raw);
  if (fs.existsSync(asPath)) {
    return JSON.parse(fs.readFileSync(asPath, 'utf8'));
  }

  try {
    return JSON.parse(raw);
  } catch {
    const fixed = raw.replace(/\\n/g, '\n');
    return JSON.parse(fixed);
  }
}

async function getDrive() {
  if (driveClient) return driveClient;
  if (!hasDriveCredentials()) {
    throw new Error('Google Drive chưa cấu hình GOOGLE_SERVICE_ACCOUNT_JSON');
  }

  const { google } = require('googleapis');
  const credentials = loadCredentials();
  const auth = new google.auth.GoogleAuth({
    credentials,
    scopes: ['https://www.googleapis.com/auth/drive.readonly'],
  });
  driveClient = google.drive({ version: 'v3', auth });
  return driveClient;
}

async function listPdfInFolder(folderId = process.env.GOOGLE_DRIVE_FOLDER_ID) {
  const drive = await getDrive();
  const q = `'${folderId}' in parents and mimeType='application/pdf' and trashed=false`;

  const res = await drive.files.list({
    q,
    fields: 'files(id,name,mimeType,webViewLink,modifiedTime,size)',
    pageSize: 100,
    supportsAllDrives: true,
    includeItemsFromAllDrives: true,
  });

  return res.data.files || [];
}

const ALLOWED_DRIVE_MIME = new Set([
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-powerpoint',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'text/plain',
  'text/markdown',
]);

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

async function downloadPdf(fileId) {
  if (hasDriveCredentials()) {
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
  isDriveConfigured,
  parseDriveResource,
  listPdfInFolder,
  downloadPdf,
  getDrive,
};
