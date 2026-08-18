/**
 * Google Drive (tùy chọn) — đọc PDF từ thư mục Drive cá nhân/team.
 * Dùng Service Account JSON (an toàn hơn OAuth cho server).
 *
 * Env:
 *   GOOGLE_SERVICE_ACCOUNT_JSON  — đường dẫn tới file JSON, hoặc chuỗi JSON
 *   GOOGLE_DRIVE_FOLDER_ID       — ID thư mục chứa PDF
 *   GOOGLE_DRIVE_SHARED          — true nếu folder share cho service account
 */

const fs = require('fs');
const path = require('path');

let driveClient = null;

function isDriveConfigured() {
  const folder = process.env.GOOGLE_DRIVE_FOLDER_ID;
  const cred = process.env.GOOGLE_SERVICE_ACCOUNT_JSON || process.env.GOOGLE_APPLICATION_CREDENTIALS;
  if (!folder || String(folder).includes('your-')) return false;
  if (!cred || String(cred).includes('your-')) return false;
  return true;
}

function loadCredentials() {
  const raw = process.env.GOOGLE_SERVICE_ACCOUNT_JSON || process.env.GOOGLE_APPLICATION_CREDENTIALS;
  if (!raw) throw new Error('Thiếu GOOGLE_SERVICE_ACCOUNT_JSON');

  // Đường dẫn file
  const asPath = path.resolve(raw);
  if (fs.existsSync(asPath)) {
    return JSON.parse(fs.readFileSync(asPath, 'utf8'));
  }

  // Chuỗi JSON trực tiếp trong .env (có thể có \\n)
  try {
    return JSON.parse(raw);
  } catch {
    const fixed = raw.replace(/\\n/g, '\n');
    return JSON.parse(fixed);
  }
}

async function getDrive() {
  if (driveClient) return driveClient;
  if (!isDriveConfigured()) {
    throw new Error('Google Drive chưa cấu hình (FOLDER_ID + SERVICE_ACCOUNT_JSON)');
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

/**
 * Liệt kê PDF trong folder (không đệ quy sâu — 1 cấp + hỗ trợ shared drives).
 */
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

/**
 * Tải PDF về Buffer + metadata link.
 */
async function downloadPdf(fileId) {
  const drive = await getDrive();

  const metaRes = await drive.files.get({
    fileId,
    fields: 'id,name,mimeType,webViewLink,webContentLink,modifiedTime',
    supportsAllDrives: true,
  });

  const meta = metaRes.data;
  if (meta.mimeType && meta.mimeType !== 'application/pdf') {
    throw new Error(`File không phải PDF: ${meta.mimeType}`);
  }

  const res = await drive.files.get(
    { fileId, alt: 'media', supportsAllDrives: true },
    { responseType: 'arraybuffer' }
  );

  const buffer = Buffer.from(res.data);
  return {
    buffer,
    fileName: meta.name || `${fileId}.pdf`,
    driveFileId: meta.id,
    driveWebViewLink: meta.webViewLink || `https://drive.google.com/file/d/${fileId}/view`,
    modifiedTime: meta.modifiedTime,
  };
}

module.exports = {
  isDriveConfigured,
  listPdfInFolder,
  downloadPdf,
  getDrive,
};
