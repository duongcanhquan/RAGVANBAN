/**
 * Unit tests Bước 3 — không cần API key.
 * Chạy: node scripts/test-chat-unit.js
 */

const assert = require('assert');
const {
  parseIntentResponse,
  heuristicIntent,
  routeIntent,
  shouldSkipIntentLlm,
} = require('../src/services/intentRouter');
const {
  buildMetadataFilter,
  normalizeMatch,
  rankMatches,
  dedupeAndRank,
} = require('../src/services/hybridSearch');
const {
  formatContext,
  buildSourceList,
  extractSourceLinksFromAnswer,
  buildNoContextAnswer,
} = require('../src/services/qaChain');

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

async function testAsync(name, fn) {
  try {
    await fn();
    passed += 1;
    console.log(`✓ ${name}`);
  } catch (err) {
    failed += 1;
    console.error(`✗ ${name}\n  ${err.message}`);
  }
}

async function run() {
  test('parseIntentResponse đọc JSON', () => {
    const intent = parseIntentResponse(
      '{"linh_vuc":"Thuế","keywords":["thuế TNCN"],"needs_retrieval":true}'
    );
    assert.strictEqual(intent.linh_vuc, 'Thuế');
    assert.deepStrictEqual(intent.keywords, ['thuế TNCN']);
  });

  test('heuristicIntent nhận lĩnh vực thuế', () => {
    const intent = heuristicIntent('Mức thuế thu nhập cá nhân năm nay?');
    assert.strictEqual(intent.linh_vuc, 'Thuế');
  });

  await testAsync('routeIntent không LLM', async () => {
    const intent = await routeIntent('Thủ tục hành chính cấp giấy phép', { useLlm: false });
    assert.ok(intent.linh_vuc);
    assert.strictEqual(intent.needs_retrieval, true);
  });

  test('shouldSkipIntentLlm với câu hỏi neo số hiệu', () => {
    assert.equal(shouldSkipIntentLlm('Nghị định 01/2024/NĐ-CP còn hiệu lực?'), true);
  });

  test('buildMetadataFilter luôn loại trừ hết hiệu lực ($in active)', () => {
    const filter = buildMetadataFilter({ linh_vuc: 'Chung' });
    assert.ok(filter.trang_thai.$in);
    assert.ok(filter.trang_thai.$in.includes('Còn hiệu lực'));
    assert.ok(filter.trang_thai.$in.includes('Bị thay thế một phần'));
  });

  test('buildMetadataFilter $and khi có lĩnh vực', () => {
    const filter = buildMetadataFilter({ linh_vuc: 'Thuế' });
    assert.ok(filter.$and);
    assert.strictEqual(filter.$and.length, 2);
  });

  test('rankMatches giữ nhiều đoạn cùng số hiệu, điểm cao trước', () => {
    const ranked = rankMatches([
      normalizeMatch({
        id: '1',
        score: 0.5,
        metadata: {
          text: 'a',
          so_hieu: '01',
          url_file_goc: 'u',
          ngay_ban_hanh: '2020-01-01',
          dieu: '1',
        },
      }),
      normalizeMatch({
        id: '2',
        score: 0.4,
        metadata: {
          text: 'b',
          so_hieu: '01',
          url_file_goc: 'u',
          ngay_ban_hanh: '2024-01-01',
          dieu: '5',
        },
      }),
    ]);
    assert.strictEqual(ranked.length, 2);
    assert.strictEqual(ranked[0].id, '1');
  });

  test('dedupeAndRank vẫn là hàm xếp hạng (không còn gộp còn 1 chunk)', () => {
    const ranked = dedupeAndRank([
      normalizeMatch({
        id: '1',
        score: 0.9,
        metadata: { text: 'a', so_hieu: '01', url_file_goc: 'u' },
      }),
      normalizeMatch({
        id: '2',
        score: 0.1,
        metadata: { text: 'b', so_hieu: '01', url_file_goc: 'u' },
      }),
    ]);
    assert.ok(ranked.length >= 2);
  });

  test('formatContext + buildSourceList', () => {
    const matches = [
      {
        text: 'Điều 1...',
        loai_van_ban: 'Nghị định',
        so_hieu: '01/2024/NĐ-CP',
        url_file_goc: 'https://example.com/a.pdf',
        trang_thai: 'Còn hiệu lực',
      },
    ];
    const ctx = formatContext(matches);
    assert.ok(ctx.includes('Điều 1'));
    const sources = buildSourceList(matches);
    assert.strictEqual(sources[0].title, 'Nghị định 01/2024/NĐ-CP');
  });

  test('extractSourceLinksFromAnswer', () => {
    const links = extractSourceLinksFromAnswer(
      'Trả lời...\nNguồn:\n- [Nghị định 01](https://x.com/a.pdf)'
    );
    assert.strictEqual(links.length, 1);
    assert.strictEqual(links[0].url, 'https://x.com/a.pdf');
  });

  test('buildNoContextAnswer không bịa', () => {
    const { answer, sources } = buildNoContextAnswer();
    assert.ok(/không tìm thấy/i.test(answer));
    assert.strictEqual(sources.length, 0);
  });

  console.log(`\nKết quả: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exitCode = 1;
}

run().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
