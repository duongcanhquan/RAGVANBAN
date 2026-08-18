/**
 * Session id ổn định trong tab trình duyệt (gắn user_session trên chat_logs).
 */
const KEY = 'rag_user_session'

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
