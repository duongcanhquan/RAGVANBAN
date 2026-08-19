/**
 * Tách câu để đọc TTS ngay khi stream — không đợi hết câu trả lời.
 */

function stripMarkdownForSpeech(raw) {
  return String(raw || '')
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/https?:\/\/\S+/gi, ' ')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/\*([^*]+)\*/g, '$1')
    .replace(/^\s*[-*•]\s+/gm, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function shouldSkipChunk(text) {
  const t = String(text || '').trim();
  if (t.length < 2) return true;
  if (/^nguồn\s*:/i.test(t)) return true;
  if (/^kiểm chứng\s*:/i.test(t)) return true;
  return false;
}

/**
 * Lấy các đoạn đã đủ để nói; giữ phần còn lại trong buffer.
 * Ưu tiên hết câu (.?!…) ; nếu đã dài thì nói tại dấu phẩy / khoảng trắng.
 */
function extractSpeakable(buffer, options = {}) {
  const minFlush = Number(options.minFlush) || 42;
  const hardFlush = Number(options.hardFlush) || 88;
  let rest = String(buffer || '');
  const spoken = [];

  const sentenceRe = /^([\s\S]*?[.!?…。]\s+)/;

  while (rest.length) {
    const m = rest.match(sentenceRe);
    if (m && m[1].trim().length >= 8) {
      spoken.push(m[1]);
      rest = rest.slice(m[1].length);
      continue;
    }
    if (rest.length >= hardFlush) {
      const cut = rest.lastIndexOf(' ', hardFlush);
      const idx = cut >= minFlush ? cut + 1 : hardFlush;
      spoken.push(rest.slice(0, idx));
      rest = rest.slice(idx);
      continue;
    }
    if (rest.length >= minFlush) {
      const comma = rest.search(/[,;，、]\s/);
      if (comma >= 24 && comma <= rest.length - 8) {
        const idx = comma + 1;
        spoken.push(rest.slice(0, idx));
        rest = rest.slice(idx);
        continue;
      }
    }
    break;
  }

  return {
    spoken: spoken.map(stripMarkdownForSpeech).filter((t) => !shouldSkipChunk(t)),
    rest,
  };
}

module.exports = {
  stripMarkdownForSpeech,
  shouldSkipChunk,
  extractSpeakable,
};
