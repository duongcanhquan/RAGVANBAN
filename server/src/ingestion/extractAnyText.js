/**
 * Trích xuất text từ nhiều định dạng: PDF, DOC/DOCX, PPT/PPTX, ảnh (OCR), TXT/MD.
 */

const path = require('path');
const fs = require('fs');
const { extractPdfText } = require('./extractPdfText');

const EXT_MAP = {
  '.pdf': 'pdf',
  '.doc': 'doc',
  '.docx': 'docx',
  '.ppt': 'ppt_legacy',
  '.pptx': 'pptx',
  '.png': 'image',
  '.jpg': 'image',
  '.jpeg': 'image',
  '.webp': 'image',
  '.gif': 'image',
  '.bmp': 'image',
  '.tif': 'image',
  '.tiff': 'image',
  '.txt': 'text',
  '.md': 'text',
  '.csv': 'text',
  '.json': 'text',
};

const MIME_MAP = {
  'application/pdf': 'pdf',
  'application/msword': 'doc',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
  'application/vnd.ms-powerpoint': 'ppt_legacy',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': 'pptx',
  'image/png': 'image',
  'image/jpeg': 'image',
  'image/webp': 'image',
  'image/gif': 'image',
  'image/bmp': 'image',
  'image/tiff': 'image',
  'text/plain': 'text',
  'text/markdown': 'text',
  'text/csv': 'text',
  'application/json': 'text',
};

function detectKind(fileName = '', mimeType = '') {
  const ext = path.extname(String(fileName)).toLowerCase();
  if (EXT_MAP[ext]) return EXT_MAP[ext];
  if (MIME_MAP[mimeType]) return MIME_MAP[mimeType];
  return null;
}

function isAllowedUpload(fileName, mimeType) {
  const kind = detectKind(fileName, mimeType);
  return Boolean(kind) && kind !== 'ppt_legacy';
}

async function extractDocx(buffer) {
  const mammoth = require('mammoth');
  const result = await mammoth.extractRawText({ buffer });
  return { text: (result.value || '').trim(), pageCount: 0, kind: 'docx' };
}

async function extractDoc(buffer) {
  // .doc cũ (OLE) — word-extractor; nếu fail thử mammoth
  try {
    const WordExtractor = require('word-extractor');
    const extractor = new WordExtractor();
    // API nhận path hoặc buffer tùy version — dùng temp nếu cần
    const os = require('os');
    const tmp = path.join(os.tmpdir(), `hcc-doc-${Date.now()}.doc`);
    fs.writeFileSync(tmp, buffer);
    try {
      const doc = await extractor.extract(tmp);
      const text = [doc.getBody(), doc.getHeaders(), doc.getFooters()]
        .filter(Boolean)
        .join('\n')
        .trim();
      return { text, pageCount: 0, kind: 'doc' };
    } finally {
      try {
        fs.unlinkSync(tmp);
      } catch {
        // ignore
      }
    }
  } catch (err) {
    try {
      return await extractDocx(buffer);
    } catch {
      throw new Error(`Không đọc được file .doc: ${err.message}`);
    }
  }
}

async function extractPptx(buffer) {
  const JSZip = require('jszip');
  const zip = await JSZip.loadAsync(buffer);
  const slideNames = Object.keys(zip.files)
    .filter((n) => /^ppt\/slides\/slide\d+\.xml$/i.test(n))
    .sort((a, b) => {
      const na = Number((a.match(/slide(\d+)/i) || [])[1] || 0);
      const nb = Number((b.match(/slide(\d+)/i) || [])[1] || 0);
      return na - nb;
    });

  const parts = [];
  for (const name of slideNames) {
    const xml = await zip.files[name].async('string');
    const texts = [];
    const re = /<a:t[^>]*>([^<]*)<\/a:t>/g;
    let m;
    while ((m = re.exec(xml)) !== null) {
      const t = m[1].replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').trim();
      if (t) texts.push(t);
    }
    if (texts.length) {
      const slideNo = (name.match(/slide(\d+)/i) || [])[1] || '?';
      parts.push(`--- Slide ${slideNo} ---\n${texts.join(' ')}`);
    }
  }

  // Ghi chú / notes
  const noteNames = Object.keys(zip.files).filter((n) =>
    /^ppt\/notesSlides\/notesSlide\d+\.xml$/i.test(n)
  );
  for (const name of noteNames) {
    const xml = await zip.files[name].async('string');
    const texts = [];
    const re = /<a:t[^>]*>([^<]*)<\/a:t>/g;
    let m;
    while ((m = re.exec(xml)) !== null) {
      const t = m[1].trim();
      if (t) texts.push(t);
    }
    if (texts.length) parts.push(`(Ghi chú) ${texts.join(' ')}`);
  }

  const text = parts.join('\n\n').trim();
  if (!text) {
    throw new Error('PowerPoint không có text (có thể chỉ là ảnh). Hãy xuất PDF hoặc dùng ảnh + OCR.');
  }
  return { text, pageCount: slideNames.length, kind: 'pptx' };
}

async function extractImageOcr(buffer, options = {}) {
  const { createWorker } = require('tesseract.js');
  const langs = options.ocrLangs || process.env.OCR_LANGS || 'vie+eng';
  const worker = await createWorker(langs);
  try {
    const {
      data: { text },
    } = await worker.recognize(buffer);
    const cleaned = String(text || '').trim();
    if (!cleaned) {
      throw new Error('OCR không nhận được chữ trên ảnh. Thử ảnh rõ hơn / độ phân giải cao hơn.');
    }
    return { text: cleaned, pageCount: 1, kind: 'image' };
  } finally {
    await worker.terminate();
  }
}

async function extractPlainText(buffer) {
  const text = buffer.toString('utf8').trim();
  if (!text) throw new Error('File text trống');
  return { text, pageCount: 0, kind: 'text' };
}

/**
 * @param {Buffer|string} source
 * @param {{ fileName?: string, mimeType?: string }} options
 */
async function extractAnyText(source, options = {}) {
  const buffer = Buffer.isBuffer(source)
    ? source
    : fs.readFileSync(source);
  const fileName =
    options.fileName ||
    (typeof source === 'string' ? path.basename(source) : 'upload.bin');
  const mimeType = options.mimeType || '';
  const kind = detectKind(fileName, mimeType);

  if (!kind) {
    throw new Error(
      `Định dạng chưa hỗ trợ: ${fileName}. Hỗ trợ PDF, DOC/DOCX, PPT/PPTX, ảnh (OCR), TXT/MD.`
    );
  }

  if (kind === 'pdf') {
    const r = await extractPdfText(buffer);
    return { ...r, kind: 'pdf' };
  }
  if (kind === 'docx') return extractDocx(buffer);
  if (kind === 'doc') return extractDoc(buffer);
  if (kind === 'pptx') return extractPptx(buffer);
  if (kind === 'ppt_legacy') {
    throw new Error('File .ppt cũ chưa hỗ trợ — hãy lưu thành .pptx hoặc PDF rồi tải lên.');
  }
  if (kind === 'image') return extractImageOcr(buffer, options);
  if (kind === 'text') return extractPlainText(buffer);

  throw new Error(`Kind không xử lý được: ${kind}`);
}

function guessContentType(fileName = '') {
  const ext = path.extname(fileName).toLowerCase();
  const map = {
    '.pdf': 'application/pdf',
    '.doc': 'application/msword',
    '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    '.ppt': 'application/vnd.ms-powerpoint',
    '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.webp': 'image/webp',
    '.gif': 'image/gif',
    '.txt': 'text/plain',
    '.md': 'text/markdown',
  };
  return map[ext] || 'application/octet-stream';
}

module.exports = {
  extractAnyText,
  detectKind,
  isAllowedUpload,
  guessContentType,
  EXT_MAP,
};
