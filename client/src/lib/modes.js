/**
 * Chế độ vận hành hệ thống văn bản thông minh HCC.
 */

export const MODES = {
  lookup: {
    id: 'lookup',
    label: 'Tra cứu',
    short: 'Chỉ dẫn văn bản cần đọc',
    hint: 'Chỉ ra văn bản liên quan trực tiếp (gần nhất) và mục/điều/khoản cần đọc ngay; nếu còn liên quan gián tiếp thì liệt kê thêm “tham khảo thêm”. Không phân tích sâu.',
    placeholder: 'Hỏi về vấn đề/vướng mắc… để tìm: văn bản nào + điều/khoản/mục nào cần đọc?',
    examples: [],
  },
  advise: {
    id: 'advise',
    label: 'Tư vấn',
    short: 'Phân tích và áp dụng',
    hint: 'Phân tích sâu theo văn bản: nêu ý chính, cách áp dụng nhanh vào tình huống; chỉ rõ nên đọc mục/điều nào trước và tham khảo thêm ở đâu.',
    placeholder: 'Mô tả tình huống để tư vấn: cần áp dụng quy định nào, đọc mục/điều nào trước, tham khảo thêm mục nào?',
    examples: [],
  },
}

export function getMode(id) {
  return MODES[id] || MODES.lookup
}
