/**
 * Quick unit check for source chip extraction + gom đoạn chat.
 */
import assert from 'node:assert/strict'
import { extractSourceChips, extraSourceChips } from '../src/lib/sources.js'
import {
  conversationHistoryFromMessages,
  groupHistoryIntoThreads,
  threadToMessages,
} from '../src/lib/conversationHistory.js'

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

const extra = extractSourceChips(
  'Nguồn:\n- [Nghị định 01 Điều 1](https://example.com/a.pdf)\n- [Nghị định 01 Điều 5](https://example.com/a.pdf)',
  [
    { title: 'Nghị định 01 Điều 8', url: 'https://example.com/a.pdf' },
    { title: 'Nghị định 01 Điều 12', url: 'https://example.com/a.pdf' },
  ]
)
assert.equal(extra.length, 1)
assert.equal(extra[0].url, 'https://example.com/a.pdf')

const extraOnly = extraSourceChips(
  'Nguồn:\n- [Nghị định 01](https://example.com/a.pdf)',
  [
    { title: 'Nghị định 01 Điều 5', url: 'https://example.com/a.pdf' },
    { title: 'Nghị định 02', url: 'https://example.com/b.pdf' },
  ]
)
assert.equal(extraOnly.length, 1)
assert.equal(extraOnly[0].url, 'https://example.com/b.pdf')

const history = conversationHistoryFromMessages([
  { role: 'user', content: 'Thủ tục cấp lại CCCD?' },
  { role: 'assistant', content: 'Cần tờ khai.', streaming: true },
  { role: 'assistant', content: 'Cần tờ khai và CCCD cũ.' },
  { role: 'user', content: 'Cụ thể giấy tờ nào?' },
])
assert.equal(history.length, 3)
assert.equal(history[0].role, 'user')
assert.equal(history[1].content, 'Cần tờ khai và CCCD cũ.')
assert.equal(history[2].content, 'Cụ thể giấy tờ nào?')

const threads = groupHistoryIntoThreads([
  {
    id: 'a',
    conversationId: 'c1',
    question: 'Điều 5 nói gì?',
    answer: 'A',
    created_at: '2026-08-19T08:00:00.000Z',
  },
  {
    id: 'b',
    conversationId: 'c1',
    question: 'Khoản 2 thì sao?',
    answer: 'B',
    created_at: '2026-08-19T08:01:00.000Z',
  },
  {
    id: 'c',
    conversationId: 'c2',
    question: 'Nghị định khác',
    answer: 'C',
    created_at: '2026-08-19T10:00:00.000Z',
  },
])
assert.equal(threads.length, 2)
assert.equal(threads.find((t) => t.conversationId === 'c1').turnCount, 2)
const restored = threadToMessages(threads.find((t) => t.conversationId === 'c1'))
assert.equal(restored.length, 4)
assert.equal(restored[0].role, 'user')
assert.equal(restored[2].content, 'Khoản 2 thì sao?')

const deduped = groupHistoryIntoThreads([
  {
    id: 'local-1',
    conversationId: 'c9',
    question: 'Điều 5 nói gì?',
    answer: 'A',
    from: 'local',
    created_at: '2026-08-19T08:00:00.000Z',
  },
  {
    id: 'server-1',
    question: 'Điều 5 nói gì?',
    answer: 'A',
    from: 'server',
    created_at: '2026-08-19T08:00:01.000Z',
  },
])
assert.equal(deduped.length, 1)
assert.equal(deduped[0].turnCount, 1)

function memoryStore() {
  const m = new Map()
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => {
      m.set(k, String(v))
    },
    removeItem: (k) => {
      m.delete(k)
    },
  }
}

const sessionMem = memoryStore()
const localMem = memoryStore()
globalThis.sessionStorage = sessionMem
globalThis.localStorage = localMem
localMem.setItem('rag_user_session', 'old-shared-device')
localMem.setItem('hcc_chat_history_v1', '{"items":[{"id":"leak"}]}')

const { getSessionId, startFreshSession, purgeLegacyDeviceHistory } = await import('../src/lib/session.js')

purgeLegacyDeviceHistory()
assert.equal(localMem.getItem('rag_user_session'), null)
assert.equal(localMem.getItem('hcc_chat_history_v1'), null)

const a = getSessionId()
assert.ok(a && a !== 'anonymous' && a !== 'old-shared-device')
const fresh = startFreshSession()
assert.notEqual(fresh.sessionId, a)
assert.equal(localMem.getItem('rag_user_session'), null)

console.log('✓ extractSourceChips')
console.log('✓ conversationHistoryFromMessages')
console.log('✓ groupHistoryIntoThreads')
console.log('✓ session is tab-only; legacy localStorage history is purged')
