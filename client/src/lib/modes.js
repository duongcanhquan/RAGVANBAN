/**
 * Chế độ vận hành hệ thống văn bản thông minh HCC.
 */

export const MODES = {
  lookup: {
    id: 'lookup',
    label: 'Tra cứu',
    short: 'Định hướng văn bản liên quan',
    hint: 'Định hướng nhanh văn bản/điều khoản liên quan để bạn mở đúng chỗ cần đọc (không phân tích sâu).',
    placeholder: 'Hỏi để tìm văn bản liên quan: quy định này nằm ở văn bản nào, điều khoản nào?',
    examples: [],
  },
  advise: {
    id: 'advise',
    label: 'Tư vấn',
    short: 'Phân tích và áp dụng',
    hint: 'Phân tích sâu hơn theo văn bản, nêu ý chính cần đọc, điều khoản liên quan và cách áp dụng nhanh.',
    placeholder: 'Mô tả tình huống để tư vấn: cần áp dụng quy định nào, đọc mục nào trước, tham khảo thêm ở đâu?',
    examples: [],
  },
}

export function getMode(id) {
  return MODES[id] || MODES.lookup
}
