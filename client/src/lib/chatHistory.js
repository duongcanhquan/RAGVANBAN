import { purgeLegacyDeviceHistory } from './session'

const KEY = 'hcc_chat_history_v1'
const MAX_ITEMS = 24

function store() {
  try {
    return sessionStorage
  } catch {
    return null
  }
}

function readItems() {
  try {
    purgeLegacyDeviceHistory()
    const raw = JSON.parse(store()?.getItem(KEY) || '{"items":[]}')
    return Array.isArray(raw.items) ? raw.items : []
  } catch {
    return []
  }
}

function writeItems(items) {
  try {
    store()?.setItem(KEY, JSON.stringify({ items: items.slice(0, MAX_ITEMS) }))
    return true
  } catch {
    return false
  }
}

/** Chỉ lịch sử tab/phiên hiện tại — không đọc server, không chia máy. */
export function loadLocalHistory(sessionId) {
  const items = readItems()
  if (!sessionId) return items
  return items.filter((i) => i.sessionId === sessionId)
}

export function saveLocalTurn({ sessionId, conversationId, question, answer, sources = [], id }) {
  try {
    const items = readItems()
    const entry = {
      id: id || crypto.randomUUID(),
      sessionId: sessionId || 'anonymous',
      conversationId: conversationId || '',
      question,
      answer,
      sources,
      created_at: new Date().toISOString(),
      marked_knowledge: false,
    }
    items.unshift(entry)
    writeItems(items)
    return entry
  } catch {
    return null
  }
}

export function clearSessionHistory() {
  try {
    store()?.removeItem(KEY)
    purgeLegacyDeviceHistory()
    return true
  } catch {
    return false
  }
}

export function markLocalKnowledge(id, marked = true) {
  try {
    const next = readItems().map((i) => (i.id === id ? { ...i, marked_knowledge: marked } : i))
    writeItems(next)
    return true
  } catch {
    return false
  }
}

/** Chỉ quản trị — UI hỏi đáp công khai không gọi. */
export async function fetchServerHistory(sessionId) {
  try {
    const { adminFetch } = await import('./adminApi')
    const qs = new URLSearchParams({ limit: '40' })
    if (sessionId) qs.set('sessionId', sessionId)
    const res = await adminFetch(`/api/history?${qs}`)
    if (!res.ok) return []
    const data = await res.json()
    return data.items || []
  } catch {
    return []
  }
}

export async function promoteToScenario(log) {
  const { adminFetch } = await import('./adminApi')
  const res = await adminFetch('/api/scenarios', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      title: String(log.question || '').slice(0, 120),
      situation: `Từ lịch sử chat: ${log.question}`,
      suggested_question: log.question,
      sample_answer: log.answer || '',
      tags: ['từ-chat'],
    }),
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data.error || 'Không lưu được tình huống')
  return data
}
