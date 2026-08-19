/**
 * Chunk văn bản: ưu tiên Điều/Khoản; fallback splitter theo độ dài.
 */
const { RecursiveCharacterTextSplitter } = require('@langchain/textsplitters');
const { Document } = require('@langchain/core/documents');
const { chunkLegalText, extractRelationsFromText } = require('./legalChunker');

function mergeSoHieuLists(...lists) {
  const seen = new Set();
  const out = [];
  for (const list of lists) {
    for (const raw of list || []) {
      const s = String(raw || '').trim();
      const key = s.toLowerCase();
      if (!s || seen.has(key)) continue;
      seen.add(key);
      out.push(s);
    }
  }
  return out;
}

function toDocuments(pieces, metadata) {
  return pieces.map(
    (pageContent, index) =>
      new Document({
        pageContent,
        metadata: {
          ...metadata,
          chunk_index: index,
          text_preview: String(pageContent).slice(0, 120),
        },
      })
  );
}

function legalPiecesToDocuments(legalChunks, metadata) {
  return legalChunks.map((c, index) => {
    const localRel = extractRelationsFromText(c.text, metadata.so_hieu);
    const suaDoi = mergeSoHieuLists(metadata.van_ban_sua_doi, localRel.van_ban_sua_doi);
    const thayThe = mergeSoHieuLists(metadata.van_ban_thay_the, localRel.van_ban_thay_the);
    const baiBo = mergeSoHieuLists(metadata.van_ban_bai_bo, localRel.van_ban_bai_bo);
    return new Document({
      pageContent: c.text,
      metadata: {
        ...metadata,
        dieu: c.dieu || '',
        khoan: c.khoan || '',
        heading: c.heading || '',
        van_ban_sua_doi: suaDoi,
        van_ban_thay_the: thayThe,
        van_ban_bai_bo: baiBo,
        chunk_index: index,
        text_preview: String(c.text).slice(0, 120),
      },
    });
  });
}

/**
 * @param {string} text
 * @param {object} metadata - metadata chung cho mọi chunk
 * @param {{ chunkSize?: number, chunkOverlap?: number }} options
 * @returns {Promise<import('@langchain/core/documents').Document[]>}
 */
async function chunkTextWithMetadata(text, metadata = {}, options = {}) {
  const chunkSize = Math.max(1, Number(options.chunkSize) || 1000);
  const rawOverlap =
    options.chunkOverlap == null || options.chunkOverlap === ''
      ? 200
      : Number(options.chunkOverlap);
  const chunkOverlap = Number.isFinite(rawOverlap)
    ? Math.max(0, Math.min(rawOverlap, chunkSize - 1))
    : Math.min(200, chunkSize - 1);

  if (!text || !String(text).trim()) {
    return [];
  }

  const legal = chunkLegalText(text, { chunkSize });
  if (legal.length >= 1) {
    return legalPiecesToDocuments(legal, metadata);
  }

  const splitter = new RecursiveCharacterTextSplitter({
    chunkSize,
    chunkOverlap,
  });

  const pieces = await splitter.splitText(String(text));
  return toDocuments(pieces, {
    ...metadata,
    dieu: metadata.dieu || '',
    khoan: metadata.khoan || '',
  });
}

module.exports = { chunkTextWithMetadata, mergeSoHieuLists };
