const { test } = require('node:test');
const assert = require('node:assert/strict');
const { pickNewDriveFiles, driveFileIdFromWebhookBody, summarizeDriveUrlJob } = require('../src/services/driveIngest');

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

test('tóm tắt số hóa folder Drive có tên file, chunks và link bản gốc', () => {
  const folderId = '1folderIDxxxxxxxxxxxxxxxx';
  const summary = summarizeDriveUrlJob([
    {
      type: 'folder',
      folderId,
      webViewLink: `https://drive.google.com/drive/folders/${folderId}`,
      processed: 3,
      results: [
        {
          ok: true,
          id: 'doc-1',
          fileName: 'QĐ 01.pdf',
          chunks: 12,
          driveWebViewLink: 'https://drive.google.com/file/d/doc-1/view',
        },
        {
          ok: true,
          id: 'doc-2',
          fileName: 'QĐ 02.pdf',
          chunks: 8,
          driveWebViewLink: 'https://drive.google.com/file/d/doc-2/view',
        },
        {
          ok: true,
          id: 'doc-3',
          name: 'QĐ 03.pdf',
          chunks: 5,
          driveWebViewLink: 'https://drive.google.com/file/d/doc-3/view',
        },
      ],
    },
  ]);
  assert.equal(summary.displayName, '3 file từ Google Drive');
  assert.notEqual(summary.displayName, 'Drive');
  assert.equal(summary.processed, 3);
  assert.equal(summary.chunks, 25);
  assert.equal(summary.files.length, 3);
  assert.equal(summary.driveWebViewLink, `https://drive.google.com/drive/folders/${folderId}`);
  assert.equal(summary.files[0].driveWebViewLink, 'https://drive.google.com/file/d/doc-1/view');
  assert.ok(summary.files.every((f) => f.driveWebViewLink));
});

test('tóm tắt folder không có id catalog thì processed = 0', () => {
  const summary = summarizeDriveUrlJob([
    {
      type: 'folder',
      folderId: '1folderIDxxxxxxxxxxxxxxxx',
      processed: 3,
      results: [
        { ok: false, name: 'a.pdf', error: "Could not find the 'byte_size' column" },
        { ok: false, name: 'b.pdf', error: "Could not find the 'byte_size' column" },
        { ok: false, name: 'c.pdf', error: "Could not find the 'byte_size' column" },
      ],
    },
  ]);
  assert.equal(summary.processed, 0);
  assert.equal(summary.id, undefined);
  assert.equal(summary.failed, 3);
});
