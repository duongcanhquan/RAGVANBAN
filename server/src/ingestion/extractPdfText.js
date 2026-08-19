/**
 * Đọc text từ PDF — hỗ trợ đường dẫn file hoặc Buffer (memory upload).
 */
const fs = require('fs');
const { PDFParse } = require('pdf-parse');

/**
 * @param {string|Buffer} source
 * @returns {Promise<{ text: string, pageCount: number }>}
 */
async function extractPdfText(source) {
  if (!source) {
    throw new Error('extractPdfText: thiếu source');
  }

  const buffer = Buffer.isBuffer(source) ? source : fs.readFileSync(source);
  const parser = new PDFParse({ data: buffer });

  try {
    const result = await parser.getText();
    return {
      text: (result.text || '').trim(),
      pageCount: result.total || (result.pages ? result.pages.length : 0),
    };
  } finally {
    await parser.destroy();
  }
}

/** pdf-parse để lại mốc trang kiểu "-- 3 of 28 --" trên PDF scan. */
function stripPdfExtractorNoise(text) {
  return String(text || '')
    .replace(/--\s*\d+\s+of\s+\d+\s*--/gi, ' ')
    .replace(/\f/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function isSparsePdfText(text, pageCount = 1) {
  const raw = String(text || '').trim();
  const cleaned = stripPdfExtractorNoise(text);
  if (!cleaned) return true;
  const pages = Math.max(1, Number(pageCount) || 1);
  if (raw.length >= 80 && cleaned.length < Math.max(40, pages * 8)) return true;
  if (pages >= 3 && cleaned.length < pages * 20) return true;
  return cleaned.length < 20;
}

module.exports = { extractPdfText, stripPdfExtractorNoise, isSparsePdfText };
