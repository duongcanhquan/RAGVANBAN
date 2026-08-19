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
  resolveQaMode,
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
  collapseAnswerCitations,
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

  test('resolveQaMode: tab Tra cứu không bị đổi sang Tư vấn', () => {
    assert.strictEqual(resolveQaMode('lookup', { muc_dich: 'tu_van' }), 'lookup');
    assert.strictEqual(resolveQaMode('advise', { muc_dich: 'tra_cuu' }), 'advise');
    assert.strictEqual(resolveQaMode('lookup', { muc_dich: 'so_sanh' }), 'compare');
  });

  test('heuristicIntent không gắn Hành chính công chỉ vì chữ thủ tục', () => {
    const intent = heuristicIntent('Thủ tục kỷ luật học sinh khi đi muộn?');
    assert.notEqual(intent.linh_vuc, 'Hành chính công');
    assert.strictEqual(intent.muc_dich, 'tu_van');
  });

  test('buildMetadataFilter bỏ lọc lĩnh vực khi skipLinhVucFilter', () => {
    const filter = buildMetadataFilter({ linh_vuc: 'Thuế', skipLinhVucFilter: true });
    assert.ok(!filter.$and);
    assert.ok(filter.trang_thai.$in);
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

  test('buildMetadataFilter phạm vi danh mục không nới cả kho khi hết kết quả lĩnh vực', () => {
    const filter = buildMetadataFilter({
      linh_vuc: 'Thuế',
      skipLinhVucFilter: true,
      category_id_in: ['cccd'],
    });
    const blob = JSON.stringify(filter);
    assert.match(blob, /category_id/);
    assert.equal(blob.includes('"linh_vuc"'), false);
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

  test('buildSourceList gộp nhiều Điều cùng một văn bản', () => {
    const sources = buildSourceList([
      {
        loai_van_ban: 'Nghị định',
        so_hieu: '01/2024/NĐ-CP',
        url_file_goc: 'https://example.com/a.pdf',
        dieu: '1',
        text: 'a',
      },
      {
        loai_van_ban: 'Nghị định',
        so_hieu: '01/2024/NĐ-CP',
        url_file_goc: 'https://example.com/a.pdf',
        dieu: '5',
        khoan: '2',
        text: 'b',
      },
      {
        loai_van_ban: 'Nghị định',
        so_hieu: '01/2024/NĐ-CP',
        url_file_goc: 'https://example.com/a.pdf',
        dieu: '8',
        text: 'c',
      },
      {
        loai_van_ban: 'Nghị định',
        so_hieu: '01/2024/NĐ-CP',
        url_file_goc: 'https://example.com/a.pdf',
        dieu: '12',
        text: 'd',
      },
    ]);
    assert.strictEqual(sources.length, 1);
    assert.strictEqual(sources[0].title, 'Nghị định 01/2024/NĐ-CP');
    assert.ok(!/Điều/.test(sources[0].title));
    assert.ok(sources[0].dieu.includes('1'));
  });

  test('formatContext gom đoạn theo văn bản, không 4 nguồn rời', () => {
    const ctx = formatContext([
      { text: 'A', so_hieu: '01/2024/NĐ-CP', loai_van_ban: 'Nghị định', dieu: '1', url_file_goc: 'https://x/a' },
      { text: 'B', so_hieu: '01/2024/NĐ-CP', loai_van_ban: 'Nghị định', dieu: '5', url_file_goc: 'https://x/a' },
    ]);
    const numbered = ctx.match(/\[#\d+\]/g) || [];
    assert.strictEqual(numbered.length, 1);
    assert.ok(ctx.includes('Điều 1'));
    assert.ok(ctx.includes('Điều 5'));
  });

  test('collapseAnswerCitations: Nguồn một lần / URL; link trùng thành chữ', () => {
    const raw = `Theo [NĐ 01 Điều 1](https://x.com/a.pdf) và [NĐ 01 Điều 5](https://x.com/a.pdf).

**Nguồn:**
- [NĐ 01 · Điều 1](https://x.com/a.pdf)
- [NĐ 01 · Điều 5](https://x.com/a.pdf)
- [NĐ 01 · Điều 8](https://x.com/a.pdf)
- [NĐ 01 · Điều 12](https://x.com/a.pdf)

**Kiểm chứng:** ghi chú 1
**Kiểm chứng:** ghi chú 2`;
    const out = collapseAnswerCitations(raw);
    const nguonLinks = [...out.matchAll(/\[([^\]]+)\]\((https:\/\/x\.com\/a\.pdf)\)/g)];
    assert.strictEqual(nguonLinks.length, 1, 'chỉ còn 1 markdown link cho cùng URL');
    assert.ok((out.match(/\*\*Kiểm chứng:\*\*/g) || []).length <= 1);
    assert.ok(/Điều 5/.test(out));
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

  test('formatContext gọn metadata, không lặp nhãn rỗng', () => {
    const ctx = formatContext([
      {
        text: 'Điều 1. Thời hạn 07 ngày.',
        loai_van_ban: 'Nghị định',
        so_hieu: '01/2024/NĐ-CP',
        co_quan_ban_hanh: 'Chính phủ',
        trang_thai: 'Còn hiệu lực',
        url_file_goc: 'https://example.com/a.pdf',
      },
    ]);
    assert.ok(ctx.includes('Điều 1'));
    assert.ok(!/Cơ quan:/.test(ctx));
    assert.ok(!/Quan hệ: —/.test(ctx));
    assert.ok(!/BẢN ĐỒ NGUỒN/.test(ctx));
  });

  test('shouldSkipIntentLlm với câu ngắn không neo', () => {
    assert.equal(shouldSkipIntentLlm('Thời hạn xử lý kỷ luật học sinh?'), true);
  });

  console.log(`\nKết quả: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exitCode = 1;
}

run().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
