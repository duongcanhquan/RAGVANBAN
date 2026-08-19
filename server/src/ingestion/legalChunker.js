/**
 * Cắt văn bản hành chính theo Điều / Khoản và bóc quan hệ sửa đổi–bổ sung.
 */

const SO_HIEU_RE = /(\d+\s*\/\s*\d{4}\s*\/\s*[A-ZĐ0-9]+(?:[.\-][A-ZĐ0-9]+)*)/gi;
const DIEU_START_RE = /(?:^|\n)([ \t]*Điều\s+(\d+[a-zA-Z]?)\b[^\n]*)/giu;

function compactSoHieu(raw) {
  const s = String(raw || '').trim();
  if (!s) return '';
  if (!/\d+\s*\/\s*\d{4}/.test(s)) return s.replace(/\s+/g, ' ');
  return s.replace(/\s+/g, '').replace(/[.,;:]+$/g, '');
}

function soHieuFilterValues(list = []) {
  const out = [];
  const seen = new Set();
  for (const raw of list || []) {
    const trimmed = String(raw || '').trim();
    const compact = compactSoHieu(raw);
    for (const v of [trimmed, compact]) {
      const key = v.toLowerCase();
      if (!v || seen.has(key)) continue;
      seen.add(key);
      out.push(v);
    }
  }
  return out;
}

function extractSoHieuList(text) {
  const found = String(text || '').match(SO_HIEU_RE) || [];
  const uniq = [];
  const seen = new Set();
  for (const hit of found) {
    const n = compactSoHieu(hit);
    if (!n || seen.has(n.toLowerCase())) continue;
    seen.add(n.toLowerCase());
    uniq.push(n);
  }
  return uniq;
}

function extractRelationsFromText(text, ownSoHieu = '') {
  const own = compactSoHieu(ownSoHieu).toLowerCase();
  const suaDoi = new Set();
  const thayThe = new Set();
  const baiBo = new Set();
  const body = String(text || '');

  const clauseRe =
    /((?:sửa đổi|bổ sung|thay thế|bãi bỏ)[^\n.]{0,160}?)(\d+\s*\/\s*\d{4}\s*\/\s*[A-ZĐ0-9]+(?:[.\-][A-ZĐ0-9]+)*)/giu;
  let m;
  while ((m = clauseRe.exec(body))) {
    const phrase = m[1].toLowerCase();
    const so = compactSoHieu(m[2]);
    if (own && so.toLowerCase() === own) continue;
    if (/thay thế/.test(phrase)) thayThe.add(so);
    else if (/bãi bỏ/.test(phrase)) baiBo.add(so);
    else suaDoi.add(so);
  }

  const windows = body.split(/(?<=[\n.])/);
  for (const w of windows) {
    const hits = extractSoHieuList(w).filter((s) => !own || s.toLowerCase() !== own);
    if (!hits.length) continue;
    const low = w.toLowerCase();
    for (const so of hits) {
      if (thayThe.has(so) || baiBo.has(so) || suaDoi.has(so)) continue;
      const at = low.indexOf(so.toLowerCase());
      const before = at >= 0 ? low.slice(0, at) : low;
      const lastThayThe = before.lastIndexOf('thay thế');
      const lastBaiBo = before.lastIndexOf('bãi bỏ');
      const lastSua = Math.max(before.lastIndexOf('sửa đổi'), before.lastIndexOf('bổ sung'));
      const nearest = Math.max(lastThayThe, lastBaiBo, lastSua);
      if (nearest < 0) continue;
      if (nearest === lastThayThe) thayThe.add(so);
      else if (nearest === lastBaiBo) baiBo.add(so);
      else suaDoi.add(so);
    }
  }

  return {
    van_ban_sua_doi: [...suaDoi],
    van_ban_thay_the: [...thayThe],
    van_ban_bai_bo: [...baiBo],
  };
}

function findDieuStarts(text) {
  const src = String(text || '');
  const starts = [];
  const re = new RegExp(DIEU_START_RE.source, DIEU_START_RE.flags);
  let m;
  while ((m = re.exec(src))) {
    const nl = m[0].startsWith('\n') ? 1 : 0;
    starts.push({
      index: m.index + nl,
      dieu: String(m[2]),
      heading: m[1].trim(),
    });
  }
  return starts;
}

function splitKhoanBlocks(dieuBody) {
  const src = String(dieuBody || '');
  const re = /(?:^|\n)[ \t]*(\d+)[.)]\s+/g;
  const marks = [];
  let m;
  while ((m = re.exec(src))) {
    const at = m.index === 0 ? 0 : m.index + (src[m.index] === '\n' ? 1 : 0);
    marks.push({ index: at, khoan: m[1] });
  }
  if (marks.length < 2) {
    return [{ khoan: '', text: src.trim() }];
  }
  const heading = src.slice(0, marks[0].index).trim();
  return marks.map((mark, i) => {
    const end = i + 1 < marks.length ? marks[i + 1].index : src.length;
    let text = src.slice(mark.index, end).trim();
    if (heading && !text.startsWith(heading.slice(0, 12))) text = `${heading}\n${text}`;
    return { khoan: mark.khoan, text };
  });
}

function wrapChunk(dieu, khoan, body) {
  const label = khoan ? `Điều ${dieu} khoản ${khoan}` : `Điều ${dieu}`;
  const raw = String(body || '').trim();
  if (!raw) return '';
  if (new RegExp(`^Điều\\s+${dieu}\\b`, 'i').test(raw)) return raw;
  return `${label}.\n${raw}`;
}

function splitOversizedText(text, chunkSize) {
  const limit = Math.max(80, Number(chunkSize) || 1200);
  const src = String(text || '').trim();
  if (!src) return [];
  if (src.length <= limit) return [src];
  const parts = [];
  let rest = src;
  while (rest.length > limit) {
    let cut = rest.lastIndexOf('\n', limit);
    if (cut < limit * 0.45) cut = rest.lastIndexOf(' ', limit);
    if (cut < limit * 0.35) cut = limit;
    parts.push(rest.slice(0, cut).trim());
    rest = rest.slice(cut).trim();
  }
  if (rest) parts.push(rest);
  return parts.filter(Boolean);
}

/**
 * Tách theo Điều; Điều dài thì tách Khoản. Phần mở đầu (trước Điều 1) giữ riêng.
 */
function chunkLegalText(text, options = {}) {
  const chunkSize = Number(options.chunkSize) || 1200;
  const src = String(text || '').trim();
  if (!src) return [];

  const starts = findDieuStarts(src);
  const out = [];

  if (!starts.length) return [];

  const preamble = src.slice(0, starts[0].index).trim();
  if (preamble.length > 24) {
    out.push({
      dieu: 'mo_dau',
      khoan: '',
      heading: 'Phần mở đầu',
      text: preamble,
    });
  }

  for (let i = 0; i < starts.length; i++) {
    const start = starts[i].index;
    const end = i + 1 < starts.length ? starts[i + 1].index : src.length;
    const section = src.slice(start, end).trim();
    const dieu = starts[i].dieu;
    const heading = starts[i].heading;

    const pushPieces = (khoan, raw) => {
      const wrapped = wrapChunk(dieu, khoan, raw);
      const pieces = splitOversizedText(wrapped, chunkSize);
      for (const text of pieces) {
        out.push({ dieu, khoan, heading, text });
      }
    };

    if (section.length <= chunkSize) {
      pushPieces('', section);
      continue;
    }

    const khoans = splitKhoanBlocks(section);
    if (khoans.length < 2) {
      pushPieces('', section);
      continue;
    }

    for (const k of khoans) {
      if (!k.text) continue;
      pushPieces(k.khoan, k.text);
    }
  }

  return out.filter((c) => c.text && c.text.length > 8);
}

function collectRelatedSoHieu(matches = []) {
  const have = new Set(
    matches.map((m) => compactSoHieu(m.so_hieu).toLowerCase()).filter(Boolean)
  );
  const related = [];
  const seen = new Set();

  function add(list) {
    for (const raw of list || []) {
      const n = compactSoHieu(raw);
      const key = n.toLowerCase();
      if (!n || have.has(key) || seen.has(key)) continue;
      seen.add(key);
      related.push(n);
    }
  }

  for (const m of matches) {
    add(m.van_ban_sua_doi);
    add(m.van_ban_thay_the);
    add(m.van_ban_bai_bo);
    if (m.van_ban_goc) add([m.van_ban_goc]);
  }
  return related;
}

const STOP = new Set(
  'và hoặc của các các là được theo về với trong cho từ một những này đó thì nếu khi đã sẽ tại hoặc không có những điều khoản nghị định thông tư quyết định luật văn bản quy định'.split(
    /\s+/
  )
);

function tokenizeVi(text) {
  return String(text || '')
    .toLowerCase()
    .normalize('NFC')
    .replace(/[^\p{L}\p{N}\/.-]+/gu, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 1 && !STOP.has(w));
}

function parseQuestionAnchors(question) {
  const q = String(question || '');
  const dieuM = q.match(/điều\s+(\d+[a-zA-Z]?)/i);
  const khoanM = q.match(/khoản\s+(\d+)/i);
  return {
    soHieu: extractSoHieuList(q),
    dieu: dieuM ? String(dieuM[1]) : '',
    khoan: khoanM ? String(khoanM[1]) : '',
    wantsCompare: /so sánh|sửa đổi|bổ sung|thay thế|chồng chéo|còn hiệu lực/i.test(q),
    onlyActive: !/hết hiệu lực|đã bãi bỏ|văn bản cũ|bị bãi bỏ/i.test(q),
  };
}

module.exports = {
  SO_HIEU_RE,
  compactSoHieu,
  soHieuFilterValues,
  extractSoHieuList,
  extractRelationsFromText,
  findDieuStarts,
  splitKhoanBlocks,
  chunkLegalText,
  collectRelatedSoHieu,
  tokenizeVi,
  parseQuestionAnchors,
};
