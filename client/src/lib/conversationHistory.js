/**
 * Lượt chat đã xong — gửi kèm POST /api/chat để AI nhớ tình huống trong đoạn.
 * Gom lịch sử thành từng đoạn chat (không tách mỗi câu hỏi thành một mục).
 */
export function conversationHistoryFromMessages(messages, maxTurns = 12) {
  return (Array.isArray(messages) ? messages : [])
    .filter((m) => {
      if (m?.streaming) return false
      if (m?.role !== 'user' && m?.role !== 'assistant') return false
      return Boolean(String(m.content || '').trim())
    })
    .slice(-maxTurns)
    .map((m) => ({
      role: m.role,
      content: String(m.content).trim(),
    }))
}

export function threadToMessages(thread) {
  if (Array.isArray(thread?.messages) && thread.messages.length) {
    return thread.messages.map((m) => ({
      id: m.id || crypto.randomUUID(),
      role: m.role,
      content: String(m.content || ''),
      sources: m.sources || [],
      streaming: false,
      qaMode: m.qaMode,
    }))
  }
  const msgs = []
  const turns = Array.isArray(thread?.turns) ? thread.turns : []
  for (const t of turns) {
    if (t.question) {
      msgs.push({
        id: crypto.randomUUID(),
        role: 'user',
        content: String(t.question),
      })
    }
    if (t.answer) {
      msgs.push({
        id: crypto.randomUUID(),
        role: 'assistant',
        content: String(t.answer),
        sources: t.sources || t.citations_used || [],
        streaming: false,
      })
    }
  }
  if (!msgs.length && thread?.question) {
    msgs.push({
      id: crypto.randomUUID(),
      role: 'user',
      content: String(thread.question),
    })
    if (thread.answer) {
      msgs.push({
        id: crypto.randomUUID(),
        role: 'assistant',
        content: String(thread.answer),
        sources: thread.sources || [],
        streaming: false,
      })
    }
  }
  return msgs
}

function turnTime(it) {
  const t = Date.parse(it?.created_at || '')
  return Number.isFinite(t) ? t : 0
}

export function dedupeHistoryTurns(items, { windowMs = 120000 } = {}) {
  const list = [...(items || [])].sort(
    (a, b) => turnTime(a) - turnTime(b) || String(a.id).localeCompare(String(b.id))
  )
  const out = []
  for (const it of list) {
    const q = String(it.question || '').trim()
    const t = turnTime(it)
    const idx = out.findIndex(
      (x) => String(x.question || '').trim() === q && Math.abs(turnTime(x) - t) < windowMs
    )
    if (idx < 0) {
      out.push(it)
      continue
    }
    const prev = out[idx]
    const prefer =
      (!prev.conversationId && it.conversationId) ||
      (prev.from !== 'server' && it.from === 'local' && it.conversationId)
        ? it
        : prev
    out[idx] = prefer
  }
  return out
}

/**
 * Gom Q&A rời thành đoạn chat: theo conversationId, hoặc theo cụm thời gian (dữ liệu cũ).
 */
export function groupHistoryIntoThreads(items, { gapMs = 45 * 60 * 1000 } = {}) {
  const byConv = new Map()
  const orphans = []
  for (const it of dedupeHistoryTurns(items)) {
    const cid = String(it.conversationId || '').trim()
    if (cid) {
      if (!byConv.has(cid)) byConv.set(cid, [])
      byConv.get(cid).push(it)
    } else {
      orphans.push(it)
    }
  }

  orphans.sort((a, b) => turnTime(a) - turnTime(b) || String(a.id).localeCompare(String(b.id)))
  let bucket = []
  let lastAt = 0
  const flush = () => {
    if (!bucket.length) return
    const id = `gap-${bucket[0].id || bucket[0].created_at || bucket.length}`
    byConv.set(id, bucket)
    bucket = []
  }
  for (const it of orphans) {
    const t = turnTime(it)
    if (bucket.length && lastAt && t - lastAt > gapMs) flush()
    bucket.push(it)
    lastAt = t || lastAt
  }
  flush()

  const threads = []
  for (const [id, turnsRaw] of byConv) {
    const turns = [...turnsRaw].sort(
      (a, b) => turnTime(a) - turnTime(b) || String(a.id).localeCompare(String(b.id))
    )
    const first = turns[0]
    const last = turns[turns.length - 1]
    threads.push({
      id,
      conversationId: id,
      question: first.question,
      preview:
        turns.length > 1
          ? `${turns.length} lượt · ${String(last.question || first.question || '').slice(0, 80)}`
          : first.question,
      turnCount: turns.length,
      answer: last.answer,
      sources: last.sources || last.citations_used || [],
      created_at: last.created_at || first.created_at,
      turns,
    })
  }
  threads.sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || '')))
  return threads
}
