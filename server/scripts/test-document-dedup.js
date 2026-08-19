/**
 * Dedup R2 / catalog theo hash nội dung.
 * node scripts/test-document-dedup.js
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  sha256Buffer,
  fileFingerprint,
  existingContentHash,
  decideDuplicate,
  duplicateMessage,
} = require('../src/services/documentDedup');
const { objectKeyForFile, relocateKey } = require('../src/services/r2');

test('cùng bytes thì cùng sha256', () => {
  const a = fileFingerprint(Buffer.from('thong-tu-55'));
  const b = fileFingerprint(Buffer.from('thong-tu-55'));
  const c = fileFingerprint(Buffer.from('thong-tu-56'));
  assert.equal(a.sha256, b.sha256);
  assert.equal(a.byteSize, 11);
  assert.notEqual(a.sha256, c.sha256);
  assert.equal(sha256Buffer(Buffer.from('thong-tu-55')), a.sha256);
});

test('trùng hash → reuse, không tốn R2', () => {
  const hash = sha256Buffer(Buffer.from('same'));
  const existing = { id: 'doc-1', file_name: 'a.pdf', display_name: 'Thông tư 55' };
  const d = decideDuplicate({ sha256: hash }, { byHash: existing, byName: null });
  assert.equal(d.action, 'reuse');
  assert.equal(d.reason, 'content');
  assert.equal(d.document.id, 'doc-1');
  assert.match(duplicateMessage(existing), /Thông tư 55/);
});

test('cùng tên khác hash → replace', () => {
  const d = decideDuplicate(
    { sha256: 'a'.repeat(64) },
    {
      byHash: null,
      byName: { id: 'old', file_name: 'a.pdf', metadata: { content_sha256: 'b'.repeat(64) } },
    }
  );
  assert.equal(d.action, 'replace');
  assert.equal(d.reason, 'filename');
});

test('cùng tên cùng hash trong metadata → reuse', () => {
  const hash = 'c'.repeat(64);
  const d = decideDuplicate(
    { sha256: hash },
    { byHash: null, byName: { id: 'x', metadata: { content_sha256: hash } } }
  );
  assert.equal(d.action, 'reuse');
  assert.equal(existingContentHash({ metadata: { content_sha256: hash } }), hash);
});

test('chưa có trong kho → create', () => {
  const d = decideDuplicate({ sha256: 'd'.repeat(64) }, { byHash: null, byName: null });
  assert.equal(d.action, 'create');
});

test('objectKeyForFile theo hash thì ổn định, không Date.now', () => {
  const hash = 'ab'.repeat(32);
  const a = objectKeyForFile('ND-123.pdf', { folderPath: '', contentHash: hash });
  const b = objectKeyForFile('ND-123.pdf', { folderPath: '', contentHash: hash });
  assert.equal(a, b);
  assert.match(a, /^van-ban\/chua-gan\/by-hash\/[a-f0-9]{32}-ND-123\.pdf$/);
});

test('relocateKey giữ by-hash khi đổi chuyên mục', () => {
  assert.equal(
    relocateKey(
      'van-ban/chua-gan/by-hash/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa-ND-123.pdf',
      'Hành chính công / CCCD'
    ),
    'van-ban/hanh-chinh-cong/cccd/by-hash/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa-ND-123.pdf'
  );
});
