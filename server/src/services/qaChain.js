/**
 * QA Chain — zero-hallucination, trích dẫn, xử lý VB sửa đổi/bổ sung.
 */

const { composeSystemPrompt, defaultVoice } = require('./voiceConfig');
const { formatConversationForPrompt } = require('./sessionSearchCache');
const {
  verifyAnswerAgainstMatches,
  appendVerifyNotes,
  confidenceFromVerify,
} = require('./citationVerify');
const { buildConflictBrief } = require('./conflictBrief');
const { throwIfAborted, raceAbort, abortableAsyncIter } = require('./abortControl');
const { compactSoHieu } = require('../ingestion/legalChunker');

function getSystemPrompt(mode = 'lookup', voice, extras = {}) {
  return composeSystemPrompt(mode, voice || defaultVoice(), extras);
}

function articleLabel(m) {
  const bits = [];
  if (m.dieu && m.dieu !== 'mo_dau') {
    bits.push(`Điều ${m.dieu}`);
    if (m.khoan) bits.push(`khoản ${m.khoan}`);
  } else if (m.dieu === 'mo_dau') {
    bits.push('Phần mở đầu');
  }
  return bits.join(' ');
}

function documentKey(m) {
  const so = compactSoHieu(m?.so_hieu || '').toLowerCase();
  const url = String(m?.link_goc || m?.url_file_goc || '')
    .trim()
    .replace(/\/$/, '')
    .toLowerCase();
  const file = String(m?.ten_file || '')
    .trim()
    .toLowerCase();
  if (so && so !== 'không rõ') return `so:${so}`;
  if (url) return `url:${url}`;
  if (file) return `file:${file}`;
  return `row:${m?.id || ''}`;
}

function groupMatchesByDocument(matches) {
  const map = new Map();
  for (const m of matches || []) {
    const key = documentKey(m);
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(m);
  }
  return [...map.values()];
}

function relationLine(m) {
  return [
    ...(m.van_ban_sua_doi || []).map((s) => `sửa đổi/bổ sung ${s}`),
    ...(m.van_ban_thay_the || []).map((s) => `thay thế ${s}`),
    m.van_ban_goc ? `văn bản gốc ${m.van_ban_goc}` : '',
  ]
    .filter(Boolean)
    .join('; ');
}

function formatContext(matches) {
  if (!matches?.length) return '(Không có đoạn văn bản nào được truy xuất.)';

  const brief = buildConflictBrief(matches);
  const body = groupMatchesByDocument(matches)
    .map((group, i) => {
      const m = group[0];
      const title =
        [m.loai_van_ban, m.so_hieu].filter(Boolean).join(' ') || m.ten_file || `Nguồn ${i + 1}`;
      const link = m.link_goc || m.url_file_goc || '';
      const rel =
        [...new Set(group.map(relationLine).filter(Boolean))].join('; ') || '';
      const related = group.some((x) => x.related);
      const chunks = group
        .map((part) => {
          const article = articleLabel(part);
          return `${article ? `— ${article} —` : '— Đoạn —'}\n${part.text}`;
        })
        .join('\n\n');
      return `[#${i + 1}] ${title}
Cơ quan: ${m.co_quan_ban_hanh || '—'}
Trạng thái: ${m.trang_thai || '—'}
Ngày: ${m.ngay_ban_hanh || '—'}
${rel ? `Quan hệ: ${rel}` : 'Quan hệ: —'}
${related ? 'Ghi chú: đoạn kéo theo quan hệ sửa đổi/bổ sung (đối chiếu với VB đang hỏi).' : ''}
URL: ${link}
Các điều trong cùng văn bản (chỉ dùng điều trả lời đúng câu hỏi):
${chunks}`;
    })
    .join('\n\n====\n\n');

  return brief ? `${brief}\n\n---\n\n${body}` : body;
}

function buildSourceList(matches) {
  const seen = new Map();

  for (const m of matches || []) {
    const key = documentKey(m);
    const title =
      [m.loai_van_ban, m.so_hieu].filter(Boolean).join(' ') || m.ten_file || 'Văn bản';
    const url = m.link_goc || m.url_file_goc || '';
    if (!seen.has(key)) {
      seen.set(key, {
        title,
        url,
        so_hieu: m.so_hieu || '',
        trang_thai: m.trang_thai || '',
        co_quan_ban_hanh: m.co_quan_ban_hanh || '',
        dieu: '',
        khoan: m.khoan || '',
      });
    }
    const row = seen.get(key);
    if (!row.url && url) row.url = url;
    if (m.dieu && m.dieu !== 'mo_dau') {
      const bits = row.dieu ? row.dieu.split(',') : [];
      if (!bits.includes(String(m.dieu))) bits.push(String(m.dieu));
      row.dieu = bits.join(',');
    }
  }

  return [...seen.values()];
}

function normalizeCiteUrl(url) {
  return String(url || '')
    .trim()
    .replace(/\/$/, '')
    .toLowerCase();
}

function collapseKiemChungBlocks(text) {
  let seen = false;
  return String(text || '').replace(/(\n\n)?\*\*Kiểm chứng:\*\*[^\n]*/g, (block) => {
    if (seen) return '';
    seen = true;
    return block;
  });
}

function uniqueNguonBullets(text) {
  const src = String(text || '');
  const idx = src.search(/\n\s*(?:\*\*)?Nguồn:(?:\*\*)?/i);
  if (idx < 0) return src;
  const head = src.slice(0, idx);
  const rest = src.slice(idx);
  const kiem = rest.search(/\n\s*\*\*Kiểm chứng:/i);
  const block = kiem >= 0 ? rest.slice(0, kiem) : rest;
  const tail = kiem >= 0 ? rest.slice(kiem) : '';
  const lines = block.split('\n');
  const seen = new Set();
  const kept = [];
  for (const line of lines) {
    const bullet = /^\s*[-*]\s+/.test(line);
    if (!bullet) {
      kept.push(line);
      continue;
    }
    const linked = line.match(/\]\(([^)]+)\)/);
    const url = linked ? normalizeCiteUrl(linked[1]) : '';
    const title = line
      .replace(/^\s*[-*]\s+/, '')
      .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
      .replace(/\s*·\s*Điều\s+\S+(?:\s+khoản\s+\S+)?/gi, '')
      .trim()
      .toLowerCase();
    const key = url && url !== '#' ? `u:${url}` : `t:${title}`;
    if (seen.has(key)) continue;
    seen.add(key);
    kept.push(line);
  }
  return head + kept.join('\n') + tail;
}

function firstLinkWins(text) {
  const seen = new Set();
  return String(text || '').replace(/\[([^\]]+)\]\(([^)]+)\)/g, (all, title, url) => {
    const key = normalizeCiteUrl(url);
    if (!key || key === '#') return all;
    if (seen.has(key)) return title;
    seen.add(key);
    return all;
  });
}

/** Mỗi văn bản một link; bỏ Nguồn/Kiểm chứng lặp. */
function collapseAnswerCitations(answer) {
  let text = String(answer || '');
  text = collapseKiemChungBlocks(text);
  text = uniqueNguonBullets(text);
  text = firstLinkWins(text);
  return text.replace(/\n{3,}/g, '\n\n').trim();
}

function extractSourceLinksFromAnswer(answer) {
  const links = [];
  const re = /\[([^\]]+)\]\(([^)]+)\)/g;
  let match;
  while ((match = re.exec(String(answer || ''))) !== null) {
    links.push({ title: match[1], url: match[2] });
  }
  return links;
}

function confidenceFromSources(sources, report) {
  if (report) return confidenceFromVerify(sources, report);
  const n = sources?.length || 0;
  if (n >= 2) return { level: 'high', label: 'Độ tin cậy cao', sources: n };
  if (n === 1) return { level: 'medium', label: 'Có căn cứ pháp lý', sources: n };
  return { level: 'low', label: 'Chưa có căn cứ trong kho', sources: 0 };
}

async function streamAnswer(question, matches, deps, onToken) {
  const {
    llm,
    scenarioContext = '',
    skillContext = '',
    mode = 'lookup',
    voice,
    spoken = false,
    signal,
    conversationTurns = [],
  } = deps;
  if (!llm?.stream) {
    throw new Error('streamAnswer: cần llm.stream');
  }
  throwIfAborted(signal);

  const context = formatContext(matches);
  const sources = buildSourceList(matches);
  const systemPrompt = getSystemPrompt(mode, voice, { skillContext });
  const conversationBlock = formatConversationForPrompt(conversationTurns);

  const scenarioBlock = scenarioContext
    ? `\nTình huống mẫu liên quan (chỉ tham khảo quy trình; ưu tiên văn bản pháp lý trong context):\n${scenarioContext}\n`
    : '';

  const modeHint =
    mode === 'advise'
      ? 'Chế độ: TƯ VẤN TÌNH HUỐNG — lấy quy định trong context và áp vào việc đang hỏi. Không bắt context phải là quy trình nộp hồ sơ. Có điều/khoản liên quan thì kết luận cách áp dụng; hồ sơ/bước chỉ khi có trong context.'
      : mode === 'compare'
        ? 'Chế độ: SO SÁNH / SỬA ĐỔI — tách bản còn hiệu lực và điểm đã bị sửa.'
        : 'Chế độ: TRA CỨU NHANH — tìm đúng văn bản/điều khoản, kết luận + căn cứ + hiệu lực.';

  const spokenHint = spoken
    ? '\nChế độ GIỌNG NÓI: câu ngắn, xuống dòng sớm, dễ đọc thành tiếng. Tránh bảng markdown dài. Nguồn để cuối.'
    : '';

  const focusHint = `
Yêu cầu trọng tâm (bắt buộc):
- Câu đầu tiên phải trả lời trực tiếp câu hỏi (có/không, con số, đối tượng, thời hạn, điều kiện). Cấm mở đầu chung chung như "Theo quy định hiện hành", "Văn bản có một số nội dung liên quan".
- Chỉ lấy điều/khoản trong context thực sự cần cho câu hỏi. Có nhiều điều cùng một văn bản thì không liệt kê hết — không tóm tắt cả văn bản.
- Điều/Khoản nêu trong phần căn cứ. Mục Nguồn: mỗi văn bản đúng 1 dòng, 1 URL. Không nhân bản nguồn theo từng điều. Không lặp link. Không lặp mục Kiểm chứng.
${
  mode === 'advise'
    ? '- Tư vấn: nếu context có quy định liên quan tình huống thì phải trả lời cách áp dụng. Cấm bảo không có dữ liệu chỉ vì không thấy mục “hồ sơ/nơi nộp”.'
    : ''
}`;

  const userPrompt = `${modeHint}${spokenHint}
${focusHint}
${conversationBlock ? `\n${conversationBlock}\n` : ''}
Câu hỏi hiện tại (trọng tâm):
"""${question}"""
${scenarioBlock}
Context văn bản (đã lọc hết hiệu lực khi có; các điều cùng một VB đã gom chung):
"""
${context}
"""

Hãy trả lời đúng câu hỏi theo quy tắc hệ thống. Nếu hai văn bản mâu thuẫn, nêu cả hai và chỉ rõ bản nào còn hiệu lực theo trạng thái/ngày trong context.`;

  let answer = '';
  const streamOpts = signal ? { signal } : undefined;
  const stream = await raceAbort(
    Promise.resolve(
      streamOpts
        ? llm.stream(
            [
              { role: 'system', content: systemPrompt },
              { role: 'user', content: userPrompt },
            ],
            streamOpts
          )
        : llm.stream([
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt },
          ])
    ),
    signal
  );

  for await (const chunk of abortableAsyncIter(stream, signal)) {
    const token =
      typeof chunk?.content === 'string'
        ? chunk.content
        : Array.isArray(chunk?.content)
          ? chunk.content.map((c) => c.text || '').join('')
          : '';
    if (!token) continue;
    answer += token;
    if (onToken) onToken(token);
  }

  if (sources.length && !/nguồn\s*:/i.test(answer)) {
    const appendix =
      '\n\nNguồn:\n' + sources.map((s) => `- [${s.title}](${s.url || '#'})`).join('\n');
    answer += appendix;
    if (onToken) onToken(appendix);
  }

  const polished = collapseAnswerCitations(answer);
  if (polished !== answer && onToken) {
    const extra = polished.startsWith(answer) ? polished.slice(answer.length) : '';
    if (extra) onToken(extra);
  }
  answer = polished;

  const report = verifyAnswerAgainstMatches(answer, matches);
  const verified = appendVerifyNotes(answer, report);
  if (verified !== answer && onToken) {
    onToken(verified.slice(answer.length));
  }

  return {
    answer: verified,
    sources,
    confidence: confidenceFromSources(sources, report),
    mode,
    verify: report,
  };
}

function buildNoContextAnswer(mode = 'lookup') {
  const tip =
    mode === 'advise'
      ? 'Bạn có thể mô tả rõ hơn: loại thủ tục, đối tượng (cá nhân/tổ chức), tỉnh/thành nếu liên quan.'
      : 'Bạn có thể nêu số hiệu, lĩnh vực, hoặc từ khóa điều khoản cần tra.';
  return {
    answer: `Không tìm thấy thông tin phù hợp trong kho văn bản còn hiệu lực để trả lời câu hỏi này.\n\nGợi ý: ${tip}\n\nNguồn: (không có)`,
    sources: [],
    confidence: confidenceFromSources([]),
    mode,
  };
}

module.exports = {
  LOOKUP_PROMPT: composeSystemPrompt('lookup'),
  ADVISE_PROMPT: composeSystemPrompt('advise'),
  QA_SYSTEM_PROMPT: composeSystemPrompt('lookup'),
  getSystemPrompt,
  formatContext,
  buildSourceList,
  extractSourceLinksFromAnswer,
  confidenceFromSources,
  streamAnswer,
  buildNoContextAnswer,
  buildConflictBrief,
  collapseAnswerCitations,
  documentKey,
};
