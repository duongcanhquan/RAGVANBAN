/**
 * Gợi ý tìm nhanh trên chat công khai: chỉ văn bản trong kho + chip admin tự thêm.
 * node scripts/test-quick-suggest.js
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  isDemoKeyword,
  keywordsFromDocuments,
  mergePublicQuickKeywords,
} = require('../src/services/quickSuggest');
const { DEFAULT_KEYWORDS } = require('../src/services/appSettings');

test('chip mẫu CCCD/BHXH là demo, không hiện trên chat công khai', () => {
  assert.equal(isDemoKeyword(DEFAULT_KEYWORDS[0]), true);
  assert.equal(
    isDemoKeyword({
      id: 'k2',
      label: 'Hiệu lực VB',
      query: 'Nghị định nào còn hiệu lực về thủ tục hành chính?',
    }),
    true
  );
  assert.equal(
    isDemoKeyword({
      id: 'mine',
      label: 'QĐ 12',
      query: 'Quyết định 12/QĐ-UBND quy định những gì?',
    }),
    false
  );
});

test('không có tài liệu và không có chip tự thêm → danh sách trống', () => {
  const items = mergePublicQuickKeywords({
    catalogItems: [],
    savedItems: DEFAULT_KEYWORDS,
  });
  assert.deepEqual(items, []);
});

test('gợi ý lấy số hiệu / tên văn bản trong kho', () => {
  const items = keywordsFromDocuments([
    {
      id: 'a',
      file_name: 'qd.pdf',
      so_hieu: '12/QĐ-UBND',
      display_name: 'Quyết định thời gian làm việc',
    },
    {
      id: 'b',
      file_name: 'noi-quy.pdf',
      metadata: { display_name: 'Nội quy học đường' },
    },
  ]);
  assert.ok(items.some((it) => /12\/QĐ-UBND/.test(it.label)));
  assert.ok(items.some((it) => /Nội quy học đường/.test(it.label)));
  assert.equal(
    items.some((it) => /CCCD|BHXH|GPXD/i.test(`${it.label} ${it.query}`)),
    false
  );
});

test('chip admin tự thêm đi cùng gợi ý từ văn bản, bỏ demo', () => {
  const items = mergePublicQuickKeywords({
    catalogItems: [{ id: 'a', file_name: 'qd.pdf', so_hieu: '12/QĐ-UBND' }],
    savedItems: [
      ...DEFAULT_KEYWORDS,
      { id: 'mine', label: 'Làm việc', query: 'Thời gian làm việc theo QĐ 12', mode: 'lookup' },
    ],
  });
  assert.ok(items.some((it) => it.id === 'mine'));
  assert.ok(items.some((it) => /12\/QĐ-UBND/.test(it.label)));
  assert.equal(items.some((it) => it.id === 'k1'), false);
});
