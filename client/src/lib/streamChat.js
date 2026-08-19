/**
 * SSE client — ReadableStream từ POST /api/chat.
 * Dev: Vite proxy `/api` → http://localhost:5000 (tránh CORS).
 * Có thể override bằng VITE_API_BASE.
 */
import { apiUrl } from './apiBase'

export async function streamChat(message, handlers = {}) {
  const { onMeta, onToken, onDone, onError, signal, sessionId, mode, voiceTalk, history, categoryIds, documentIds } =
    handlers
  const url = apiUrl('/api/chat')

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'text/event-stream',
      ...(sessionId ? { 'X-Session-Id': sessionId } : {}),
    },
    body: JSON.stringify({
      message,
      sessionId,
      mode: mode || 'lookup',
      voiceTalk: Boolean(voiceTalk),
      history: Array.isArray(history) ? history.slice(-6) : [],
      categoryIds: Array.isArray(categoryIds) ? categoryIds.filter(Boolean).slice(0, 40) : [],
      documentIds: Array.isArray(documentIds) ? documentIds.filter(Boolean).slice(0, 20) : [],
    }),
    signal,
  })

  if (!response.ok) {
    const errText = await response.text().catch(() => '')
    let msg = errText || `HTTP ${response.status}`
    try {
      const parsed = JSON.parse(errText)
      if (parsed?.error) msg = parsed.error
    } catch {
      /* raw */
    }
    throw new Error(msg)
  }

  if (!response.body) {
    throw new Error('Trình duyệt không hỗ trợ ReadableStream')
  }

  const reader = response.body.getReader()
  const decoder = new TextDecoder('utf-8')
  let buffer = ''

  while (true) {
    const { done, value } = await reader.read()
    if (done) break

    buffer += decoder.decode(value, { stream: true })
    const parts = buffer.split('\n\n')
    buffer = parts.pop() || ''

    for (const part of parts) {
      dispatchSsePart(part, { onMeta, onToken, onDone, onError })
    }
  }

  // Flush phần còn lại (nếu server không kết thúc bằng \n\n)
  if (buffer.trim()) {
    dispatchSsePart(buffer, { onMeta, onToken, onDone, onError })
  }
}

function dispatchSsePart(part, { onMeta, onToken, onDone, onError }) {
  const lines = part.split('\n')
  let event = 'message'
  const dataLines = []

  for (const line of lines) {
    if (line.startsWith('event:')) event = line.slice(6).trim()
    else if (line.startsWith('data:')) dataLines.push(line.slice(5).trim())
  }

  if (!dataLines.length) return

  let data
  try {
    data = JSON.parse(dataLines.join('\n'))
  } catch {
    return
  }

  if (event === 'meta' && onMeta) onMeta(data)
  else if (event === 'token' && onToken) onToken(data.token || '')
  else if (event === 'done' && onDone) onDone(data)
  else if (event === 'error') {
    const err = new Error(data.message || 'Lỗi server')
    if (onError) onError(err)
    else throw err
  }
}
