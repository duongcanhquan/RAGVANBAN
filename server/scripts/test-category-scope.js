const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  normalizeSelectedIds,
  expandCategoryIds,
  hasCategoryScope,
  applyScopeToIntent,
} = require('../src/services/categoryScope');
const { buildMetadataFilter } = require('../src/services/hybridSearch');
const { buildNoContextAnswer } = require('../src/services/qaChain');

test('mở rộng mục cha gồm mọi mục con', () => {
  const flat = [
    { id: 'hcc', parent_id: null, name: 'Hành chính công' },
    { id: 'cccd', parent_id: 'hcc', name: 'CCCD' },
    { id: 'ho-tich', parent_id: 'hcc', name: 'Hộ tịch' },
    { id: 'bhxh', parent_id: null, name: 'BHXH' },
  ];
  const ids = expandCategoryIds(flat, ['hcc']);
  assert.ok(ids.includes('hcc'));
  assert.ok(ids.includes('cccd'));
  assert.ok(ids.includes('ho-tich'));
  assert.equal(ids.includes('bhxh'), false);
});

test('không chọn mục thì không có phạm vi', () => {
  assert.deepEqual(normalizeSelectedIds([]), []);
  assert.deepEqual(normalizeSelectedIds(['', '  ']), []);
  assert.equal(hasCategoryScope({}), false);
});

test('lọc Pinecone theo category_id hoặc document_id, không nới cả kho', () => {
  const intent = applyScopeToIntent(
    { linh_vuc: 'Thuế' },
    { categoryIds: ['cccd'], documentIds: ['doc-1'], fileNames: ['a.pdf'], labels: ['CCCD'] }
  );
  assert.equal(intent.skipLinhVucFilter, true);
  const filter = buildMetadataFilter(intent);
  const blob = JSON.stringify(filter);
  assert.match(blob, /category_id/);
  assert.match(blob, /document_id/);
  assert.match(blob, /ten_file/);
  assert.equal(blob.includes('"linh_vuc"'), false);
});

test('không có đoạn trong phạm vi thì gợi ý bỏ chọn mục', () => {
  const { answer } = buildNoContextAnswer('lookup', { scopeLabels: ['BHXH', 'CCCD'] });
  assert.match(answer, /phạm vi đã chọn/);
  assert.match(answer, /BHXH/);
});
