/**
 * Ingest PDF từ Google Drive (+ mirror lên Supabase Storage nếu có).
 */
const { downloadPdf, listPdfInFolder, isDriveConfigured } = require('./googleDrive');
const { ingestSingleFile } = require('./ingestFile');
const { uploadPdfToStorage, isConfigured: isSupabaseConfigured } = require('./supabase');

/**
 * Số hóa 1 file Drive theo fileId.
 */
async function ingestDriveFile(fileId, options = {}) {
  const { onProgress } = options;
  if (!isDriveConfigured()) {
    throw new Error('Google Drive chưa cấu hình');
  }

  const notify = (stage, percent, message) => {
    if (typeof onProgress === 'function') onProgress({ stage, percent, message });
  };

  notify('drive', 5, `Đang tải từ Google Drive: ${fileId}`);
  const file = await downloadPdf(fileId);

  let publicUrl = file.driveWebViewLink;
  let storagePath = '';

  if (isSupabaseConfigured()) {
    notify('storage', 15, 'Mirror PDF lên Supabase Storage…');
    const stored = await uploadPdfToStorage(file.buffer, file.fileName);
    if (stored.ok) {
      publicUrl = stored.publicUrl || publicUrl;
      storagePath = stored.path || '';
    }
  }

  // Ưu tiên link Drive làm citation nếu không có Supabase public URL
  const result = await ingestSingleFile(file.buffer, {
    fileName: file.fileName,
    publicUrl,
    storagePath,
    driveFileId: file.driveFileId,
    driveWebViewLink: file.driveWebViewLink,
    source: 'google_drive',
    onProgress,
  });

  return {
    ...result,
    source: 'google_drive',
    driveFileId: file.driveFileId,
    driveWebViewLink: file.driveWebViewLink,
    storageUrl: publicUrl,
  };
}

/**
 * Đồng bộ toàn bộ PDF trong folder Drive (tuần tự).
 */
async function syncDriveFolder(options = {}) {
  const { onProgress, limit = 20 } = options;
  const files = await listPdfInFolder();
  const slice = files.slice(0, limit);
  const results = [];

  for (let i = 0; i < slice.length; i += 1) {
    const f = slice[i];
    if (typeof onProgress === 'function') {
      onProgress({
        stage: 'sync',
        percent: Math.round((i / Math.max(slice.length, 1)) * 100),
        message: `Đồng bộ ${i + 1}/${slice.length}: ${f.name}`,
      });
    }
    try {
      const r = await ingestDriveFile(f.id, { onProgress });
      results.push({ ok: true, fileId: f.id, name: f.name, ...r });
    } catch (err) {
      results.push({ ok: false, fileId: f.id, name: f.name, error: err.message });
    }
  }

  return {
    totalListed: files.length,
    processed: results.length,
    results,
  };
}

module.exports = { ingestDriveFile, syncDriveFolder };
