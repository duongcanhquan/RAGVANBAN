import { FolderTree, Lightbulb, MessageSquareText } from 'lucide-react'

export const MAIN_SECTION_NAV = [
  { to: '/', end: true, label: 'Hỏi đáp', short: 'Hỏi', Icon: MessageSquareText },
  { to: '/thu-vien', label: 'Thư viện', short: 'Cây', Icon: FolderTree },
  { to: '/tinh-huong', label: 'Tình huống', short: 'Mẫu', Icon: Lightbulb },
]
