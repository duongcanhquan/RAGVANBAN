/**
 * Quick unit check for source chip extraction.
 */
import assert from 'node:assert/strict'
import { extractSourceChips } from '../src/lib/sources.js'

const chips = extractSourceChips(
  'Nguồn:\n- [Nghị định 01](https://example.com/a.pdf)',
  [{ title: 'Extra', url: 'https://example.com/b.pdf' }]
)
assert.equal(chips.length, 2)
assert.equal(chips[0].url, 'https://example.com/a.pdf')

const fallback = extractSourceChips('Không có link markdown', [
  { so_hieu: '01/2024/NĐ-CP', trang_thai: 'Còn hiệu lực', dieu: '5' },
])
assert.equal(fallback.length, 1)
assert.equal(fallback[0].title, '01/2024/NĐ-CP')
assert.equal(fallback[0].trang_thai, 'Còn hiệu lực')

console.log('✓ extractSourceChips')
