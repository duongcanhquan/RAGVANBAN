/**
 * Đối chiếu câu trả lời với đoạn đã truy xuất — không chấp nhận trích lục bịa.
 */

const { extractSoHieuList, compactSoHieu } = require('../ingestion/legalChunker');

function normalizeForMatch(s) {
  return String(s || '')
    .toLowerCase()
    .normalize('NFC')
    .replace(/[“”«»"'`]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function extractQuotedSpans(answer) {
  const spans = [];
  const re = /[“"«]([^”"»]{12,400})[”"»]/g;
  const src = String(answer || '');
  let m;
  while ((m = re.exec(src))) {
    spans.push(m[1].trim());
  }
  return spans;
}

function extractDieuMentions(answer) {
  const found = [];
  const re = /điều\s+(\d+[a-zA-Z]?)/gi;
  const src = String(answer || '');
  let m;
  while ((m = re.exec(src))) {
    found.push(String(m[1]));
  }
  return [...new Set(found)];
}

function extractDurationClaims(answer) {
  const found = [];
  const re = /(\d+(?:[.,]\d+)?)\s*(ngày|tháng|năm|giờ|tuần)/gi;
  const src = String(answer || '');
  let m;
  while ((m = re.exec(src))) {
    found.push(`${m[1].replace(',', '.')} ${m[2].toLowerCase()}`);
  }
  return found;
}

function verifyAnswerAgainstMatches(answer, matches = []) {
  const corpus = normalizeForMatch(matches.map((m) => m.text || '').join('\n'));
  const quotes = extractQuotedSpans(answer);
  const unverifiedQuotes = quotes.filter((q) => {
    const n = normalizeForMatch(q);
    return n.length >= 12 && !corpus.includes(n);
  });

  const sourceSo = new Set(
    matches
      .map((m) => compactSoHieu(m.so_hieu).toLowerCase())
      .filter(Boolean)
  );
  const mentioned = extractSoHieuList(answer);
  const unknownSoHieu = mentioned.filter((s) => !sourceSo.has(compactSoHieu(s).toLowerCase()));

  const sourceDieu = new Set(
    matches
      .map((m) => String(m.dieu || '').toLowerCase())
      .filter((d) => d && d !== 'mo_dau')
  );
  const dieuMentions = extractDieuMentions(answer);
  const unverifiedDieu = dieuMentions.filter((d) => {
    const key = String(d).toLowerCase();
    if (sourceDieu.has(key)) return false;
    if (corpus.includes(`điều ${key}`)) return false;
    return true;
  });

  const durations = extractDurationClaims(answer);
  const unverifiedDurations = durations.filter((d) => {
    const n = normalizeForMatch(d);
    if (!n) return false;
    if (corpus.includes(n)) return false;
    const [num, unit] = n.split(' ');
    if (num && corpus.includes(num) && unit && corpus.includes(unit)) return false;
    return true;
  });

  return {
    quotes,
    unverifiedQuotes,
    unknownSoHieu,
    unverifiedDieu,
    unverifiedDurations,
    ok:
      unverifiedQuotes.length === 0 &&
      unknownSoHieu.length === 0 &&
      unverifiedDieu.length === 0 &&
      unverifiedDurations.length === 0,
  };
}

function appendVerifyNotes(answer, report) {
  if (report.ok) return answer;
  const notes = [];
  if (report.unverifiedQuotes?.length) {
    notes.push(
      'Một số câu trong ngoặc kép không khớp nguyên văn đoạn đã truy xuất — chỉ dùng căn cứ trong mục Nguồn.'
    );
  }
  if (report.unknownSoHieu?.length) {
    notes.push(
      `Số hiệu không có trong kho truy xuất lần này: ${report.unknownSoHieu.join(', ')} — không dùng làm căn cứ.`
    );
  }
  if (report.unverifiedDieu?.length) {
    notes.push(
      `Điều ${report.unverifiedDieu.join(', ')} không có trong đoạn đã truy xuất — cần đối chiếu bản gốc.`
    );
  }
  if (report.unverifiedDurations?.length) {
    notes.push(
      `Mốc thời hạn (${report.unverifiedDurations.join(', ')}) không khớp đoạn đã truy xuất — đối chiếu nguyên văn.`
    );
  }
  if (!notes.length) return answer;
  return `${String(answer || '').trim()}\n\n**Kiểm chứng:** ${notes.join(' ')}`;
}

function confidenceFromVerify(sources, report) {
  const n = sources?.length || 0;
  if (!n) return { level: 'low', label: 'Chưa có căn cứ trong kho', sources: 0 };
  if (!report?.ok) {
    return { level: 'medium', label: 'Có nguồn — cần đối chiếu nguyên văn', sources: n };
  }
  if (n >= 2) return { level: 'high', label: 'Độ tin cậy cao', sources: n };
  return { level: 'medium', label: 'Có căn cứ pháp lý', sources: n };
}

module.exports = {
  normalizeForMatch,
  extractQuotedSpans,
  extractDieuMentions,
  extractDurationClaims,
  verifyAnswerAgainstMatches,
  appendVerifyNotes,
  confidenceFromVerify,
};
