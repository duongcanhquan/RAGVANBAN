/**
 * QA Chain — Hệ thống văn bản thông minh HCC (tra cứu / tư vấn).
 * Nguyên tắc: zero-hallucination, luôn trích dẫn, tiếng Việt rõ ràng.
 */

const SHARED_RULES = `
NGUYÊN TẮC BẮT BUỘC:
1) Chỉ dựa vào context văn bản được cung cấp — tuyệt đối không bịa số hiệu, điều khoản, thời hạn.
2) Nếu thiếu thông tin: nói rõ "Không tìm thấy trong kho văn bản còn hiệu lực" và gợi ý cách hỏi lại.
3) Ưu tiên văn bản còn hiệu lực; nếu context có trạng thái khác, nêu rõ.
4) Tiếng Việt ngắn gọn, dễ hiểu với người dân / cán bộ một cửa.
5) Cuối câu trả lời LUÔN có mục "Nguồn:" dạng markdown [Tên VB](URL). Không có URL thì dùng (#).
6) Không thay thế tư vấn pháp lý cá nhân hóa khi hồ sơ đặc thù — ghi chú khi cần.
`.trim()

const LOOKUP_PROMPT = `Bạn là chuyên viên tra cứu văn bản hành chính Việt Nam trong hệ thống HCC.
Nhiệm vụ: TRẢ LỜI CHÍNH XÁC câu hỏi về quy định / số hiệu / hiệu lực / nội dung điều khoản.
${SHARED_RULES}

CẤU TRÚC TRẢ LỜI:
**Kết luận:** (1–2 câu trả lời trực tiếp)
**Căn cứ:** Điều/khoản · số hiệu · cơ quan (nếu có trong context)
**Hiệu lực:** Còn hiệu lực / lưu ý thay thế (nếu có)
**Nguồn:**
- [Loại VB số hiệu](URL)`

const ADVISE_PROMPT = `Bạn là chuyên viên tư vấn thủ tục hành chính công Việt Nam trong hệ thống HCC.
Nhiệm vụ: HƯỚNG DẪN THỰC HIỆN theo đúng văn bản còn hiệu lực trong context (không đoán mò).
${SHARED_RULES}

CẤU TRÚC TRẢ LỜI:
**Tóm tắt:** người dân cần làm gì (1–2 câu)
**Hồ sơ / giấy tờ:** liệt kê gạch đầu dòng (chỉ những gì có trong context)
**Các bước:** đánh số 1, 2, 3…
**Nơi nộp / thời hạn:** nếu có trong context; thiếu thì nói chưa có trong kho
**Lưu ý:** điểm dễ sai hoặc điều kiện đặc thù (nếu có)
**Nguồn:**
- [Loại VB số hiệu](URL)`

function getSystemPrompt(mode = 'lookup') {
  return mode === 'advise' ? ADVISE_PROMPT : LOOKUP_PROMPT
}

function formatContext(matches) {
  if (!matches?.length) return '(Không có đoạn văn bản nào được truy xuất.)'

  return matches
    .map((m, i) => {
      const title =
        [m.loai_van_ban, m.so_hieu].filter(Boolean).join(' ') || m.ten_file || `Nguồn ${i + 1}`
      const link = m.link_goc || m.url_file_goc || ''
      return `[#${i + 1}] ${title}
Cơ quan: ${m.co_quan_ban_hanh || '—'}
Trạng thái: ${m.trang_thai || '—'}
Ngày: ${m.ngay_ban_hanh || '—'}
URL: ${link}
Nội dung:
${m.text}`
    })
    .join('\n\n---\n\n')
}

function buildSourceList(matches) {
  const seen = new Set()
  const sources = []

  for (const m of matches || []) {
    const title =
      [m.loai_van_ban, m.so_hieu].filter(Boolean).join(' ') || m.ten_file || 'Văn bản'
    const url = m.link_goc || m.url_file_goc || ''
    const key = `${title}::${url}`
    if (seen.has(key)) continue
    seen.add(key)
    sources.push({
      title,
      url,
      so_hieu: m.so_hieu || '',
      trang_thai: m.trang_thai || '',
      co_quan_ban_hanh: m.co_quan_ban_hanh || '',
    })
  }

  return sources
}

function extractSourceLinksFromAnswer(answer) {
  const links = []
  const re = /\[([^\]]+)\]\(([^)]+)\)/g
  let match
  while ((match = re.exec(String(answer || ''))) !== null) {
    links.push({ title: match[1], url: match[2] })
  }
  return links
}

function confidenceFromSources(sources) {
  const n = sources?.length || 0
  if (n >= 2) return { level: 'high', label: 'Độ tin cậy cao', sources: n }
  if (n === 1) return { level: 'medium', label: 'Có căn cứ pháp lý', sources: n }
  return { level: 'low', label: 'Chưa có căn cứ trong kho', sources: 0 }
}

async function streamAnswer(question, matches, deps, onToken) {
  const { llm, scenarioContext = '', mode = 'lookup' } = deps
  if (!llm?.stream) {
    throw new Error('streamAnswer: cần llm.stream')
  }

  const context = formatContext(matches)
  const sources = buildSourceList(matches)
  const systemPrompt = getSystemPrompt(mode)

  const scenarioBlock = scenarioContext
    ? `\nTình huống mẫu liên quan (chỉ tham khảo quy trình; ưu tiên văn bản pháp lý trong context):\n${scenarioContext}\n`
    : ''

  const modeHint =
    mode === 'advise'
      ? 'Chế độ: TƯ VẤN THỦ TỤC — trả lời theo cấu trúc hồ sơ/bước/nơi nộp.'
      : 'Chế độ: TRA CỨU VĂN BẢN — trả lời trực tiếp quy định + căn cứ.'

  const userPrompt = `${modeHint}

Câu hỏi:
"""${question}"""
${scenarioBlock}
Context văn bản:
"""
${context}
"""

Hãy trả lời theo đúng quy tắc hệ thống.`

  let answer = ''
  const stream = await llm.stream([
    { role: 'system', content: systemPrompt },
    { role: 'user', content: userPrompt },
  ])

  for await (const chunk of stream) {
    const token =
      typeof chunk?.content === 'string'
        ? chunk.content
        : Array.isArray(chunk?.content)
          ? chunk.content.map((c) => c.text || '').join('')
          : ''
    if (!token) continue
    answer += token
    if (onToken) onToken(token)
  }

  if (sources.length && !/nguồn\s*:/i.test(answer)) {
    const appendix =
      '\n\nNguồn:\n' + sources.map((s) => `- [${s.title}](${s.url || '#'})`).join('\n')
    answer += appendix
    if (onToken) onToken(appendix)
  }

  return {
    answer,
    sources,
    confidence: confidenceFromSources(sources),
    mode,
  }
}

function buildNoContextAnswer(mode = 'lookup') {
  const tip =
    mode === 'advise'
      ? 'Bạn có thể mô tả rõ hơn: loại thủ tục, đối tượng (cá nhân/tổ chức), tỉnh/thành nếu liên quan.'
      : 'Bạn có thể nêu số hiệu, lĩnh vực, hoặc từ khóa điều khoản cần tra.'
  return {
    answer: `Không tìm thấy thông tin phù hợp trong kho văn bản còn hiệu lực để trả lời câu hỏi này.\n\nGợi ý: ${tip}\n\nNguồn: (không có)`,
    sources: [],
    confidence: confidenceFromSources([]),
    mode,
  }
}

module.exports = {
  LOOKUP_PROMPT,
  ADVISE_PROMPT,
  QA_SYSTEM_PROMPT: LOOKUP_PROMPT,
  getSystemPrompt,
  formatContext,
  buildSourceList,
  extractSourceLinksFromAnswer,
  confidenceFromSources,
  streamAnswer,
  buildNoContextAnswer,
}
