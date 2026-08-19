/**
 * Tránh lưu R2 / vector trùng: cùng bytes thì tái sử dụng; cùng tên khác nội dung thì ghi đè.
 */
const { createHash } = require('crypto');

function sha256Buffer(buffer) {
  const buf = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer || '');
  return createHash('sha256').update(buf).digest('hex');
}

function fileFingerprint(buffer) {
  const buf = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer || '');
  return { sha256: sha256Buffer(buf), byteSize: buf.length };
}

function existingContentHash(doc) {
  if (!doc) return '';
  return String(doc.content_sha256 || doc.metadata?.content_sha256 || '')
    .replace(/[^a-f0-9]/gi, '')
    .toLowerCase();
}

/**
 * @returns {{ action: 'reuse'|'replace'|'create', reason: string|null, document: object|null }}
 */
function decideDuplicate({ sha256 }, { byHash, byName } = {}) {
  const hash = String(sha256 || '')
    .replace(/[^a-f0-9]/gi, '')
    .toLowerCase();
  if (hash && byHash) {
    return { action: 'reuse', reason: 'content', document: byHash };
  }
  if (byName) {
    const old = existingContentHash(byName);
    if (hash && old && old === hash) {
      return { action: 'reuse', reason: 'content', document: byName };
    }
    return { action: 'replace', reason: 'filename', document: byName };
  }
  return { action: 'create', reason: null, document: null };
}

function duplicateMessage(doc) {
  const name = doc?.display_name || doc?.file_name || 'tài liệu đã có';
  return `File trùng nội dung với «${name}» — không lưu thêm R2/vector. Dùng Số hóa lại nếu cần xử lý lại.`;
}

module.exports = {
  sha256Buffer,
  fileFingerprint,
  existingContentHash,
  decideDuplicate,
  duplicateMessage,
};
