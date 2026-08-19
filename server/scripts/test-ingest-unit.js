/**
 * Unit tests cho pipeline ingestion — không cần OpenAI/Pinecone.
 * Chạy: node scripts/test-ingest-unit.js
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { listPdfFiles } = require('../src/ingestion/listPdfs');
const { extractPdfText, isSparsePdfText, stripPdfExtractorNoise } = require('../src/ingestion/extractPdfText');
const {
  parseMetadataJson,
  normalizeMetadata,
  heuristicMetadataFromText,
  extractMetadataFromPrefix,
} = require('../src/ingestion/extractMetadata');
const { chunkTextWithMetadata } = require('../src/ingestion/chunkDocuments');
const { buildPineconeRecords, asUpsertPayload } = require('../src/ingestion/upsertToPinecone');

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    passed += 1;
    console.log(`✓ ${name}`);
  } catch (err) {
    failed += 1;
    console.error(`✗ ${name}`);
    console.error(`  ${err.message}`);
  }
}

async function testAsync(name, fn) {
  try {
    await fn();
    passed += 1;
    console.log(`✓ ${name}`);
  } catch (err) {
    failed += 1;
    console.error(`✗ ${name}`);
    console.error(`  ${err.message}`);
  }
}

async function run() {
  const fixturesDir = path.resolve(__dirname, '../../data/fixtures');
  fs.mkdirSync(fixturesDir, { recursive: true });

  // --- Minimal valid PDF with text "Nghi dinh So: 01/2024/ND-CP Con hieu luc" ---
  const samplePdfPath = path.join(fixturesDir, 'sample-van-ban.pdf');
  if (!fs.existsSync(samplePdfPath)) {
    // PDF tối giản (Helvetica) — đủ để pdf-parse đọc được vài ký tự
    const contentStream =
      'BT /F1 12 Tf 50 750 Td (Nghi dinh So: 01/2024/ND-CP Con hieu luc) Tj ET';
    const objects = [];
    objects.push('1 0 obj<< /Type /Catalog /Pages 2 0 R >>endobj\n');
    objects.push('2 0 obj<< /Type /Pages /Kids [3 0 R] /Count 1 >>endobj\n');
    objects.push(
      '3 0 obj<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources<< /Font<< /F1 5 0 R >> >> >>endobj\n'
    );
    objects.push(
      `4 0 obj<< /Length ${contentStream.length} >>stream\n${contentStream}\nendstream\nendobj\n`
    );
    objects.push('5 0 obj<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>endobj\n');

    let body = '';
    const offsets = [0];
    for (const obj of objects) {
      offsets.push(Buffer.byteLength('%PDF-1.4\n', 'utf8') + Buffer.byteLength(body, 'utf8'));
      body += obj;
    }
    // Fix offsets properly
    const header = '%PDF-1.4\n';
    body = '';
    const xrefOffsets = [];
    for (const obj of objects) {
      xrefOffsets.push(Buffer.byteLength(header + body, 'utf8'));
      body += obj;
    }
    let xref = `xref\n0 ${objects.length + 1}\n`;
    xref += '0000000000 65535 f \n';
    for (const off of xrefOffsets) {
      xref += `${String(off).padStart(10, '0')} 00000 n \n`;
    }
    const eof = `trailer<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${Buffer.byteLength(header + body + xref, 'utf8')}\n%%EOF\n`;
    fs.writeFileSync(samplePdfPath, header + body + xref + eof);
  }

  test('listPdfFiles tìm sample PDF trong fixtures', () => {
    const files = listPdfFiles(fixturesDir);
    assert.ok(files.some((f) => f.endsWith('sample-van-ban.pdf')));
  });

  await testAsync('extractPdfText đọc được text từ sample PDF', async () => {
    const { text, pageCount } = await extractPdfText(samplePdfPath);
    assert.ok(text.length > 10, 'PDF sample không ra text');
    assert.ok(pageCount >= 1);
    assert.ok(/Nghi dinh|01\/2024/i.test(text), `text unexpected: ${text}`);
    assert.strictEqual(isSparsePdfText(text, pageCount), false);
  });

  test('PDF scan chỉ có -- n of m -- thì coi là sparse', () => {
    const markers = Array.from({ length: 28 }, (_, i) => `-- ${i + 1} of 28 --`).join('\n\n');
    assert.strictEqual(stripPdfExtractorNoise(markers), '');
    assert.strictEqual(isSparsePdfText(markers, 28), true);
    assert.strictEqual(
      isSparsePdfText(
        'BỘ GIÁO DỤC VÀ ĐÀO TẠO\nTHÔNG TƯ\nQuy định chuẩn chương trình đào tạo giáo dục nghề nghiệp\nCăn cứ Luật Giáo dục nghề nghiệp số 124/2025/QH15',
        1
      ),
      false
    );
  });

  test('parseMetadataJson đọc JSON thuần', () => {
    const meta = parseMetadataJson(
      JSON.stringify({
        loai_van_ban: 'Nghị định',
        so_hieu: '01/2024/NĐ-CP',
        ngay_ban_hanh: '2024-01-15',
        trang_thai: 'Còn hiệu lực',
        url_file_goc: 'https://example.com/a.pdf',
        ten_file: 'a.pdf',
        linh_vuc: 'Hành chính',
      })
    );
    assert.strictEqual(meta.loai_van_ban, 'Nghị định');
    assert.strictEqual(meta.trang_thai, 'Còn hiệu lực');
  });

  test('parseMetadataJson loại markdown fence', () => {
    const meta = parseMetadataJson('```json\n{"loai_van_ban":"Thông tư","so_hieu":"02","trang_thai":"Hết hiệu lực"}\n```');
    assert.strictEqual(meta.loai_van_ban, 'Thông tư');
    assert.strictEqual(meta.trang_thai, 'Hết hiệu lực');
  });

  test('normalizeMetadata sửa trang_thai lạ → Còn hiệu lực', () => {
    const meta = normalizeMetadata({ trang_thai: 'unknown' });
    assert.strictEqual(meta.trang_thai, 'Còn hiệu lực');
  });

  test('heuristicMetadataFromText nhận Hết hiệu lực', () => {
    const meta = heuristicMetadataFromText('Văn bản này đã hết hiệu lực từ 2020', {
      fileName: 'x.pdf',
      urlFileGoc: 'https://x',
    });
    assert.strictEqual(meta.trang_thai, 'Hết hiệu lực');
  });

  await testAsync('extractMetadataFromPrefix dry (không LLM)', async () => {
    const meta = await extractMetadataFromPrefix(
      'Nghị định Số: 01/2024/ND-CP về thủ tục hành chính',
      { fileName: 'nd.pdf', urlFileGoc: 'https://example.com/nd.pdf', useLlm: false }
    );
    assert.ok(meta.loai_van_ban.includes('Nghị định') || meta.loai_van_ban.length > 0);
    assert.strictEqual(meta.url_file_goc, 'https://example.com/nd.pdf');
  });

  await testAsync('chunkTextWithMetadata tạo overlap hợp lệ', async () => {
    const text = 'A'.repeat(2500);
    const chunks = await chunkTextWithMetadata(
      text,
      { so_hieu: '01', trang_thai: 'Còn hiệu lực', ten_file: 't.pdf' },
      { chunkSize: 1000, chunkOverlap: 200 }
    );
    assert.ok(chunks.length >= 2);
    assert.strictEqual(chunks[0].metadata.chunk_index, 0);
    assert.strictEqual(chunks[0].metadata.trang_thai, 'Còn hiệu lực');
    assert.ok(chunks[0].pageContent.length <= 1000);
  });

  test('buildPineconeRecords khớp documents/vectors', () => {
    const docs = [
      { pageContent: 'hello', metadata: { ten_file: 'a.pdf', chunk_index: 0, trang_thai: 'Còn hiệu lực' } },
    ];
    const records = buildPineconeRecords(docs, [[0.1, 0.2]]);
    assert.strictEqual(records.length, 1);
    assert.strictEqual(records[0].metadata.trang_thai, 'Còn hiệu lực');
    assert.deepStrictEqual(records[0].values, [0.1, 0.2]);
    const payload = asUpsertPayload(records);
    assert.ok(payload.records.length >= 1);
    assert.strictEqual(asUpsertPayload([]).records.length, 0);
    assert.strictEqual(asUpsertPayload(records).records[0].id, records[0].id);
  });

  console.log(`\nKết quả: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exitCode = 1;
}

run().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
