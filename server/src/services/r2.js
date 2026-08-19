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

function slugSegment(name) {
  const raw = String(name || '').trim();
  if (!raw) return '';
  return (
    raw
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/đ/g, 'd')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 60) || 'muc'
  );
}

/** van-ban/hanh-chinh-cong/cccd — tránh lẫn file giữa các chuyên mục. */
function r2FolderPrefix(folderPath) {
  const parts = String(folderPath || '')
    .split('/')
    .map((s) => slugSegment(s.trim()))
    .filter(Boolean);
  return ['van-ban', ...(parts.length ? parts : ['chua-gan'])].join('/');
}

function objectKeyForFile(originalName, { folderPath, contentHash } = {}) {
  const safe = String(originalName || 'document.bin').replace(/[^a-zA-Z0-9._\-\u00C0-\u024F]/g, '_');
  const hash = String(contentHash || '')
    .replace(/[^a-f0-9]/gi, '')
    .toLowerCase()
    .slice(0, 32);
  if (hash) {
    return `${r2FolderPrefix(folderPath)}/by-hash/${hash}-${safe}`;
  }
  const day = new Date().toISOString().slice(0, 10);
  return `${r2FolderPrefix(folderPath)}/${day}/${Date.now()}-${safe}`;
}

function s3Client() {
  const { S3Client } = require('@aws-sdk/client-s3');
  return new S3Client({
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

async function headR2Object(objectKey) {
  const key = String(objectKey || '').replace(/^\//, '');
  if (!hasR2Credentials() || !key) return { ok: false, skipped: true };
  const { HeadObjectCommand } = require('@aws-sdk/client-s3');
  const client = s3Client();
  try {
    await client.send(
      new HeadObjectCommand({
        Bucket: envTrim('R2_BUCKET'),
        Key: key,
      })
    );
    return { ok: true, path: key, publicUrl: publicUrlForKey(key) };
  } catch (err) {
    const status = Number(err?.$metadata?.httpStatusCode || err?.statusCode || 0);
    if (status === 404 || /NotFound|NoSuchKey/i.test(String(err?.name || err?.Code || err?.message || ''))) {
      return { ok: false, missing: true };
    }
    return { ok: false, error: formatR2Error(err) };
  }
}

async function uploadToR2(buffer, originalName, contentType = 'application/octet-stream', opts = {}) {
  if (!hasR2Credentials()) {
    return { ok: false, skipped: true, reason: 'R2 chưa cấu hình' };
  }
  if (!publicBaseUrl() || isPlaceholder(publicBaseUrl())) {
    return {
      ok: false,
      error: 'Thiếu R2_PUBLIC_BASE_URL (bật Public Development URL trên bucket hoặc gắn custom domain)',
    };
  }

  const { sha256Buffer } = require('./documentDedup');
  const contentHash = opts.contentHash || sha256Buffer(buffer);
  const key = objectKeyForFile(originalName, { folderPath: opts.folderPath, contentHash });
  const existed = await headR2Object(key);
  if (existed.ok) {
    return {
      ok: true,
      backend: 'r2',
      path: key,
      publicUrl: existed.publicUrl || publicUrlForKey(key),
      bucket: envTrim('R2_BUCKET'),
      reused: true,
      contentHash,
    };
  }

  const { PutObjectCommand } = require('@aws-sdk/client-s3');
  const client = s3Client();
  try {
    await client.send(
      new PutObjectCommand({
        Bucket: envTrim('R2_BUCKET'),
        Key: key,
        Body: buffer,
        ContentType: contentType || 'application/octet-stream',
        Metadata: { sha256: contentHash },
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
    reused: false,
    contentHash,
  };
}

function relocateKey(oldKey, folderPath) {
  const from = String(oldKey || '').replace(/^\//, '');
  const parts = from.split('/').filter(Boolean);
  const filePart = parts[parts.length - 1] || 'file.bin';
  const maybeDate = parts[parts.length - 2] || '';
  if (maybeDate === 'by-hash') {
    return `${r2FolderPrefix(folderPath)}/by-hash/${filePart}`;
  }
  const day = /^\d{4}-\d{2}-\d{2}$/.test(maybeDate)
    ? maybeDate
    : new Date().toISOString().slice(0, 10);
  return `${r2FolderPrefix(folderPath)}/${day}/${filePart}`;
}

async function moveR2Object(oldKey, folderPath) {
  const from = String(oldKey || '').replace(/^\//, '');
  if (!hasR2Credentials() || !from.startsWith('van-ban/')) {
    return { ok: false, skipped: true };
  }
  const to = relocateKey(from, folderPath);
  if (from === to) return { ok: true, skipped: true, path: from, publicUrl: publicUrlForKey(from) };

  const { CopyObjectCommand, DeleteObjectCommand } = require('@aws-sdk/client-s3');
  const bucket = envTrim('R2_BUCKET');
  const client = s3Client();
  try {
    await client.send(
      new CopyObjectCommand({
        Bucket: bucket,
        CopySource: `${bucket}/${from.split('/').map(encodeURIComponent).join('/')}`,
        Key: to,
      })
    );
    await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: from }));
    return { ok: true, path: to, publicUrl: publicUrlForKey(to) };
  } catch (err) {
    return { ok: false, error: formatR2Error(err) };
  }
}

async function deleteFromR2(objectKey) {
  const key = String(objectKey || '').replace(/^\//, '');
  if (!hasR2Credentials() || !key || !key.startsWith('van-ban/')) {
    return { ok: false, skipped: true };
  }
  const { DeleteObjectCommand } = require('@aws-sdk/client-s3');
  const client = s3Client();
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

function r2Status() {
  const pub = publicBaseUrl();
  return {
    hasCredentials: hasR2Credentials(),
    hasPublicUrl: Boolean(pub) && !isPlaceholder(pub),
    configured: isR2Configured(),
    bucket: hasR2Credentials() ? envTrim('R2_BUCKET') : '',
    publicBaseUrl: pub && !isPlaceholder(pub) ? pub : '',
    accountHint: r2AccountId() ? `${r2AccountId().slice(0, 8)}…` : '',
  };
}

async function downloadFromR2(objectKey) {
  const key = String(objectKey || '').replace(/^\//, '');
  if (!hasR2Credentials() || !key) {
    return { ok: false, error: 'R2 chưa cấu hình hoặc thiếu đường dẫn' };
  }
  const { GetObjectCommand } = require('@aws-sdk/client-s3');
  const client = s3Client();
  try {
    const res = await client.send(
      new GetObjectCommand({
        Bucket: envTrim('R2_BUCKET'),
        Key: key,
      })
    );
    const chunks = [];
    for await (const part of res.Body) chunks.push(part);
    const buffer = Buffer.concat(chunks);
    return {
      ok: true,
      buffer,
      contentType: res.ContentType || 'application/octet-stream',
      path: key,
      publicUrl: publicUrlForKey(key),
    };
  } catch (err) {
    return { ok: false, error: formatR2Error(err) };
  }
}

async function pingR2Write() {
  if (!hasR2Credentials()) return { ok: false, error: 'Chưa đủ key R2 (Account ID, Access Key, Secret, Bucket)' };
  const key = `van-ban/_health/${Date.now()}-ping.txt`;
  const { PutObjectCommand, DeleteObjectCommand } = require('@aws-sdk/client-s3');
  const client = s3Client();
  const bucket = envTrim('R2_BUCKET');
  try {
    await client.send(
      new PutObjectCommand({
        Bucket: bucket,
        Key: key,
        Body: Buffer.from('ragvanban-r2-ping'),
        ContentType: 'text/plain',
      })
    );
    await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
    return {
      ok: true,
      bucket,
      hasPublicUrl: Boolean(publicBaseUrl()) && !isPlaceholder(publicBaseUrl()),
      publicBaseUrl: publicBaseUrl() && !isPlaceholder(publicBaseUrl()) ? publicBaseUrl() : '',
    };
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
  r2FolderPrefix,
  relocateKey,
  uploadToR2,
  headR2Object,
  moveR2Object,
  deleteFromR2,
  downloadFromR2,
  r2Status,
  pingR2Write,
};
