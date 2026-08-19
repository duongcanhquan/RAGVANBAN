/**
 * Regression — lỗi thật tìm được khi rà soát toàn hệ (P0/P1).
 * node scripts/test-audit-hardening.js
 */

const assert = require('assert');
const { EventEmitter } = require('events');
const {
  compactSoHieu,
  extractSoHieuList,
  extractRelationsFromText,
  chunkLegalText,
} = require('../src/ingestion/legalChunker');
const { extractMetadataFromPrefix } = require('../src/ingestion/extractMetadata');
const { chunkTextWithMetadata } = require('../src/ingestion/chunkDocuments');
const { normalizeRag } = require('../src/services/ragConfig');
const { isAllowedUpload } = require('../src/ingestion/extractAnyText');
const { isFollowUpQuestion, remember, recall } = require('../src/services/sessionSearchCache');
const { verifyAnswerAgainstMatches } = require('../src/services/citationVerify');
const { upsertChunksToPinecone } = require('../src/ingestion/upsertToPinecone');
const { hybridSearch, buildMetadataFilter } = require('../src/services/hybridSearch');
const { listenSseAbort } = require('../src/services/sseAbort');
const { publicErrorMessage } = require('../src/services/publicError');
const { driveExportPlan } = require('../src/services/googleDrive');

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

function mockPinecone() {
  const calls = { deleteMany: [], upsert: [] };
  const ns = {
    deleteMany: async (arg) => {
      calls.deleteMany.push(arg);
    },
    upsert: async (arg) => {
      if (!arg?.records || arg.records.length === 0) {
        throw new Error('Must pass in at least 1 record to upsert.');
      }
      calls.upsert.push(arg);
    },
    query: async () => ({ matches: [] }),
  };
  return {
    calls,
    client: { Index: () => ns },
    ns,
  };
}

async function run() {
  test('số hiệu cuối câu không nuốt dấu chấm', () => {
    const list = extractSoHieuList('Theo Nghị định 02/2020/NĐ-CP.');
    assert.ok(list.length, 'không bắt được số hiệu');
    assert.ok(
      list.every((s) => !s.endsWith('.')),
      JSON.stringify(list)
    );
    assert.strictEqual(compactSoHieu('02/2020/NĐ-CP.'), '02/2020/NĐ-CP');
  });

  test('câu hỗn hợp: thay thế A và bãi bỏ B không gán nhầm', () => {
    const rel = extractRelationsFromText(
      'Thay thế Nghị định số 01/2020/NĐ-CP và bãi bỏ Nghị định số 02/2020/NĐ-CP.'
    );
    const thay = rel.van_ban_thay_the.map(compactSoHieu);
    const bo = rel.van_ban_bai_bo.map(compactSoHieu);
    assert.ok(thay.some((s) => s.includes('01/2020')), JSON.stringify(rel));
    assert.ok(bo.some((s) => s.includes('02/2020')), JSON.stringify(rel));
    assert.ok(!bo.some((s) => s.includes('01/2020')), '01 bị nhét vào bãi bỏ');
    assert.ok(!thay.some((s) => s.includes('02/2020')), '02 bị nhét vào thay thế');
  });

  test('Điều rất dài bị cắt gần chunkSize', () => {
    const body = `Điều 1. Nội dung\n${'A'.repeat(8000)}`;
    const chunks = chunkLegalText(body, { chunkSize: 400 });
    assert.ok(chunks.length >= 2, `chỉ ${chunks.length} chunk`);
    for (const c of chunks) {
      assert.ok(c.text.length <= 800, `chunk ${c.text.length} ký tự`);
    }
  });

  test('normalizeRag không cho overlap >= chunkSize', () => {
    const r = normalizeRag({ chunkSize: 400, chunkOverlap: 800 });
    assert.ok(r.chunkOverlap < r.chunkSize, `${r.chunkOverlap} >= ${r.chunkSize}`);
    assert.ok(r.chunkOverlap >= 0);
  });

  await testAsync('chunkOverlap = 0 không bị đổi thành 200', async () => {
    const text = `${'Từ. '.repeat(80)}Không có Điều nào ở đây.`;
    const docs = await chunkTextWithMetadata(text, { ten_file: 'x.txt' }, { chunkSize: 80, chunkOverlap: 0 });
    assert.ok(docs.length >= 1);
  });

  test('nhận PDF, Word, PowerPoint (kể cả .ppt), Excel', () => {
    assert.strictEqual(isAllowedUpload('vb.pdf', 'application/pdf'), true);
    assert.strictEqual(isAllowedUpload('vb.doc', 'application/msword'), true);
    assert.strictEqual(isAllowedUpload('vb.docx', ''), true);
    assert.strictEqual(isAllowedUpload('bao-cao.ppt', 'application/vnd.ms-powerpoint'), true);
    assert.strictEqual(isAllowedUpload('bao-cao.pptx', ''), true);
    assert.strictEqual(isAllowedUpload('bang.xlsx', ''), true);
    assert.strictEqual(isAllowedUpload('malware.exe', ''), false);
  });

  await testAsync('extractMetadataFromPrefix fallback khi LLM không trả JSON', async () => {
    const meta = await extractMetadataFromPrefix('Nghị định số 01/2024/NĐ-CP của Chính phủ còn hiệu lực.', {
      fileName: 'a.pdf',
      urlFileGoc: 'https://example.com/a.pdf',
      useLlm: true,
      llm: { invoke: async () => ({ content: 'xin lỗi, không phải JSON' }) },
    });
    assert.ok(meta.so_hieu, JSON.stringify(meta));
    assert.ok(!String(meta.so_hieu).includes('xin lỗi'));
  });

  test('câu hỏi có số hiệu khác không phải follow-up', () => {
    assert.strictEqual(
      isFollowUpQuestion(
        'Điều 5 Nghị định 01/2024/NĐ-CP quy định gì?',
        'Bộ luật Lao động 45/2019/QH14 điều 3'
      ),
      false
    );
    assert.strictEqual(isFollowUpQuestion('Còn khoản 2 thì sao?', 'Điều 5 nói gì?'), true);
    assert.strictEqual(
      isFollowUpQuestion('Cụ thể giấy tờ nào?', 'Thủ tục cấp lại CCCD?'),
      true
    );
  });

  test('không cache retrieval cho phiên anonymous', () => {
    remember('anonymous', { question: 'x', matches: [{ id: 'secret' }] });
    assert.strictEqual(recall('anonymous'), null);
    remember('sess-1', { question: 'x', matches: [{ id: 'a' }] });
    assert.ok(recall('sess-1'));
  });

  test('kiểm chứng: số hiệu chỉ có trong quan hệ metadata không được coi là đã truy xuất', () => {
    const report = verifyAnswerAgainstMatches('Theo Nghị định 99/2015/NĐ-CP thời hạn là 99 năm.', [
      {
        so_hieu: '01/2024/NĐ-CP',
        dieu: '5',
        text: 'Điều 5. Thời hạn giải quyết là 07 ngày làm việc.',
        van_ban_bai_bo: ['99/2015/NĐ-CP'],
      },
    ]);
    assert.strictEqual(report.ok, false, JSON.stringify(report));
    assert.ok(report.unknownSoHieu.some((s) => compactSoHieu(s).includes('99/2015')));
  });

  test('kiểm chứng: mốc thời gian không có trong nguồn', () => {
    const report = verifyAnswerAgainstMatches('Theo Điều 5, thời hạn là 99 năm.', [
      { so_hieu: '01/2024/NĐ-CP', dieu: '5', text: 'Điều 5. Thời hạn giải quyết là 07 ngày làm việc.' },
    ]);
    assert.strictEqual(report.ok, false, JSON.stringify(report));
    assert.ok((report.unverifiedDurations || []).length, JSON.stringify(report));
  });

  test('neo số hiệu vẫn lọc còn hiệu lực khi câu hỏi không hỏi VB hết hiệu lực', () => {
    const f = buildMetadataFilter({
      onlyActive: true,
      so_hieu_in: ['01/2020/NĐ-CP'],
    });
    const raw = JSON.stringify(f);
    assert.ok(/Còn hiệu lực/.test(raw), raw);
  });

  await testAsync('hybridSearch neo số hiệu không tắt onlyActive', async () => {
    const filters = [];
    const pinecone = {
      Index: () => ({
        query: async ({ filter }) => {
          filters.push(filter);
          return { matches: [] };
        },
      }),
    };
    await hybridSearch(
      'Nghị định 01/2020/NĐ-CP quy định gì?',
      { onlyActive: true },
      {
        embeddings: { embedQuery: async () => [0.1, 0.2] },
        pinecone,
        indexName: 'idx',
      }
    );
    assert.ok(filters.length >= 2, 'thiếu query neo');
    const anchored = filters.filter((f) => JSON.stringify(f || {}).includes('01/2020'));
    assert.ok(anchored.length, JSON.stringify(filters));
    for (const f of anchored) {
      assert.ok(/Còn hiệu lực/.test(JSON.stringify(f)), JSON.stringify(f));
    }
  });

  await testAsync('upsert không xóa vector nếu embed thất bại', async () => {
    const { client, calls } = mockPinecone();
    await assert.rejects(
      () =>
        upsertChunksToPinecone(
          [{ pageContent: 'Điều 1', metadata: { ten_file: 'vb.pdf', chunk_index: 0 } }],
          {
            embeddings: {
              embedDocuments: async () => {
                throw new Error('embed down');
              },
            },
            pinecone: client,
            indexName: 'idx',
            replaceFileName: 'vb.pdf',
          }
        ),
      /embed down/
    );
    assert.strictEqual(calls.deleteMany.length, 0, 'đã xóa trước khi embed');
  });

  await testAsync('OCR ảnh nhận options, không ReferenceError', async () => {
    const tessPath = require.resolve('tesseract.js');
    const prev = require.cache[tessPath];
    let langsSeen = '';
    require.cache[tessPath] = {
      id: tessPath,
      filename: tessPath,
      loaded: true,
      exports: {
        createWorker: async (langs) => {
          langsSeen = langs;
          return {
            recognize: async () => ({ data: { text: 'Chữ OCR mẫu đủ dài' } }),
            terminate: async () => {},
          };
        },
      },
    };
    try {
      delete require.cache[require.resolve('../src/ingestion/extractAnyText')];
      const { extractAnyText } = require('../src/ingestion/extractAnyText');
      const r = await extractAnyText(Buffer.from('fake-png'), {
        fileName: 'scan.png',
        ocrLangs: 'vie',
      });
      assert.strictEqual(langsSeen, 'vie');
      assert.ok(r.text.includes('OCR'));
    } finally {
      if (prev) require.cache[tessPath] = prev;
      else delete require.cache[tessPath];
      delete require.cache[require.resolve('../src/ingestion/extractAnyText')];
    }
  });

  await testAsync('extractAnyText đọc PPTX và XLSX tối giản', async () => {
    const JSZip = require('jszip');
    const { extractAnyText } = require('../src/ingestion/extractAnyText');

    const pptx = new JSZip();
    pptx.file(
      'ppt/slides/slide1.xml',
      '<p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:t>Thông tư 55/2026/TT-BGDĐT</a:t></p:sld>'
    );
    const pptxBuf = await pptx.generateAsync({ type: 'nodebuffer' });
    const fromPptx = await extractAnyText(pptxBuf, { fileName: 'quy-dinh.pptx' });
    assert.ok(/55\/2026/.test(fromPptx.text), fromPptx.text);
    assert.strictEqual(fromPptx.kind, 'pptx');

    const asPpt = await extractAnyText(pptxBuf, { fileName: 'quy-dinh.ppt' });
    assert.ok(/55\/2026/.test(asPpt.text), asPpt.text);

    const xlsx = new JSZip();
    xlsx.file(
      'xl/sharedStrings.xml',
      '<?xml version="1.0"?><sst><si><t>Chuẩn chương trình GDNN</t></si></sst>'
    );
    xlsx.file(
      'xl/worksheets/sheet1.xml',
      '<?xml version="1.0"?><worksheet><sheetData><row><c t="s"><v>0</v></c></row></sheetData></worksheet>'
    );
    const xlsxBuf = await xlsx.generateAsync({ type: 'nodebuffer' });
    const fromXlsx = await extractAnyText(xlsxBuf, { fileName: 'bang.xlsx' });
    assert.ok(/GDNN/.test(fromXlsx.text), fromXlsx.text);
  });

  await testAsync('PDF scan sparse thì OCR từng trang', async () => {
    const { ocrPdfPages } = require('../src/ingestion/extractAnyText');
    const pages = [];
    const r = await ocrPdfPages(Buffer.from('%PDF'), {
      pageCount: 2,
      ocrLangs: 'vie+eng',
      onProgress: (p) => pages.push(p),
    }, {
      PDFParse: class {
        async getScreenshot() {
          return {
            pages: [
              { data: Buffer.from('png1'), pageNumber: 1 },
              { data: Buffer.from('png2'), pageNumber: 2 },
            ],
          };
        }
        async destroy() {}
      },
      createWorker: async () => ({
        recognize: async (buf) => ({
          data: { text: Buffer.isBuffer(buf) && buf.toString() === 'png2' ? 'Điều 2. Phạm vi' : 'Thông tư 55/2026/TT-BGDĐT' },
        }),
        terminate: async () => {},
      }),
    });
    assert.ok(/Thông tư 55/.test(r.text));
    assert.ok(/Điều 2/.test(r.text));
    assert.strictEqual(r.pageCount, 2);
    assert.strictEqual(r.ocr, true);
    assert.ok(pages.length >= 1);
  });

  test('SSE abort: kết thúc bình thường không bị coi là hủy', () => {
    const res = new EventEmitter();
    res.writableEnded = false;
    const aborted = listenSseAbort(res);
    res.writableEnded = true;
    res.emit('close');
    assert.strictEqual(aborted(), false);
  });

  test('SSE abort: đóng khi chưa end thì là hủy', () => {
    const res = new EventEmitter();
    res.writableEnded = false;
    const aborted = listenSseAbort(res);
    res.emit('close');
    assert.strictEqual(aborted(), true);
  });

  test('lỗi công khai không lộ secret', () => {
    assert.strictEqual(
      publicErrorMessage(new Error('Authorization: Bearer sk-secret')),
      'Lỗi máy chủ'
    );
    assert.ok(publicErrorMessage(new Error('Pinecone timeout')).includes('Pinecone'));
  });

  test('Google Docs native được export PDF, không alt=media', () => {
    const plan = driveExportPlan('application/vnd.google-apps.document');
    assert.ok(plan);
    assert.strictEqual(plan.exportMime, 'application/pdf');
    assert.strictEqual(driveExportPlan('application/pdf'), null);
  });

  console.log(`\nKết quả: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exitCode = 1;
}

run().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
