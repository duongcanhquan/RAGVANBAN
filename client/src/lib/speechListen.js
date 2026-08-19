/**
 * Nhận giọng nói (Web Speech API) — tiếng Việt.
 * Gom cả các đoạn final trước đó; không ghi đè input bằng mảnh sau.
 */

export function speechRecognitionSupported() {
  if (typeof window === 'undefined') return false
  if (window.isSecureContext === false) return false
  return Boolean(window.SpeechRecognition || window.webkitSpeechRecognition)
}

export function speechErrorMessage(code) {
  switch (String(code || '')) {
    case 'not-allowed':
    case 'service-not-allowed':
      return 'Chưa cho phép micro. Bấm biểu tượng khóa trên thanh địa chỉ → Cho phép micro.'
    case 'audio-capture':
      return 'Không thấy micro. Kiểm tra tai nghe hoặc micro USB.'
    case 'network':
      return 'Nhận giọng cần Chrome hoặc Edge và có mạng. Safari/Firefox thường không hỗ trợ.'
    case 'language-not-supported':
      return 'Trình duyệt chưa hỗ trợ tiếng Việt cho mic. Thử Chrome hoặc Edge.'
    case 'no-speech':
    case 'aborted':
      return ''
    default:
      return code ? `Không nghe được (${code}). Thử lại mic.` : 'Không nghe được. Thử lại mic.'
  }
}

function pieceOf(item) {
  return String(item?.[0]?.transcript || item?.transcript || '')
    .replace(/\s+/g, ' ')
    .trim()
}

/** Gom transcript từ SpeechRecognitionEvent.results (giống DOM). */
export function mergeListenTranscript(results, resultIndex = 0) {
  const list = Array.from(results || [])
  const finals = []
  const interims = []
  list.forEach((item, i) => {
    const piece = pieceOf(item)
    if (!piece) return
    if (item.isFinal) finals.push(piece)
    else if (i >= resultIndex) interims.push(piece)
  })
  const finalText = finals.join(' ').trim()
  const interim = interims.join(' ').trim()
  const display = [finalText, interim].filter(Boolean).join(' ')
  return { finalText, interim, display }
}

export function shouldCommitListen(text, isFinal) {
  if (!isFinal) return false
  return String(text || '').trim().length >= 12
}

export function startSpeechListen({
  lang = 'vi-VN',
  onText,
  onReady,
  onEnd,
  onError,
  silenceMs = 2000,
} = {}) {
  const Ctor = window.SpeechRecognition || window.webkitSpeechRecognition
  if (!Ctor) {
    onError?.(new Error('Trình duyệt chưa hỗ trợ nhận giọng nói. Dùng Chrome hoặc Edge (HTTPS).'))
    return { stop() {} }
  }
  if (typeof window !== 'undefined' && window.isSecureContext === false) {
    onError?.(new Error('Mic chỉ hoạt động trên HTTPS hoặc localhost.'))
    return { stop() {} }
  }

  const rec = new Ctor()
  rec.lang = lang
  rec.interimResults = true
  rec.continuous = true
  rec.maxAlternatives = 1

  let stopped = false
  let committed = false
  let lastDisplay = ''
  let lastFinal = ''
  let silenceTimer = null

  function clearSilence() {
    if (silenceTimer) {
      clearTimeout(silenceTimer)
      silenceTimer = null
    }
  }

  function commit(text, { fromStop } = {}) {
    const t = String(text || '').trim()
    if (committed) return
    if (!t) {
      if (fromStop) onEnd?.()
      return
    }
    if (!fromStop && !shouldCommitListen(t, true)) return
    if (fromStop && t.length < 3) {
      onEnd?.()
      return
    }
    committed = true
    stopped = true
    clearSilence()
    try {
      rec.stop()
    } catch {
      // ignore
    }
    onReady?.(t)
    onEnd?.()
  }

  rec.onresult = (e) => {
    const merged = mergeListenTranscript(e.results, e.resultIndex)
    lastFinal = merged.finalText
    lastDisplay = merged.display
    if (merged.display) onText?.(merged.display, Boolean(merged.finalText))
    clearSilence()
    if (merged.finalText) {
      silenceTimer = setTimeout(() => commit(lastFinal), silenceMs)
    }
  }

  rec.onerror = (e) => {
    const code = e.error || ''
    if (code === 'aborted' || code === 'no-speech') {
      if (code === 'no-speech' && lastDisplay && !stopped) return
      if (!stopped) onEnd?.()
      return
    }
    stopped = true
    clearSilence()
    const msg = speechErrorMessage(code)
    onError?.(new Error(msg || code))
    onEnd?.()
  }

  rec.onend = () => {
    if (stopped || committed) return
    try {
      rec.start()
    } catch {
      onEnd?.()
    }
  }

  try {
    rec.start()
  } catch (err) {
    const msg = speechErrorMessage(err?.message) || err?.message || 'Không bật được mic'
    onError?.(new Error(msg))
    onEnd?.()
  }

  return {
    stop() {
      stopped = true
      clearSilence()
      try {
        rec.stop()
      } catch {
        // ignore
      }
      commit(lastDisplay || lastFinal, { fromStop: true })
    },
    abort() {
      stopped = true
      committed = true
      clearSilence()
      try {
        rec.stop()
      } catch {
        // ignore
      }
      onEnd?.()
    },
  }
}
