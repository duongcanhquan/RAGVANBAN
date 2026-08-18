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

module.exports = { extractPdfText };
