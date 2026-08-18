/**
 * Chunk văn bản và gắn metadata vào từng Document LangChain.
 */
const { RecursiveCharacterTextSplitter } = require('@langchain/textsplitters');
const { Document } = require('@langchain/core/documents');

/**
 * @param {string} text
 * @param {object} metadata - metadata chung cho mọi chunk
 * @param {{ chunkSize?: number, chunkOverlap?: number }} options
 * @returns {Promise<import('@langchain/core/documents').Document[]>}
 */
async function chunkTextWithMetadata(text, metadata = {}, options = {}) {
  const chunkSize = Number(options.chunkSize) || 1000;
  const chunkOverlap = Number(options.chunkOverlap) || 200;

  if (!text || !String(text).trim()) {
    return [];
  }

  const splitter = new RecursiveCharacterTextSplitter({
    chunkSize,
    chunkOverlap,
  });

  const pieces = await splitter.splitText(String(text));

  return pieces.map(
    (pageContent, index) =>
      new Document({
        pageContent,
        metadata: {
          ...metadata,
          chunk_index: index,
          // Pinecone metadata phải là string/number/boolean/list of strings
          text_preview: pageContent.slice(0, 120),
        },
      })
  );
}

module.exports = { chunkTextWithMetadata };
