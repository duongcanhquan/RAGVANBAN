/**
 * Phiên hỏi đáp chỉ sống trong tab đang mở (sessionStorage).
 * Đóng tab / Kết thúc phiên = hết lịch sử trên máy — người sau không xem được.
 */
const KEY = 'rag_user_session'
const CONV_KEY = 'rag_conversation_id'
const LEGACY_LOCAL = ['rag_user_session', 'rag_conversation_id', 'hcc_chat_history_v1']

function store() {
  try {
    return sessionStorage
  } catch {
    return null
  }
}

export function purgeLegacyDeviceHistory() {
  try {
    for (const k of LEGACY_LOCAL) localStorage.removeItem(k)
  } catch {
    /* ignore */
  }
}

export function getSessionId() {
  const s = store()
  if (!s) return 'anonymous'
  try {
    purgeLegacyDeviceHistory()
    let id = s.getItem(KEY)
    if (!id) {
      id = crypto.randomUUID()
      s.setItem(KEY, id)
    }
    return id
  } catch {
    return 'anonymous'
  }
}

export function getConversationId() {
  const s = store()
  if (!s) return `c-${Date.now()}`
  try {
    let id = s.getItem(CONV_KEY)
    if (!id) {
      id = crypto.randomUUID()
      s.setItem(CONV_KEY, id)
    }
    return id
  } catch {
    return `c-${Date.now()}`
  }
}

export function rememberConversationId(id) {
  const next = String(id || '').trim() || crypto.randomUUID()
  const s = store()
  try {
    s?.setItem(CONV_KEY, next)
  } catch {
    /* ignore */
  }
  return next
}

export function newConversationId() {
  return rememberConversationId(crypto.randomUUID())
}

/** Xóa phiên trên máy, cấp id mới — dùng khi bấm Kết thúc phiên. */
export function startFreshSession() {
  const s = store()
  try {
    s?.removeItem(KEY)
    s?.removeItem(CONV_KEY)
  } catch {
    /* ignore */
  }
  purgeLegacyDeviceHistory()
  return {
    sessionId: getSessionId(),
    conversationId: getConversationId(),
  }
}
