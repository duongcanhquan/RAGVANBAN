/**
 * Rerank đoạn truy xuất: vector + từ khóa + neo số hiệu/Điều + ngày + hiệu lực.
 */

const {
  compactSoHieu,
  tokenizeVi,
  parseQuestionAnchors,
} = require('../ingestion/legalChunker');

function lexicalOverlap(questionTokens, text) {
  if (!questionTokens.length) return 0;
  const hay = new Set(tokenizeVi(text));
  let hit = 0;
  for (const t of questionTokens) {
    if (hay.has(t)) hit += 1;
  }
  return hit / questionTokens.length;
}

function recencyBoost(ngay) {
  const y = String(ngay || '').slice(0, 4);
  const year = Number(y);
  if (!year) return 0;
  const now = new Date().getFullYear();
  const age = Math.max(0, now - year);
  if (age <= 1) return 0.08;
  if (age <= 3) return 0.05;
  if (age <= 8) return 0.02;
  return 0;
}

function statusBoost(trangThai) {
  if (trangThai === 'Còn hiệu lực') return 0.06;
  if (trangThai === 'Bị thay thế một phần') return 0.03;
  if (trangThai === 'Hết hiệu lực') return -0.12;
  return 0;
}

/**
 * Ghi đè score kết hợp (giữ vectorScore gốc).
 */
function rerankLegal(question, matches, intent = {}) {
  const anchors = parseQuestionAnchors(question);
  const extraKw = Array.isArray(intent.keywords) ? intent.keywords.join(' ') : '';
  const qTokens = tokenizeVi(`${question} ${extraKw}`);
  const wantSo = new Set(anchors.soHieu.map((s) => compactSoHieu(s).toLowerCase()));

  return (matches || []).map((m) => {
    const vectorScore = Number(m.score) || 0;
    const lex = lexicalOverlap(qTokens, `${m.heading || ''} ${m.text || ''}`);
    let bonus = 0;
    const so = compactSoHieu(m.so_hieu).toLowerCase();
    if (so && wantSo.has(so)) bonus += 0.22;
    if (anchors.dieu && String(m.dieu) === String(anchors.dieu)) bonus += 0.16;
    if (anchors.khoan && String(m.khoan) === String(anchors.khoan)) bonus += 0.08;
    if (anchors.wantsCompare && m.related) bonus += 0.05;
    bonus += recencyBoost(m.ngay_ban_hanh);
    bonus += statusBoost(m.trang_thai);

    const combined = vectorScore * 0.55 + lex * 0.25 + bonus;
    return {
      ...m,
      vectorScore,
      lexicalScore: lex,
      score: combined,
    };
  });
}

module.exports = {
  lexicalOverlap,
  recencyBoost,
  statusBoost,
  rerankLegal,
};
