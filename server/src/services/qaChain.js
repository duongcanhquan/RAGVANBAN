/**
 * QA Chain — zero-hallucination, trích dẫn, xử lý VB sửa đổi/bổ sung.
 */

const { composeSystemPrompt, defaultVoice } = require('./voiceConfig');
const {
  verifyAnswerAgainstMatches,
  appendVerifyNotes,
  confidenceFromVerify,
} = require('./citationVerify');
const { buildConflictBrief } = require('./conflictBrief');
const { throwIfAborted, raceAbort, abortableAsyncIter } = require('./abortControl');

function getSystemPrompt(mode = 'lookup', voice) {
  return composeSystemPrompt(mode, voice || defaultVoice());
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

function formatContext(matches) {
  if (!matches?.length) return '(Không có đoạn văn bản nào được truy xuất.)';

  const brief = buildConflictBrief(matches);
  const body = matches
    .map((m, i) => {
      const title =
        [m.loai_van_ban, m.so_hieu].filter(Boolean).join(' ') || m.ten_file || `Nguồn ${i + 1}`;
      const link = m.link_goc || m.url_file_goc || '';
      const article = articleLabel(m);
      const rel = [
        ...(m.van_ban_sua_doi || []).map((s) => `sửa đổi/bổ sung ${s}`),
        ...(m.van_ban_thay_the || []).map((s) => `thay thế ${s}`),
        m.van_ban_goc ? `văn bản gốc ${m.van_ban_goc}` : '',
      ]
        .filter(Boolean)
        .join('; ');
      return `[#${i + 1}] ${title}${article ? ` · ${article}` : ''}
Cơ quan: ${m.co_quan_ban_hanh || '—'}
Trạng thái: ${m.trang_thai || '—'}
Ngày: ${m.ngay_ban_hanh || '—'}
${rel ? `Quan hệ: ${rel}` : 'Quan hệ: —'}
${m.related ? 'Ghi chú: đoạn kéo theo quan hệ sửa đổi/bổ sung (đối chiếu với VB đang hỏi).' : ''}
URL: ${link}
Nội dung:
${m.text}`;
    })
    .join('\n\n---\n\n');

  return brief ? `${brief}\n\n---\n\n${body}` : body;
}

function buildSourceList(matches) {
  const seen = new Set();
  const sources = [];

  for (const m of matches || []) {
    const title =
      [m.loai_van_ban, m.so_hieu].filter(Boolean).join(' ') || m.ten_file || 'Văn bản';
    const url = m.link_goc || m.url_file_goc || '';
    const article = articleLabel(m);
    const key = `${title}::${url}::${article}`;
    if (seen.has(key)) continue;
    seen.add(key);
    sources.push({
      title: article ? `${title} · ${article}` : title,
      url,
      so_hieu: m.so_hieu || '',
      trang_thai: m.trang_thai || '',
      co_quan_ban_hanh: m.co_quan_ban_hanh || '',
      dieu: m.dieu || '',
      khoan: m.khoan || '',
    });
  }

  return sources;
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
  const { llm, scenarioContext = '', mode = 'lookup', voice, spoken = false, signal } = deps;
  if (!llm?.stream) {
    throw new Error('streamAnswer: cần llm.stream');
  }
  throwIfAborted(signal);

  const context = formatContext(matches);
  const sources = buildSourceList(matches);
  const systemPrompt = getSystemPrompt(mode, voice);

  const scenarioBlock = scenarioContext
    ? `\nTình huống mẫu liên quan (chỉ tham khảo quy trình; ưu tiên văn bản pháp lý trong context):\n${scenarioContext}\n`
    : '';

  const modeHint =
    mode === 'advise'
      ? 'Chế độ: TƯ VẤN THỦ TỤC — hồ sơ/bước/nơi nộp chỉ khi có trong context.'
      : mode === 'compare'
        ? 'Chế độ: SO SÁNH / SỬA ĐỔI — tách bản còn hiệu lực và điểm đã bị sửa.'
        : 'Chế độ: TRA CỨU VĂN BẢN — kết luận + căn cứ + hiệu lực.';

  const spokenHint = spoken
    ? '\nChế độ GIỌNG NÓI: câu ngắn, xuống dòng sớm, dễ đọc thành tiếng. Tránh bảng markdown dài. Nguồn để cuối.'
    : '';

  const userPrompt = `${modeHint}${spokenHint}

Câu hỏi:
"""${question}"""
${scenarioBlock}
Context văn bản (đã lọc hết hiệu lực khi có; có thể gồm VB sửa đổi/bổ sung):
"""
${context}
"""

Hãy trả lời theo đúng quy tắc hệ thống. Nếu hai đoạn mâu thuẫn, nêu cả hai và chỉ rõ bản nào còn hiệu lực theo trạng thái/ngày trong context.`;

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
};
