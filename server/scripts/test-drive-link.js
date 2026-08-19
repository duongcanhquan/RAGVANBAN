const { test } = require('node:test');
const assert = require('node:assert/strict');
const { parseDriveResource } = require('../src/services/googleDrive');

test('parse link file /view', () => {
  const r = parseDriveResource('https://drive.google.com/file/d/1abcDEF-xyz0123456789/view?usp=sharing');
  assert.equal(r.type, 'file');
  assert.equal(r.id, '1abcDEF-xyz0123456789');
});

test('parse link thư mục', () => {
  const r = parseDriveResource('https://drive.google.com/drive/folders/1folderIDxxxxxxxxxxxxxxxx');
  assert.equal(r.type, 'folder');
  assert.equal(r.id, '1folderIDxxxxxxxxxxxxxxxx');
});

test('parse open?id=', () => {
  const r = parseDriveResource('https://drive.google.com/open?id=1abcDEF-xyz0123456789abcd');
  assert.equal(r.type, 'file');
  assert.equal(r.id, '1abcDEF-xyz0123456789abcd');
});

test('parse raw fileId', () => {
  const r = parseDriveResource('1abcDEF-xyz0123456789abcd');
  assert.equal(r.type, 'file');
  assert.equal(r.id, '1abcDEF-xyz0123456789abcd');
});

test('không phải Drive → null', () => {
  assert.equal(parseDriveResource('https://vanban.chinhphu.vn/x'), null);
});
