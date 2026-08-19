/**
 * Trích markdown links [title](url) → chips nguồn, kèm fallback từ mảng sources.
 * Cùng một URL / số hiệu chỉ hiện 1 lần.
 */
export function normalizeSourceUrl(url) {
  return String(url || '')
    .trim()
    .replace(/\/$/, '')
    .toLowerCase()
}

export function sourceChipKey(item) {
  const url = normalizeSourceUrl(item?.url)
  if (url && url !== '#') return `u:${url}`
  const so = String(item?.so_hieu || '')
    .replace(/\s+/g, '')
    .toLowerCase()
  if (so) return `s:${so}`
  return `t:${String(item?.title || '').replace(/\s*·\s*điều.*$/i, '').trim().toLowerCase()}`
}

export function extractSourceChips(markdown, fallbackSources = []) {
  const fromText = []
  const re = /\[([^\]]+)\]\(([^)]+)\)/g
  let match
  const seen = new Set()

  while ((match = re.exec(String(markdown || ''))) !== null) {
    const title = match[1].trim()
    const url = match[2].trim()
    if (!url || url === '#') continue
    const key = sourceChipKey({ title, url })
    if (seen.has(key)) continue
    seen.add(key)
    fromText.push({ title, url })
  }

  for (const s of fallbackSources || []) {
    const title = String(s.title || s.so_hieu || s.ten_file || '').trim()
    const url = String(s.url || s.link_goc || s.url_file_goc || '').trim()
    if (!title && !url) continue
    const key = sourceChipKey({
      title,
      url,
      so_hieu: s.so_hieu,
    })
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

/** Chip phụ dưới bài: chỉ nguồn chưa xuất hiện trong nội dung. */
export function extraSourceChips(markdown, fallbackSources = []) {
  const inBody = extractSourceChips(markdown, [])
  const seen = new Set(inBody.map((c) => sourceChipKey(c)))
  return extractSourceChips('', fallbackSources).filter((s) => !seen.has(sourceChipKey(s)))
}
