/**
 * Danh mục tài liệu: tên/mô tả/link phải ghi được; lỗi Supabase không được giả thành công local.
 * node scripts/test-document-catalog.js
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  hydrateDocument,
  catalogPersistError,
  catalogFieldsFromIngest,
} = require('../src/services/documentCatalog');

test('tên hiển thị ưu tiên display_name, mô tả và link lấy từ metadata nếu thiếu cột', () => {
  const d = hydrateDocument({
    id: '1',
    file_name: 'scan.pdf',
    metadata: {
      display_name: 'Quyết định 12/QĐ-UBND',
      mo_ta: 'Quy định thời gian làm việc',
      link_goc: 'https://example.com/qd.pdf',
    },
  });
  assert.equal(d.display_name, 'Quyết định 12/QĐ-UBND');
  assert.equal(d.mo_ta, 'Quy định thời gian làm việc');
  assert.equal(d.storage_url, 'https://example.com/qd.pdf');
  assert.match(d.label, /Quyết định 12/);
});

test('không có display_name thì dùng file_name', () => {
  const d = hydrateDocument({ file_name: 'van-ban.pdf', metadata: {} });
  assert.equal(d.display_name, 'van-ban.pdf');
  assert.equal(d.mo_ta, '');
});

test('payload ingest mang tên và mô tả người nhập', () => {
  const row = catalogFieldsFromIngest({
    fileName: 'a.pdf',
    displayName: 'Thông tư 01',
    description: 'Hướng dẫn thủ tục',
    publicUrl: 'https://cdn.example/a.pdf',
  });
  assert.equal(row.display_name, 'Thông tư 01');
  assert.equal(row.mo_ta, 'Hướng dẫn thủ tục');
  assert.equal(row.metadata.display_name, 'Thông tư 01');
  assert.equal(row.metadata.mo_ta, 'Hướng dẫn thủ tục');
});

test('Supabase đã cấu hình + ghi local = lỗi, không được báo số hóa thành công', () => {
  const msg = catalogPersistError(
    { ok: true, id: 'local-1', source: 'local' },
    { supabaseConfigured: true }
  );
  assert.ok(msg);
  assert.match(msg, /danh mục|Supabase/i);
});

test('không có id catalog = lỗi', () => {
  const msg = catalogPersistError({ ok: true, id: null }, { supabaseConfigured: false });
  assert.ok(msg);
});

test('ghi catalog thật thì không lỗi', () => {
  assert.equal(
    catalogPersistError({ ok: true, id: 'uuid', source: 'supabase' }, { supabaseConfigured: true }),
    null
  );
  assert.equal(
    catalogPersistError({ ok: true, id: 'local-1', source: 'local' }, { supabaseConfigured: false }),
    null
  );
});

test('chưa lưu file gốc thì không được báo số hóa thành công', () => {
  const { originalStoreError } = require('../src/services/documentCatalog');
  assert.match(originalStoreError({ ok: false, skipped: true }), /file gốc|R2|Storage/i);
  assert.match(originalStoreError({ ok: false, error: 'bucket missing' }), /bucket missing/);
  assert.equal(originalStoreError({ ok: true, path: 'a.pdf' }), null);
});
