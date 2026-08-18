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
    examples: [
      'Nghị định nào còn hiệu lực về thủ tục hành chính?',
      'Văn bản quy định thời hạn giải quyết hồ sơ CCCD?',
      'So sánh quy định nghỉ phép năm theo Bộ luật Lao động',
    ],
  },
  advise: {
    id: 'advise',
    label: 'Tư vấn',
    short: 'Tư vấn TT',
    hint: 'Hướng dẫn từng bước thủ tục theo văn bản còn hiệu lực.',
    placeholder: 'Ví dụ: Tôi muốn làm thủ tục… cần giấy tờ gì, nộp ở đâu?',
    examples: [
      'Tôi mất CCCD, cần làm gì và mang giấy tờ gì?',
      'Đăng ký kinh doanh hộ cá thể gồm những bước nào?',
      'Xin cấp giấy phép xây dựng nhà ở cần hồ sơ gì?',
    ],
  },
}

export function getMode(id) {
  return MODES[id] || MODES.lookup
}
