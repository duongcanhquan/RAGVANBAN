/**
 * Chế độ vận hành hệ thống văn bản thông minh HCC.
 */

export const MODES = {
  lookup: {
    id: 'lookup',
    label: 'Tra cứu',
    short: 'Tìm văn bản và điều khoản',
    hint: '',
    placeholder: 'Hỏi về số hiệu, điều khoản hoặc nội dung văn bản…',
    examples: [],
  },
  advise: {
    id: 'advise',
    label: 'Tư vấn',
    short: 'Phân tích và áp dụng',
    hint: '',
    placeholder: 'Mô tả tình huống cần tư vấn…',
    examples: [],
  },
}

export function getMode(id) {
  return MODES[id] || MODES.lookup
}
