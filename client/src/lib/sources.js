/**
 * Trích markdown links [title](url) → chips nguồn.
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
    const title = (s.title || '').trim()
    const url = (s.url || '').trim()
    if (!url) continue
    const key = `${title}::${url}`
    if (seen.has(key)) continue
    seen.add(key)
    fromText.push({ title: title || 'Tài liệu', url })
  }

  return fromText
}
