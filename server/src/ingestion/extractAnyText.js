/**
 * Trích xuất text từ nhiều định dạng: PDF, DOC/DOCX, PPT/PPTX, ảnh (OCR), TXT/MD.
 */

const path = require('path');
const fs = require('fs');
const { extractPdfText, isSparsePdfText } = require('./extractPdfText');

const EXT_MAP = {
  '.pdf': 'pdf',
  '.doc': 'doc',
  '.docx': 'docx',
  '.docm': 'docx',
  '.ppt': 'ppt',
  '.pptx': 'pptx',
  '.pptm': 'pptx',
  '.xls': 'xls',
  '.xlsx': 'xlsx',
  '.xlsm': 'xlsx',
  '.csv': 'text',
  '.rtf': 'rtf',
  '.odt': 'odt',
  '.odp': 'odp',
  '.ods': 'ods',
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
  '.json': 'text',
};

const MIME_MAP = {
  'application/pdf': 'pdf',
  'application/msword': 'doc',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
  'application/vnd.ms-word.document.macroenabled.12': 'docx',
  'application/vnd.ms-powerpoint': 'ppt',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': 'pptx',
  'application/vnd.ms-powerpoint.presentation.macroenabled.12': 'pptx',
  'application/vnd.ms-excel': 'xls',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
  'application/vnd.ms-excel.sheet.macroenabled.12': 'xlsx',
  'application/rtf': 'rtf',
  'text/rtf': 'rtf',
  'application/vnd.oasis.opendocument.text': 'odt',
  'application/vnd.oasis.opendocument.presentation': 'odp',
  'application/vnd.oasis.opendocument.spreadsheet': 'ods',
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

const ALLOWED_HINT =
  'PDF, Word (.doc/.docx), PowerPoint (.ppt/.pptx), Excel (.xls/.xlsx), OpenDocument, RTF, ảnh, TXT/MD';

function detectKind(fileName = '', mimeType = '') {
  const ext = path.extname(String(fileName)).toLowerCase();
  if (EXT_MAP[ext]) return EXT_MAP[ext];
  const mime = String(mimeType || '').toLowerCase();
  if (MIME_MAP[mime]) return MIME_MAP[mime];
  return null;
}

function isAllowedUpload(fileName, mimeType) {
  return Boolean(detectKind(fileName, mimeType));
}

function detectKindFromBuffer(buffer, fileName, mimeType) {
  const kind = detectKind(fileName, mimeType);
  if (!buffer || !Buffer.isBuffer(buffer)) return kind;
  if (buffer.slice(0, 4).toString('latin1') === '%PDF') return 'pdf';
  return kind;
}

async function refineZipKind(buffer, kind) {
  if (!isZipBuffer(buffer)) return kind;
  try {
    const zip = await JSZipLoad(buffer);
    const names = Object.keys(zip.files);
    if (names.some((n) => /^word\/document\.xml$/i.test(n))) return 'docx';
    if (names.some((n) => /^ppt\/slides\//i.test(n))) return 'pptx';
    if (names.some((n) => /^xl\/worksheets\//i.test(n))) return 'xlsx';
    const mime = await zipFileText(zip, 'mimetype');
    if (mime.includes('opendocument.text')) return 'odt';
    if (mime.includes('opendocument.presentation')) return 'odp';
    if (mime.includes('opendocument.spreadsheet')) return 'ods';
  } catch {
    /* keep kind */
  }
  return kind;
}

function isZipBuffer(buffer) {
  return Buffer.isBuffer(buffer) && buffer.length >= 4 && buffer[0] === 0x50 && buffer[1] === 0x4b;
}

function decodeXml(s) {
  return String(s || '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)));
}

function collectXmlTags(xml, tagRe) {
  const texts = [];
  const re = tagRe;
  let m;
  while ((m = re.exec(xml)) !== null) {
    const t = decodeXml(m[1]).trim();
    if (t) texts.push(t);
  }
  return texts;
}

async function extractDocx(buffer) {
  const mammoth = require('mammoth');
  try {
    const result = await mammoth.extractRawText({ buffer });
    const text = (result.value || '').trim();
    if (text) return { text, pageCount: 0, kind: 'docx' };
  } catch {
    /* XML fallback below */
  }
  const zip = await JSZipLoad(buffer);
  const xml = await zipFileText(zip, 'word/document.xml');
  const texts = collectXmlTags(xml, /<w:t[^>]*>([^<]*)<\/w:t>/g);
  const text = texts.join(' ').trim();
  if (!text) throw new Error('File Word không có chữ để số hóa.');
  return { text, pageCount: 0, kind: 'docx' };
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
  const zip = await JSZipLoad(buffer);
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
    const texts = collectXmlTags(xml, /<a:t[^>]*>([^<]*)<\/a:t>/g);
    if (texts.length) {
      const slideNo = (name.match(/slide(\d+)/i) || [])[1] || '?';
      parts.push(`--- Slide ${slideNo} ---\n${texts.join(' ')}`);
    }
  }

  const noteNames = Object.keys(zip.files).filter((n) =>
    /^ppt\/notesSlides\/notesSlide\d+\.xml$/i.test(n)
  );
  for (const name of noteNames) {
    const xml = await zip.files[name].async('string');
    const texts = collectXmlTags(xml, /<a:t[^>]*>([^<]*)<\/a:t>/g);
    if (texts.length) parts.push(`(Ghi chú) ${texts.join(' ')}`);
  }

  const text = parts.join('\n\n').trim();
  if (!text) {
    throw new Error('PowerPoint không có text (có thể chỉ là ảnh). Hãy xuất PDF hoặc dùng ảnh + OCR.');
  }
  return { text, pageCount: slideNames.length, kind: 'pptx' };
}

async function JSZipLoad(buffer) {
  const JSZip = require('jszip');
  return JSZip.loadAsync(buffer);
}

async function zipFileText(zip, name) {
  const f = zip.file(name);
  if (!f) return '';
  return f.async('string');
}

function extractOleUnicodeText(buffer, { minLen = 5 } = {}) {
  const out = [];
  const seen = new Set();
  let i = 0;
  while (i + 3 < buffer.length) {
    const c0 = buffer[i] | (buffer[i + 1] << 8);
    if (c0 < 32 || c0 === 0xfffe) {
      i += 2;
      continue;
    }
    const chars = [];
    let j = i;
    while (j + 1 < buffer.length) {
      const c = buffer[j] | (buffer[j + 1] << 8);
      if (c === 0) break;
      if (c < 32 || c === 0xfffe) {
        chars.length = 0;
        break;
      }
      chars.push(String.fromCharCode(c));
      j += 2;
      if (chars.length > 400) break;
    }
    const s = chars.join('').trim();
    i = j + 2;
    if (s.length < minLen) continue;
    const letters = (s.match(/[\p{L}\p{N}]/gu) || []).length;
    if (letters < Math.max(3, s.length * 0.4)) continue;
    const key = s.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(s);
  }
  return out.join('\n').trim();
}

async function extractPpt(buffer) {
  if (isZipBuffer(buffer)) return extractPptx(buffer);
  const text = extractOleUnicodeText(buffer);
  if (!text) {
    throw new Error('Không đọc được file .ppt. Lưu thành .pptx hoặc PDF rồi tải lại.');
  }
  return { text, pageCount: 0, kind: 'ppt' };
}

async function extractXlsx(buffer) {
  if (!isZipBuffer(buffer)) {
    const text = extractOleUnicodeText(buffer);
    if (!text) throw new Error('Không đọc được file Excel cũ (.xls). Lưu thành .xlsx rồi tải lại.');
    return { text, pageCount: 0, kind: 'xls' };
  }
  const zip = await JSZipLoad(buffer);
  const shared = collectXmlTags(
    await zipFileText(zip, 'xl/sharedStrings.xml'),
    /<t[^>]*>([^<]*)<\/t>/g
  );
  const sheets = Object.keys(zip.files)
    .filter((n) => /^xl\/worksheets\/sheet\d+\.xml$/i.test(n))
    .sort();
  const parts = [];
  for (const name of sheets) {
    const xml = await zip.files[name].async('string');
    const cells = [];
    const re = /<c\b([^>]*)>([\s\S]*?)<\/c>/g;
    let m;
    while ((m = re.exec(xml)) !== null) {
      const attrs = m[1] || '';
      const inner = m[2] || '';
      const vm = inner.match(/<v[^>]*>([^<]*)<\/v>/);
      const ism = inner.match(/<is[\s\S]*?<t[^>]*>([^<]*)<\/t>/);
      if (/\bt="s"/i.test(attrs) && vm) {
        const idx = Number(vm[1]);
        if (Number.isFinite(idx) && shared[idx]) cells.push(shared[idx]);
      } else if (ism) {
        cells.push(decodeXml(ism[1]).trim());
      } else if (vm) {
        cells.push(vm[1].trim());
      }
    }
    const unique = [];
    const seen = new Set();
    for (const c of cells) {
      if (!c || seen.has(c)) continue;
      seen.add(c);
      unique.push(c);
    }
    if (unique.length) {
      const sheetNo = (name.match(/sheet(\d+)/i) || [])[1] || '?';
      parts.push(`--- Sheet ${sheetNo} ---\n${unique.join('\n')}`);
    }
  }
  const text = parts.join('\n\n').trim() || shared.join('\n').trim();
  if (!text) throw new Error('File Excel không có chữ để số hóa.');
  return { text, pageCount: sheets.length, kind: 'xlsx' };
}

async function extractOpenDocument(buffer, kind) {
  const zip = await JSZipLoad(buffer);
  const xml = await zipFileText(zip, 'content.xml');
  const texts = collectXmlTags(xml, /<(?:text:p|text:h|text:span)[^>]*>([^<]*)<\/(?:text:p|text:h|text:span)>/g);
  const text = texts.join('\n').trim();
  if (!text) throw new Error('File OpenDocument không có chữ để số hóa.');
  return { text, pageCount: 0, kind };
}

function extractRtf(buffer) {
  const raw = buffer.toString('utf8');
  const stripped = raw
    .replace(/\\'[0-9a-fA-F]{2}/g, ' ')
    .replace(/\\[a-zA-Z]+\d* ?/g, ' ')
    .replace(/[{}]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!stripped || stripped.length < 8) throw new Error('File RTF không có chữ để số hóa.');
  return { text: stripped, pageCount: 0, kind: 'rtf' };
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

/**
 * PDF scan (máy photocopy / Smart Touch) không có lớp chữ — render trang rồi OCR.
 */
async function ocrPdfPages(buffer, options = {}, deps = {}) {
  const PDFParse = deps.PDFParse || require('pdf-parse').PDFParse;
  const createWorker = deps.createWorker || require('tesseract.js').createWorker;
  const langs = options.ocrLangs || process.env.OCR_LANGS || 'vie+eng';
  const onProgress = options.onProgress;
  let total = Math.max(1, Number(options.pageCount) || 1);
  const parser = new PDFParse({ data: buffer });
  const worker = await createWorker(langs);
  const parts = [];
  let done = 0;
  try {
    const batchSize = 3;
    for (let first = 1; first <= total; first += batchSize) {
      const last = Math.min(total, first + batchSize - 1);
      let shot;
      try {
        shot = await parser.getScreenshot({
          imageBuffer: true,
          scale: 1.35,
          first,
          last,
        });
      } catch (err) {
        throw new Error(`Không render được trang PDF để OCR: ${err.message}`);
      }
      const pages = shot.pages || [];
      if (Number(shot.total) > total) total = Number(shot.total);
      if (!pages.length) {
        if (first === 1) throw new Error('PDF scan không render được ảnh trang để OCR.');
        break;
      }
      for (const page of pages) {
        const raw = page.data;
        const img = Buffer.isBuffer(raw) ? raw : Buffer.from(raw);
        const { data } = await worker.recognize(img);
        const text = String(data?.text || '').trim();
        if (text) parts.push(text);
        done += 1;
        if (typeof onProgress === 'function') {
          onProgress({
            stage: 'ocr',
            percent: Math.min(40, 12 + Math.round((done / Math.max(total, 1)) * 28)),
            message: `OCR PDF scan ${done}/${total} trang…`,
            page: done,
            total,
          });
        }
      }
      if (pages.length > last - first + 1) {
        total = Math.max(total, done);
        break;
      }
    }
  } finally {
    try {
      await worker.terminate();
    } catch {
      /* ignore */
    }
    try {
      await parser.destroy();
    } catch {
      /* ignore */
    }
  }
  return {
    text: parts.join('\n\n').trim(),
    pageCount: Math.max(done, Number(options.pageCount) || 0),
    kind: 'pdf',
    ocr: true,
  };
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
  let kind = detectKindFromBuffer(buffer, fileName, mimeType);
  if (isZipBuffer(buffer)) kind = await refineZipKind(buffer, kind);

  if (!kind) {
    throw new Error(`Định dạng chưa hỗ trợ: ${fileName}. Hỗ trợ ${ALLOWED_HINT}.`);
  }

  if (kind === 'pdf') {
    const r = await extractPdfText(buffer);
    if (!isSparsePdfText(r.text, r.pageCount)) {
      return { ...r, kind: 'pdf', ocr: false };
    }
    if (typeof options.onProgress === 'function') {
      options.onProgress({
        stage: 'ocr',
        percent: 12,
        message: `PDF scan ${r.pageCount || 0} trang — đang OCR…`,
      });
    }
    const ocr = await ocrPdfPages(buffer, {
      pageCount: r.pageCount || 1,
      ocrLangs: options.ocrLangs,
      onProgress: options.onProgress,
    });
    if (isSparsePdfText(ocr.text, ocr.pageCount)) {
      throw new Error(
        'PDF là bản scan (ảnh) nhưng OCR không đọc được chữ. Thử file Word hoặc PDF có lớp chữ.'
      );
    }
    return ocr;
  }
  if (kind === 'docx') return extractDocx(buffer);
  if (kind === 'doc') {
    if (isZipBuffer(buffer)) return extractDocx(buffer);
    return extractDoc(buffer);
  }
  if (kind === 'pptx') return extractPptx(buffer);
  if (kind === 'ppt') return extractPpt(buffer);
  if (kind === 'xlsx' || kind === 'xls') return extractXlsx(buffer);
  if (kind === 'odt') return extractOpenDocument(buffer, 'odt');
  if (kind === 'odp') return extractOpenDocument(buffer, 'odp');
  if (kind === 'ods') return extractOpenDocument(buffer, 'ods');
  if (kind === 'rtf') return extractRtf(buffer);
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
    '.docm': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    '.ppt': 'application/vnd.ms-powerpoint',
    '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    '.pptm': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    '.xls': 'application/vnd.ms-excel',
    '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    '.xlsm': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    '.rtf': 'application/rtf',
    '.odt': 'application/vnd.oasis.opendocument.text',
    '.odp': 'application/vnd.oasis.opendocument.presentation',
    '.ods': 'application/vnd.oasis.opendocument.spreadsheet',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.webp': 'image/webp',
    '.gif': 'image/gif',
    '.txt': 'text/plain',
    '.md': 'text/markdown',
    '.csv': 'text/csv',
  };
  return map[ext] || 'application/octet-stream';
}

module.exports = {
  extractAnyText,
  ocrPdfPages,
  detectKind,
  isAllowedUpload,
  guessContentType,
  ALLOWED_HINT,
  EXT_MAP,
};
