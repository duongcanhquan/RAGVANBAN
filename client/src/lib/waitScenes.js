/**
 * Câu chờ vui — giảm cảm giác đợi khi số hóa / tìm kiếm.
 */

const DIGITIZE = {
  ocr: [
    'Đang đọc từng trang (OCR) — chữ in thành dữ liệu…',
    'Lướt từng dòng quét, không bỏ chữ nhỏ…',
    'Trang scan đang được “đánh chữ” lại…',
  ],
  embed: [
    'Ghim trí nhớ vào kho — từng Điều một…',
    'Cắt theo Điều / Khoản cho dễ tìm sau này…',
    'Đưa đoạn văn vào két số, không để bay lung tung…',
  ],
  store: [
    'Gói file vào két R2 cho chắc…',
    'Kiểm vân tay — trùng thì không lưu hai lần…',
    'Sắp ngăn kéo đúng chuyên mục…',
  ],
  default: [
    'Đang số hóa — giấy thành trí nhớ…',
    'Máy đang “đọc hộ” văn bản cho bạn…',
    'Chờ một nhịp, kho đang mở ngăn…',
  ],
}

const CHAT = {
  route: [
    'Đang đoán đúng ngăn kéo lĩnh vực…',
    'Lọc xem bạn hỏi thủ tục hay tra cứu…',
  ],
  search: [
    'Đang lục ngăn văn bản còn hiệu lực…',
    'Lật từng Điều, không đoán mò…',
    'So số hiệu — tìm đúng tờ, đúng khoản…',
  ],
  compose: [
    'Đã có căn cứ — đang soạn câu trả lời…',
    'Viết chậm cho đúng nguồn, không bịa…',
    'Ghim trích dẫn vào từng ý…',
  ],
  think: [
    'Đang nghĩ cùng kho văn bản…',
    'Một nhịp nữa là có câu trả lời…',
  ],
}

function pick(list, salt) {
  const arr = list || []
  if (!arr.length) return ''
  const i = Math.abs(Number(salt) || 0) % arr.length
  return arr[i]
}

export function digitizeFunLine(percent, message) {
  const msg = String(message || '')
  const p = Number(percent) || 0
  if (/ocr|tesseract|trang\s+\d/i.test(msg)) return pick(DIGITIZE.ocr, p)
  if (/embed|vector|chunk|pinecone|trí nhớ/i.test(msg)) return pick(DIGITIZE.embed, p)
  if (/r2|lưu|storage|kho|hash|trùng/i.test(msg)) return pick(DIGITIZE.store, p)
  if (p < 20) return pick(DIGITIZE.store, p)
  if (p < 55) return pick(DIGITIZE.ocr, p)
  if (p < 85) return pick(DIGITIZE.embed, p)
  return pick(DIGITIZE.default, p)
}

export function chatWaitScene(statusText) {
  const s = String(statusText || '').toLowerCase()
  if (/soạn|đang viết|trả lời/.test(s)) {
    return { kind: 'compose', line: pick(CHAT.compose, s.length) }
  }
  if (/tìm|hiệu lực|đoạn|kho/.test(s)) {
    return { kind: 'search', line: pick(CHAT.search, s.length) }
  }
  if (/lĩnh vực|phân tích|tiếp nhận/.test(s)) {
    return { kind: 'route', line: pick(CHAT.route, s.length) }
  }
  return { kind: 'think', line: pick(CHAT.think, s.length) }
}

export function chatWaitTips(kind) {
  return CHAT[kind] || CHAT.think
}

export function digitizeTips(key) {
  return DIGITIZE[key] || DIGITIZE.default
}
