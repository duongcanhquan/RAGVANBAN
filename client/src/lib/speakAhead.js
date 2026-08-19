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

function pickVoice(lang) {
  const want = String(lang || 'vi-VN').toLowerCase()
  const list = window.speechSynthesis?.getVoices?.() || []
  return (
    list.find((v) => v.lang?.toLowerCase() === want) ||
    list.find((v) => v.lang?.toLowerCase().startsWith(want.slice(0, 2))) ||
    list.find((v) => /vi/i.test(v.lang)) ||
    null
  )
}

export function createSpeakAhead({ lang = 'vi-VN', rate = 1.05 } = {}) {
  let buf = ''
  let queue = []
  let speaking = false
  let cancelled = false

  function pump() {
    if (cancelled || speaking || !queue.length) return
    if (!window.speechSynthesis) return
    const text = queue.shift()
    const u = new SpeechSynthesisUtterance(text)
    u.lang = lang
    u.rate = rate
    const voice = pickVoice(lang)
    if (voice) u.voice = voice
    speaking = true
    u.onend = () => {
      speaking = false
      pump()
    }
    u.onerror = () => {
      speaking = false
      pump()
    }
    window.speechSynthesis.speak(u)
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
      try {
        window.speechSynthesis?.cancel()
      } catch {
        // ignore
      }
    },
  }
}

export { stripMarkdownForSpeech }
