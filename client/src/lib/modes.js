/**
 * Chế độ vận hành hệ thống văn bản thông minh HCC.
 */

export const MODES = {
  lookup: {
    id: 'lookup',
    label: 'Tra cứu',
    short: 'Tìm văn bản nhanh',
    hint: 'Tìm nhanh quy định, số hiệu, điều khoản, hiệu lực — kèm nguồn gốc.',
    placeholder: 'Số hiệu hoặc từ khóa văn bản: Nghị định nào quy định… còn hiệu lực…?',
    examples: [],
  },
  advise: {
    id: 'advise',
    label: 'Tư vấn',
    short: 'Áp dụng tình huống',
    hint: 'Mô tả tình huống thực tế — đối chiếu quy định trong kho và cách áp dụng.',
    placeholder: 'Mô tả tình huống: đối tượng, việc xảy ra, cần xử lý / áp dụng thế nào…',
    examples: [],
  },
}

export function getMode(id) {
  return MODES[id] || MODES.lookup
}
