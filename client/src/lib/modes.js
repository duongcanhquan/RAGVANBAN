/**
 * Chế độ vận hành hệ thống văn bản thông minh HCC.
 */

export const MODES = {
  lookup: {
    id: 'lookup',
    label: 'Tra cứu',
    short: 'Tra cứu VB',
    hint: 'Tìm đúng quy định, số hiệu, hiệu lực — kèm nguồn gốc.',
            placeholder: 'Ví dụ: Nghị định nào quy định về…? Văn bản còn hiệu lực về…?',
    examples: [],
  },
  advise: {
    id: 'advise',
    label: 'Tư vấn',
    short: 'Tư vấn TT',
    hint: 'Hướng dẫn từng bước thủ tục theo văn bản còn hiệu lực.',
            placeholder: 'Ví dụ: Tôi muốn hỏi văn bản trong kho — quy định gì, áp dụng thế nào?',
    examples: [],
  },
}

export function getMode(id) {
  return MODES[id] || MODES.lookup
}
