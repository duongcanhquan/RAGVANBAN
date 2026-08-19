/**
 * Trích markdown links [title](url) → chips nguồn, kèm fallback từ mảng sources.
 */
export function extractSourceChips(markdown, fallbackSources = []) {
  const fromText = []
  const re = /\[([^\]]+)\]\(([^)]+)\)/g
  let match
  const seen = new Set()

  while ((match = re.exec(String(markdown || ''))) !== null) {
    const title = match[1].trim()
    const url = match[2].trim()
    if (!url || url === '#') continue
    const key = `${title}::${url}`
    if (seen.has(key)) continue
    seen.add(key)
    fromText.push({ title, url })
  }

  for (const s of fallbackSources || []) {
    const title = String(s.title || s.so_hieu || s.ten_file || '').trim()
    const url = String(s.url || s.link_goc || s.url_file_goc || '').trim()
    if (!title && !url) continue
    const key = `${title}::${url || title}`
    if (seen.has(key)) continue
    seen.add(key)
    fromText.push({
      title: title || 'Tài liệu',
      url,
      trang_thai: s.trang_thai || '',
      co_quan_ban_hanh: s.co_quan_ban_hanh || '',
      dieu: s.dieu || '',
      khoan: s.khoan || '',
    })
  }

  return fromText
}
