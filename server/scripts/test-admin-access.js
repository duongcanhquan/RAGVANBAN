const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  collectDescendantIds,
  canUseCategory,
  assertCanUseCategory,
  assertCanManageCategory,
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

test('super_admin không cần cây chuyên mục để được quyền', () => {
  const { attachCategoryAccess } = require('../src/services/adminAccess');
  const admin = attachCategoryAccess(
    { id: 'sa', role: 'super_admin', is_active: true },
    ['nganh'],
    []
  );
  assert.equal(canUseCategory(admin, 'khac'), true);
  assert.equal(canUseCategory(admin, null), true);
});

test('editor attachCategoryAccess mở cả cây con từ grant', () => {
  const { attachCategoryAccess } = require('../src/services/adminAccess');
  const admin = attachCategoryAccess(
    { id: 'ed', role: 'editor', is_active: true },
    ['hang'],
    flat
  );
  assert.equal(canUseCategory(admin, 'hang'), true);
  assert.equal(canUseCategory(admin, 'chude'), true);
  assert.equal(canUseCategory(admin, 'nganh'), false);
});

test('ttlMap hết hạn thì miss', () => {
  const { createTtlMap } = require('../src/services/ttlMap');
  const map = createTtlMap({ ttlMs: 20, max: 4 });
  map.set('a', { role: 'super_admin' });
  assert.equal(map.get('a').role, 'super_admin');
  const start = Date.now();
  while (Date.now() - start < 30) {
    /* spin */
  }
  assert.equal(map.get('a'), undefined);
});

  test('GET /brain không chờ describeIndex Pinecone', () => {
    const fs = require('fs');
    const path = require('path');
    const src = fs.readFileSync(path.resolve(__dirname, '../src/routes/quantri.js'), 'utf8');
    const start = src.indexOf("router.get('/brain'");
    const dimRoute = src.indexOf("router.get('/brain/embedding-dim'");
    const end = dimRoute > start ? dimRoute : src.indexOf("router.put('/brain'");
    assert.ok(start >= 0 && end > start, 'không tìm thấy GET /brain');
    const block = src.slice(start, end);
    assert.ok(!/await embeddingDimPayload\(/.test(block), 'GET /brain phải trả form trước, không await Pinecone');
    assert.ok(/peekPineconeIndexDimension|embeddingDimPayloadFast/.test(block));
  });

  test('thử embedding so sánh với dimension index, không nhầm dims thành indexDim', () => {
    const fs = require('fs');
    const path = require('path');
    const src = fs.readFileSync(path.resolve(__dirname, '../src/routes/quantri.js'), 'utf8');
    const start = src.indexOf("purpose === 'embedding'");
    assert.ok(start >= 0);
    const block = src.slice(start, start + 900);
    assert.ok(!/indexDim:\s*dims/.test(block), 'không được gán chiều vector vào indexDim');
    assert.ok(/embeddingAlignmentReport\(\s*\{\s*model:\s*creds\.embeddingModel,\s*indexDim\s*\}/.test(block));
  });

test('editor thiếu chuyên mục → 403', () => {
  const editor = { is_active: true, role: 'editor', allowedCategoryIds: new Set(['hang']) };
  assert.throws(() => assertCanUseCategory(editor, null), /Chọn chuyên mục/);
  assert.throws(() => assertCanUseCategory(editor, 'khac'), /không được upload/);
});

test('editor được sửa chuyên mục trong cây được giao, không tạo gốc', () => {
  const allowed = collectDescendantIds(flat, ['hang']);
  const editor = { is_active: true, role: 'editor', allowedCategoryIds: allowed };
  assert.doesNotThrow(() => assertCanManageCategory(editor, 'chude'));
  assert.throws(() => assertCanManageCategory(editor, null, { creatingRoot: true }), /chuyên mục gốc/);
  assert.throws(() => assertCanManageCategory(editor, 'khac'), /không được quản lý/);
});
