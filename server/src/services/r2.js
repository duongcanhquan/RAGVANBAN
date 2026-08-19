/**
 * Cloudflare R2 — kho file gốc khi cán bộ upload (S3-compatible).
 *
 * Env:
 *   R2_ACCOUNT_ID           — Account ID, hoặc endpoint …r2.cloudflarestorage.com
 *   R2_ACCESS_KEY_ID
 *   R2_SECRET_ACCESS_KEY
 *   R2_BUCKET
 *   R2_PUBLIC_BASE_URL      — https://pub-xxx.r2.dev hoặc custom domain (không slash cuối)
 */

function envTrim(name) {
  return String(process.env[name] || '').trim();
}

function isPlaceholder(value) {
  const v = String(value || '').toLowerCase();
  return !v || v.includes('your-') || v.includes('xxxxxxxx');
}

/** Cho phép dán Account ID thuần hoặc cả S3 endpoint. */
function r2AccountId() {
  const raw = envTrim('R2_ACCOUNT_ID');
  if (isPlaceholder(raw)) return '';
  const fromHost = raw.match(/([a-f0-9]{32})\.r2\.cloudflarestorage\.com/i);
  if (fromHost) return fromHost[1];
  return raw.replace(/^https?:\/\//i, '').split('.')[0];
}

function publicBaseUrl() {
  return envTrim('R2_PUBLIC_BASE_URL').replace(/\/$/, '');
}

function hasR2Credentials() {
  return Boolean(
    r2AccountId() &&
      envTrim('R2_ACCESS_KEY_ID') &&
      envTrim('R2_SECRET_ACCESS_KEY') &&
      envTrim('R2_BUCKET') &&
      !isPlaceholder(envTrim('R2_BUCKET'))
  );
}

function isR2Configured() {
  return hasR2Credentials() && Boolean(publicBaseUrl()) && !isPlaceholder(publicBaseUrl());
}

function publicUrlForKey(objectKey) {
  const base = publicBaseUrl();
  const key = String(objectKey || '').replace(/^\//, '');
  if (!base) return '';
  return `${base}/${key.split('/').map(encodeURIComponent).join('/')}`;
}

function objectKeyForFile(originalName) {
  const safe = String(originalName || 'document.bin').replace(/[^a-zA-Z0-9._\-\u00C0-\u024F]/g, '_');
  return `van-ban/${new Date().toISOString().slice(0, 10)}/${Date.now()}-${safe}`;
}

function formatR2Error(err) {
  const name = err?.name || err?.Code || '';
  const msg = err?.message || String(err);
  if (/NoSuchBucket/i.test(name + msg)) {
    return `R2: không thấy bucket "${envTrim('R2_BUCKET')}" — kiểm tra R2_BUCKET`;
  }
  if (/InvalidAccessKeyId|InvalidAccessKey|SignatureDoesNotMatch|AccessDenied|NotSignedUp/i.test(name + msg)) {
    return 'R2: sai Access Key / Secret — tạo lại token Object Read & Write';
  }
  if (/ENOTFOUND|getaddrinfo|ECONNREFUSED/i.test(msg)) {
    return 'R2: sai Account ID (endpoint không tồn tại)';
  }
  return `R2 upload thất bại: ${msg}`;
}

async function uploadToR2(buffer, originalName, contentType = 'application/octet-stream') {
  if (!hasR2Credentials()) {
    return { ok: false, skipped: true, reason: 'R2 chưa cấu hình' };
  }
  if (!publicBaseUrl() || isPlaceholder(publicBaseUrl())) {
    return {
      ok: false,
      error: 'Thiếu R2_PUBLIC_BASE_URL (bật Public Development URL trên bucket hoặc gắn custom domain)',
    };
  }

  const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');
  const client = new S3Client({
    region: 'auto',
    endpoint: `https://${r2AccountId()}.r2.cloudflarestorage.com`,
    forcePathStyle: true,
    credentials: {
      accessKeyId: envTrim('R2_ACCESS_KEY_ID'),
      secretAccessKey: envTrim('R2_SECRET_ACCESS_KEY'),
    },
    requestChecksumCalculation: 'WHEN_REQUIRED',
    responseChecksumValidation: 'WHEN_REQUIRED',
  });

  const key = objectKeyForFile(originalName);
  try {
    await client.send(
      new PutObjectCommand({
        Bucket: envTrim('R2_BUCKET'),
        Key: key,
        Body: buffer,
        ContentType: contentType || 'application/octet-stream',
      })
    );
  } catch (err) {
    return { ok: false, error: formatR2Error(err) };
  }

  return {
    ok: true,
    backend: 'r2',
    path: key,
    publicUrl: publicUrlForKey(key),
    bucket: envTrim('R2_BUCKET'),
  };
}

async function deleteFromR2(objectKey) {
  const key = String(objectKey || '').replace(/^\//, '');
  if (!hasR2Credentials() || !key || !key.startsWith('van-ban/')) {
    return { ok: false, skipped: true };
  }
  const { S3Client, DeleteObjectCommand } = require('@aws-sdk/client-s3');
  const client = new S3Client({
    region: 'auto',
    endpoint: `https://${r2AccountId()}.r2.cloudflarestorage.com`,
    forcePathStyle: true,
    credentials: {
      accessKeyId: envTrim('R2_ACCESS_KEY_ID'),
      secretAccessKey: envTrim('R2_SECRET_ACCESS_KEY'),
    },
  });
  try {
    await client.send(
      new DeleteObjectCommand({
        Bucket: envTrim('R2_BUCKET'),
        Key: key,
      })
    );
    return { ok: true };
  } catch (err) {
    return { ok: false, error: formatR2Error(err) };
  }
}

module.exports = {
  isR2Configured,
  hasR2Credentials,
  r2AccountId,
  publicUrlForKey,
  objectKeyForFile,
  uploadToR2,
  deleteFromR2,
};
