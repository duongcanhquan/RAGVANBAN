/**
 * Chế độ vận hành hệ thống văn bản thông minh HCC.
 */

export const MODES = {
  lookup: {
    id: 'lookup',
    label: 'Tra cứu',
    short: 'Chỉ dẫn văn bản cần đọc',
    hint: 'Chỉ ra văn bản liên quan trực tiếp (gần nhất) và mục/điều/khoản cần đọc ngay',
    placeholder: 'Hỏi về vấn đề/vướng mắc… để tìm: văn bản nào + điều/khoản/mục nào cần đọc?',
    examples: [],
  },
  advise: {
    id: 'advise',
    label: 'Tư vấn',
    short: 'Phân tích và áp dụng',
    hint: 'Phong cách pháp chế/luật sư: kết luận “trường hợp này” sẽ áp dụng gì; nêu điều kiện/ngoại lệ (ngắn) và chỉ rõ nên đọc mục/điều nào ngay + cần đọc thêm phần nào để chú ý.',
    placeholder: 'Mô tả tình huống để tư vấn: cần áp dụng quy định nào, điều kiện/ngoại lệ ra sao, nên đọc mục nào ngay và đọc thêm mục nào?',
    examples: [],
  },
}

export function getMode(id) {
  return MODES[id] || MODES.lookup
}
