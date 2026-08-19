/**
 * Ingest file từ Google Drive — file gốc ở lại Drive, chỉ đưa text vào Pinecone.
 * Tải về = link Drive. Không copy sang R2. Không copy sang Supabase trừ khi DRIVE_MIRROR_TO_SUPABASE=true.
 */
const { downloadPdf, listPdfInFolder, hasAnyDriveKey } = require('./googleDrive');
const { ingestSingleFile } = require('./ingestFile');
const { uploadPdfToStorage, isConfigured: isSupabaseConfigured } = require('./supabase');

function shouldMirrorToSupabase() {
  return String(process.env.DRIVE_MIRROR_TO_SUPABASE || '').toLowerCase() === 'true';
}

async function ingestDriveFile(fileId, options = {}) {
  const { onProgress, categoryId = null } = options;

  const notify = (stage, percent, message) => {
    if (typeof onProgress === 'function') onProgress({ stage, percent, message });
  };

  notify('drive', 5, `Đang đọc file Drive: ${fileId}`);
  const file = await downloadPdf(fileId);

  let publicUrl = file.driveWebViewLink;
  let storagePath = '';

  if (shouldMirrorToSupabase() && isSupabaseConfigured()) {
    notify('storage', 15, 'Mirror PDF lên Supabase Storage…');
    const stored = await uploadPdfToStorage(file.buffer, file.fileName, file.mimeType);
    if (stored.ok) {
      publicUrl = stored.publicUrl || publicUrl;
      storagePath = stored.path || '';
    }
  }

  const result = await ingestSingleFile(file.buffer, {
    fileName: file.fileName,
    mimeType: file.mimeType,
    publicUrl,
    storagePath,
    driveFileId: file.driveFileId,
    driveWebViewLink: file.driveWebViewLink,
    source: 'google_drive',
    categoryId,
    displayName: options.displayName,
    description: options.description,
    onProgress,
  });

  return {
    ...result,
    source: 'google_drive',
    driveFileId: file.driveFileId,
    driveWebViewLink: file.driveWebViewLink,
    storageUrl: publicUrl,
    downloadUrl: file.driveWebViewLink,
  };
}

async function syncDriveFolder(options = {}) {
  const { onProgress, limit = 20, folderId, categoryId } = options;
  let targets = [];
  if (folderId) {
    targets = [{ folderId, categoryId: categoryId || null }];
  } else {
    const { listDriveSources } = require('./integrations');
    const sources = (await listDriveSources()).filter((s) => s.enabled);
    if (sources.length) {
      targets = sources.map((s) => ({ folderId: s.folderId, categoryId: s.categoryId || categoryId || null }));
    } else if (process.env.GOOGLE_DRIVE_FOLDER_ID && !String(process.env.GOOGLE_DRIVE_FOLDER_ID).includes('your-')) {
      targets = [{ folderId: process.env.GOOGLE_DRIVE_FOLDER_ID, categoryId: categoryId || null }];
    }
  }
  if (!targets.length) {
    throw new Error('Chưa có thư mục Drive. Thêm link folder trong Cài đặt → Google Drive.');
  }
  if (!(await hasAnyDriveKey())) {
    throw new Error('Chưa có Google service account. Super-admin dán JSON trong Cài đặt.');
  }

  const allResults = [];
  let totalListed = 0;
  for (const t of targets) {
    const files = await listPdfInFolder(t.folderId);
    totalListed += files.length;
    const slice = files.slice(0, limit);
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
        const r = await ingestDriveFile(f.id, { onProgress, categoryId: t.categoryId });
        allResults.push({ ok: true, fileId: f.id, name: f.name, ...r });
      } catch (err) {
        allResults.push({ ok: false, fileId: f.id, name: f.name, error: err.message });
      }
    }
  }

  return {
    totalListed,
    processed: allResults.length,
    results: allResults,
  };
}

module.exports = { ingestDriveFile, syncDriveFolder, shouldMirrorToSupabase };
