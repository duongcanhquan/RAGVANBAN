/**
 * Nhận giọng nói (Web Speech API) — tiếng Việt.
 */

export function speechRecognitionSupported() {
  return typeof window !== 'undefined' && Boolean(window.SpeechRecognition || window.webkitSpeechRecognition)
}

export function startSpeechListen({ lang = 'vi-VN', onText, onEnd, onError } = {}) {
  const Ctor = window.SpeechRecognition || window.webkitSpeechRecognition
  if (!Ctor) {
    onError?.(new Error('Trình duyệt chưa hỗ trợ nhận giọng nói'))
    return { stop() {} }
  }

  const rec = new Ctor()
  rec.lang = lang
  rec.interimResults = true
  rec.continuous = false
  rec.maxAlternatives = 1

  rec.onresult = (e) => {
    let finalText = ''
    let interim = ''
    for (let i = e.resultIndex; i < e.results.length; i += 1) {
      const piece = e.results[i][0]?.transcript || ''
      if (e.results[i].isFinal) finalText += piece
      else interim += piece
    }
    onText?.(finalText || interim, Boolean(finalText))
  }
  rec.onerror = (e) => {
    if (e.error === 'aborted' || e.error === 'no-speech') {
      onEnd?.()
      return
    }
    onError?.(new Error(e.error || 'Không nghe được'))
    onEnd?.()
  }
  rec.onend = () => onEnd?.()

  try {
    rec.start()
  } catch (err) {
    onError?.(err)
  }

  return {
    stop() {
      try {
        rec.stop()
      } catch {
        // ignore
      }
    },
  }
}
