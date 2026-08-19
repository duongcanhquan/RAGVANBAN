/**
 * TTS nói dần khi SSE đang chảy — không đợi hết bài.
 */

function stripMarkdownForSpeech(raw) {
  return String(raw || '')
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/https?:\/\/\S+/gi, ' ')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/\*([^*]+)\*/g, '$1')
    .replace(/^\s*[-*•]\s+/gm, '')
    .replace(/\s+/g, ' ')
    .trim()
}

function shouldSkipChunk(text) {
  const t = String(text || '').trim()
  if (t.length < 2) return true
  if (/^nguồn\s*:/i.test(t)) return true
  if (/^kiểm chứng\s*:/i.test(t)) return true
  return false
}

export function extractSpeakable(buffer, options = {}) {
  const minFlush = Number(options.minFlush) || 42
  const hardFlush = Number(options.hardFlush) || 88
  let rest = String(buffer || '')
  const spoken = []
  const sentenceRe = /^([\s\S]*?[.!?…。]\s+)/

  while (rest.length) {
    const m = rest.match(sentenceRe)
    if (m && m[1].trim().length >= 8) {
      spoken.push(m[1])
      rest = rest.slice(m[1].length)
      continue
    }
    if (rest.length >= hardFlush) {
      const cut = rest.lastIndexOf(' ', hardFlush)
      const idx = cut >= minFlush ? cut + 1 : hardFlush
      spoken.push(rest.slice(0, idx))
      rest = rest.slice(idx)
      continue
    }
    if (rest.length >= minFlush) {
      const comma = rest.search(/[,;，、]\s/)
      if (comma >= 24 && comma <= rest.length - 8) {
        const idx = comma + 1
        spoken.push(rest.slice(0, idx))
        rest = rest.slice(idx)
        continue
      }
    }
    break
  }

  return {
    spoken: spoken.map(stripMarkdownForSpeech).filter((t) => !shouldSkipChunk(t)),
    rest,
  }
}

export function pickVoice(lang, voices) {
  const want = String(lang || 'vi-VN').toLowerCase()
  const list = Array.isArray(voices) ? voices : window.speechSynthesis?.getVoices?.() || []
  const vi = list.filter((v) => /vi/i.test(v.lang || ''))
  return (
    vi.find((v) => String(v.lang || '').toLowerCase() === want) ||
    vi.find((v) => v.localService) ||
    vi[0] ||
    list.find((v) => String(v.lang || '').toLowerCase().startsWith(want.slice(0, 2))) ||
    null
  )
}

/** Chrome/Safari: TTS cần cử chỉ người dùng; gọi khi bấm gửi / mic. */
export function unlockSpeech() {
  if (typeof window === 'undefined' || !window.speechSynthesis) return false
  try {
    window.speechSynthesis.resume()
    const warm = window.speechSynthesis.getVoices()
    if (!warm?.length) {
      window.speechSynthesis.addEventListener?.('voiceschanged', () => window.speechSynthesis.getVoices(), {
        once: true,
      })
    }
    const u = new SpeechSynthesisUtterance(' ')
    u.volume = 0
    u.rate = 5
    u.lang = 'vi-VN'
    window.speechSynthesis.speak(u)
    return true
  } catch {
    return false
  }
}

export function createSpeakAhead({ lang = 'vi-VN', rate = 1.05 } = {}) {
  let buf = ''
  let queue = []
  let speaking = false
  let cancelled = false
  let resumeTimer = null

  function stopResumeWatch() {
    if (resumeTimer) {
      clearInterval(resumeTimer)
      resumeTimer = null
    }
  }

  function startResumeWatch() {
    stopResumeWatch()
    resumeTimer = setInterval(() => {
      try {
        window.speechSynthesis?.resume()
      } catch {
        // ignore
      }
    }, 8000)
  }

  function speakUtterance(text) {
    if (cancelled || !window.speechSynthesis) {
      speaking = false
      return
    }
    const u = new SpeechSynthesisUtterance(text)
    u.lang = lang
    u.rate = rate
    const voice = pickVoice(lang)
    if (voice) u.voice = voice
    speaking = true
    startResumeWatch()
    u.onend = () => {
      speaking = false
      if (!queue.length) stopResumeWatch()
      pump()
    }
    u.onerror = () => {
      speaking = false
      pump()
    }
    window.speechSynthesis.speak(u)
  }

  function pump() {
    if (cancelled || speaking || !queue.length) return
    if (!window.speechSynthesis) return
    const text = queue.shift()
    speaking = true
    try {
      window.speechSynthesis.resume()
    } catch {
      // ignore
    }
    const start = () => {
      if (cancelled) {
        speaking = false
        return
      }
      speakUtterance(text)
    }
    if (window.speechSynthesis.speaking) {
      setTimeout(start, 80)
      return
    }
    start()
  }

  function enqueue(text) {
    if (!text || cancelled) return
    queue.push(text)
    pump()
  }

  return {
    supported: typeof window !== 'undefined' && 'speechSynthesis' in window,
    push(token) {
      if (cancelled) return
      buf += token
      const { spoken, rest } = extractSpeakable(buf)
      buf = rest
      spoken.forEach(enqueue)
    },
    flush() {
      const leftover = stripMarkdownForSpeech(buf)
      buf = ''
      if (!shouldSkipChunk(leftover)) enqueue(leftover)
    },
    cancel() {
      cancelled = true
      buf = ''
      queue = []
      speaking = false
      stopResumeWatch()
      try {
        window.speechSynthesis?.cancel()
      } catch {
        // ignore
      }
    },
  }
}

export { stripMarkdownForSpeech }
