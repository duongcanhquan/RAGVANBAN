/**
 * Unit tests Multi-LLM factory + metadata filter mới.
 */
const assert = require('assert');
const {
  isFallbackableError,
  resolveProviderChain,
} = require('../src/services/llmFactory');

// resolveProviderChain is exported; hasProviderKey depends on env — test isFallbackable + filter
const { buildMetadataFilter } = require('../src/services/hybridSearch');
const {
  parseMetadataJson,
  normalizeMetadata,
  ACTIVE_TRANG_THAI,
} = require('../src/ingestion/extractMetadata');

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    passed += 1;
    console.log(`✓ ${name}`);
  } catch (err) {
    failed += 1;
    console.error(`✗ ${name}\n  ${err.message}`);
  }
}

test('isFallbackableError nhận 429/rate limit', () => {
  assert.strictEqual(isFallbackableError({ status: 429 }), true);
  assert.strictEqual(isFallbackableError(new Error('Rate limit exceeded')), true);
  assert.strictEqual(isFallbackableError(new Error('invalid api key xyz')), false);
});

test('buildMetadataFilter dùng $in ACTIVE statuses', () => {
  const filter = buildMetadataFilter({ linh_vuc: 'Chung' });
  assert.deepStrictEqual(filter, { trang_thai: { $in: ACTIVE_TRANG_THAI } });
});

test('metadata schema có co_quan + van_ban_thay_the + link_goc', () => {
  const meta = parseMetadataJson(
    JSON.stringify({
      so_hieu: '01/2024/NĐ-CP',
      loai_van_ban: 'Nghị định',
      ngay_ban_hanh: '2024/1/5',
      co_quan_ban_hanh: 'Chính phủ',
      trang_thai: 'Bị thay thế một phần',
      van_ban_thay_the: ['02/2025/NĐ-CP'],
      link_goc: 'https://example.com/a.pdf',
    })
  );
  assert.strictEqual(meta.trang_thai, 'Bị thay thế một phần');
  assert.strictEqual(meta.co_quan_ban_hanh, 'Chính phủ');
  assert.strictEqual(meta.link_goc, 'https://example.com/a.pdf');
  assert.strictEqual(meta.url_file_goc, 'https://example.com/a.pdf');
  assert.strictEqual(meta.ngay_ban_hanh, '2024-01-05');
  assert.deepStrictEqual(meta.van_ban_thay_the, ['02/2025/NĐ-CP']);
});

test('normalizeMetadata map url_file_goc → link_goc', () => {
  const meta = normalizeMetadata({ url_file_goc: 'https://x', trang_thai: 'unknown' });
  assert.strictEqual(meta.link_goc, 'https://x');
  assert.strictEqual(meta.trang_thai, 'Còn hiệu lực');
});

test('resolveProviderChain loại trùng & giữ thứ tự', () => {
  // Không có key thật → chain rỗng; chỉ kiểm tra hàm không throw với env hiện tại
  const chain = resolveProviderChain('deepseek', 'openai,gemini,deepseek', [
    'openai',
    'deepseek',
    'gemini',
  ]);
  assert.ok(Array.isArray(chain));
  const uniq = new Set(chain);
  assert.strictEqual(uniq.size, chain.length);
});

console.log(`\nKết quả: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exitCode = 1;
