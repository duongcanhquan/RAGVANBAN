/**
 * Session id ổn định trong tab trình duyệt (gắn user_session trên chat_logs).
 * conversationId đổi khi bấm Chat mới — gom lịch sử thành từng đoạn.
 */
const KEY = 'rag_user_session'
const CONV_KEY = 'rag_conversation_id'

export function getSessionId() {
  try {
    let id = localStorage.getItem(KEY)
    if (!id) {
      id = crypto.randomUUID()
      localStorage.setItem(KEY, id)
    }
    return id
  } catch {
    return 'anonymous'
  }
}

export function getConversationId() {
  try {
    let id = localStorage.getItem(CONV_KEY)
    if (!id) {
      id = crypto.randomUUID()
      localStorage.setItem(CONV_KEY, id)
    }
    return id
  } catch {
    return `c-${Date.now()}`
  }
}

export function newConversationId() {
  return rememberConversationId(crypto.randomUUID())
}

export function rememberConversationId(id) {
  const next = String(id || '').trim() || crypto.randomUUID()
  try {
    localStorage.setItem(CONV_KEY, next)
  } catch {
    // ignore
  }
  return next
}
