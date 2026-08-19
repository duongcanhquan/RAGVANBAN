const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  collectDescendantIds,
  canUseCategory,
  assertCanUseCategory,
  isSuperAdmin,
} = require('../src/services/adminAccess');

const flat = [
  { id: 'nganh', parent_id: null, name: 'Hành chính' },
  { id: 'hang', parent_id: 'nganh', name: 'CCCD' },
  { id: 'chude', parent_id: 'hang', name: 'Cấp lại' },
  { id: 'khac', parent_id: null, name: 'Thuế' },
];

test('grant ngành mở cả hạng mục và chủ đề con', () => {
  const ids = collectDescendantIds(flat, ['nganh']);
  assert.ok(ids.has('nganh'));
  assert.ok(ids.has('hang'));
  assert.ok(ids.has('chude'));
  assert.equal(ids.has('khac'), false);
});

test('editor chỉ upload đúng cây được giao', () => {
  const allowed = collectDescendantIds(flat, ['hang']);
  const editor = { is_active: true, role: 'editor', allowedCategoryIds: allowed };
  assert.equal(canUseCategory(editor, 'hang'), true);
  assert.equal(canUseCategory(editor, 'chude'), true);
  assert.equal(canUseCategory(editor, 'nganh'), false);
  assert.equal(canUseCategory(editor, null), false);
});

test('super_admin upload mọi chuyên mục', () => {
  const admin = { is_active: true, role: 'super_admin' };
  assert.equal(isSuperAdmin(admin), true);
  assert.equal(canUseCategory(admin, 'khac'), true);
  assert.doesNotThrow(() => assertCanUseCategory(admin, null));
});

test('editor thiếu chuyên mục → 403', () => {
  const editor = { is_active: true, role: 'editor', allowedCategoryIds: new Set(['hang']) };
  assert.throws(() => assertCanUseCategory(editor, null), /Chọn chuyên mục/);
  assert.throws(() => assertCanUseCategory(editor, 'khac'), /không được upload/);
});
