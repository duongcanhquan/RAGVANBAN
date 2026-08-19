/**
 * File gốc khi upload tay: ưu tiên R2, fallback Supabase Storage.
 * Link Drive không đi qua đây.
 */

const { hasR2Credentials, uploadToR2 } = require('./r2');
const { isConfigured: isSupabaseConfigured, uploadPdfToStorage } = require('./supabase');

async function storeUploadedOriginal(buffer, fileName, contentType, opts = {}) {
  if (hasR2Credentials()) {
    const stored = await uploadToR2(buffer, fileName, contentType, {
      folderPath: opts.folderPath || '',
      contentHash: opts.contentHash || '',
    });
    if (stored.ok) return { ...stored, source: 'r2', backend: 'r2' };
    console.warn('[originalStore] R2 thất bại, thử Supabase:', stored.error || stored.reason);
  }
  if (isSupabaseConfigured()) {
    const stored = await uploadPdfToStorage(buffer, fileName, contentType);
    return { ...stored, backend: stored.ok ? 'supabase' : stored.backend, source: stored.ok ? 'upload' : undefined };
  }
  return { ok: false, skipped: true, reason: 'Chưa cấu hình R2 hoặc Supabase Storage' };
}

module.exports = { storeUploadedOriginal };
