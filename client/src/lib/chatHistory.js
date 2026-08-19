import { apiUrl } from './apiBase'
import { adminFetch } from './adminApi'

const KEY = 'hcc_chat_history_v1'

/**
 * Lưu lịch sử chat trên thiết bị (luôn có) + đồng bộ server khi có Supabase.
 */

export function loadLocalHistory(sessionId) {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) || '{"items":[]}')
    const items = Array.isArray(raw.items) ? raw.items : []
    if (!sessionId) return items
    return items.filter((i) => i.sessionId === sessionId)
  } catch {
    return []
  }
}

export function saveLocalTurn({ sessionId, conversationId, question, answer, sources = [], id }) {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) || '{"items":[]}')
    const items = Array.isArray(raw.items) ? raw.items : []
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
    localStorage.setItem(KEY, JSON.stringify({ items: items.slice(0, 200) }))
    return entry
  } catch {
    return null
  }
}

export function markLocalKnowledge(id, marked = true) {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) || '{"items":[]}')
    const items = Array.isArray(raw.items) ? raw.items : []
    const next = items.map((i) =>
      i.id === id ? { ...i, marked_knowledge: marked } : i
    )
    localStorage.setItem(KEY, JSON.stringify({ items: next }))
    return true
  } catch {
    return false
  }
}

export async function fetchServerHistory(sessionId) {
  try {
    const qs = new URLSearchParams({ limit: '40' })
    if (sessionId) qs.set('sessionId', sessionId)
    const res = await fetch(apiUrl(`/api/history?${qs}`))
    if (!res.ok) return []
    const data = await res.json()
    return data.items || []
  } catch {
    return []
  }
}

export async function promoteToScenario(log) {
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
