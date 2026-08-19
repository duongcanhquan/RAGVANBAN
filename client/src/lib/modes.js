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
    hint: 'Pháp chế/luật sư giáo dục: lý luận ngắn gọn, sắc bén — đánh giá tình huống và hướng xử lý dựa trên văn bản.',
    placeholder: 'Mô tả tình huống: đối tượng, việc xảy ra, cần quyết định gì…',
    examples: [],
  },
}

export function getMode(id) {
  return MODES[id] || MODES.lookup
}
