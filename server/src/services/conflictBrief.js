/**
 * Tóm tắt chồng chéo văn bản trong context — đưa vào prompt trước khi soạn.
 */

const { compactSoHieu } = require('../ingestion/legalChunker');

function articleBit(m) {
  if (!m.dieu || m.dieu === 'mo_dau') return '';
  return m.khoan ? `Điều ${m.dieu} khoản ${m.khoan}` : `Điều ${m.dieu}`;
}

function buildConflictBrief(matches = []) {
  if (!matches.length) return '';

  const bySo = new Map();
  for (const m of matches) {
    const so = compactSoHieu(m.so_hieu) || m.ten_file || 'Không rõ số hiệu';
    if (!bySo.has(so)) {
      bySo.set(so, {
        so_hieu: so,
        loai: m.loai_van_ban || '',
        ngay: m.ngay_ban_hanh || '',
        trang_thai: m.trang_thai || '',
        sua: new Set(),
        thay: new Set(),
        bai: new Set(),
        goc: m.van_ban_goc || '',
        articles: new Set(),
        related: false,
      });
    }
    const row = bySo.get(so);
    if (m.ngay_ban_hanh && (!row.ngay || m.ngay_ban_hanh > row.ngay)) row.ngay = m.ngay_ban_hanh;
    if (m.trang_thai) row.trang_thai = m.trang_thai;
    for (const x of m.van_ban_sua_doi || []) row.sua.add(compactSoHieu(x));
    for (const x of m.van_ban_thay_the || []) row.thay.add(compactSoHieu(x));
    for (const x of m.van_ban_bai_bo || []) row.bai.add(compactSoHieu(x));
    if (m.van_ban_goc) row.goc = compactSoHieu(m.van_ban_goc);
    const art = articleBit(m);
    if (art) row.articles.add(art);
    if (m.related) row.related = true;
  }

  const lines = [...bySo.values()].map((r) => {
    const rel = [
      ...[...r.sua].map((s) => `sửa đổi/bổ sung ${s}`),
      ...[...r.thay].map((s) => `thay thế ${s}`),
      ...[...r.bai].map((s) => `bãi bỏ ${s}`),
      r.goc ? `gốc ${r.goc}` : '',
    ]
      .filter(Boolean)
      .join('; ');
    const arts = [...r.articles].slice(0, 8).join(', ');
    return `- ${[r.loai, r.so_hieu].filter(Boolean).join(' ')} · ${r.trang_thai || '—'} · ngày ${r.ngay || '—'} · ${arts || 'nhiều đoạn'}${rel ? ` · ${rel}` : ''}${r.related ? ' · (kéo theo quan hệ)' : ''}`;
  });

  const hasOverlap =
    bySo.size >= 2 || [...bySo.values()].some((r) => r.sua.size || r.thay.size || r.bai.size);
  if (!hasOverlap) return '';

  return `BẢN ĐỒ CHỒNG CHÉO (bắt buộc đối chiếu trước khi kết luận):
${lines.join('\n')}
Quy tắc: nêu văn bản còn hiệu lực / ngày mới hơn trước; mỗi điểm liên quan câu hỏi phải kèm Điều/khoản cụ thể; điểm bị sửa phải nói rõ điều khoản và số hiệu VB sửa; không chỉ liệt kê tên VB; không gộp thành một quy định duy nhất; hết hiệu lực chỉ nêu để cảnh báo, không áp dụng nguyên văn.`;
}

function shouldCompare(matches = []) {
  const sos = new Set(
    matches.map((m) => compactSoHieu(m.so_hieu)).filter(Boolean)
  );
  const hasRel = matches.some(
    (m) =>
      (m.van_ban_sua_doi || []).length ||
      (m.van_ban_thay_the || []).length ||
      (m.van_ban_bai_bo || []).length ||
      m.related
  );
  return sos.size >= 2 || hasRel;
}

module.exports = { buildConflictBrief, articleBit, shouldCompare };
