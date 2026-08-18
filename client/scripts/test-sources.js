/**
 * Quick unit check for source chip extraction.
 */
import assert from 'node:assert/strict'

function extractSourceChips(markdown, fallbackSources = []) {
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

const chips = extractSourceChips(
  'Nguồn:\n- [Nghị định 01](https://example.com/a.pdf)',
  [{ title: 'Extra', url: 'https://example.com/b.pdf' }]
)
assert.equal(chips.length, 2)
assert.equal(chips[0].url, 'https://example.com/a.pdf')
console.log('✓ extractSourceChips')
