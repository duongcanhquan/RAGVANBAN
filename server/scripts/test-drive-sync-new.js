const { test } = require('node:test');
const assert = require('node:assert/strict');
const { pickNewDriveFiles, driveFileIdFromWebhookBody } = require('../src/services/driveIngest');

test('đồng bộ Drive lấy file mới nhất, bỏ file đã số hóa', () => {
  const files = [
    { id: 'old-a', name: 'a.pdf', modifiedTime: '2024-01-01T00:00:00.000Z' },
    { id: 'new-c', name: 'c.pdf', modifiedTime: '2026-08-19T08:00:00.000Z' },
    { id: 'mid-b', name: 'b.pdf', modifiedTime: '2025-06-01T00:00:00.000Z' },
    { id: 'new-d', name: 'd.pdf', modifiedTime: '2026-08-19T09:00:00.000Z' },
  ];
  const picked = pickNewDriveFiles(files, ['old-a', 'mid-b'], 8);
  assert.equal(picked.skipped, 2);
  assert.deepEqual(
    picked.queued.map((f) => f.id),
    ['new-d', 'new-c']
  );
});

test('đồng bộ không kẹt 8 file đầu — file mới vẫn vào hàng', () => {
  const files = Array.from({ length: 12 }, (_, i) => ({
    id: `old-${i}`,
    name: `${i}.pdf`,
    modifiedTime: `2024-01-${String(i + 1).padStart(2, '0')}T00:00:00.000Z`,
  }));
  files.push({ id: 'brand-new', name: 'moi.pdf', modifiedTime: '2026-08-19T12:00:00.000Z' });
  const picked = pickNewDriveFiles(
    files,
    files.filter((f) => f.id !== 'brand-new').map((f) => f.id),
    8
  );
  assert.equal(picked.queued.length, 1);
  assert.equal(picked.queued[0].id, 'brand-new');
  assert.equal(picked.skipped, 12);
});

test('webhook nhận fileId hoặc id thô từ Google Drive Trigger', () => {
  assert.equal(driveFileIdFromWebhookBody({ fileId: '1abcDEF-xyz0123456789abcd' }), '1abcDEF-xyz0123456789abcd');
  assert.equal(
    driveFileIdFromWebhookBody({
      id: '1abcDEF-xyz0123456789abcd',
      name: 'vb.pdf',
      mimeType: 'application/pdf',
    }),
    '1abcDEF-xyz0123456789abcd'
  );
  assert.equal(driveFileIdFromWebhookBody({ action: 'sync_folder', limit: 8 }), '');
  assert.equal(driveFileIdFromWebhookBody({ action: 'ping' }), '');
});
