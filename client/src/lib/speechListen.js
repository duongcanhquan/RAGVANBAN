/**
 * Nhận giọng nói (Web Speech API) — tiếng Việt.
 * rec.start() phải chạy ngay trong lần bấm (cùng user gesture), không await getUserMedia trước.
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
      return 'Chưa nghe thấy giọng. Nói gần mic hơn, rồi bấm Dừng khi xong.'
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

export function joinListenParts(kept, sessionFinal, interim) {
  return [kept, sessionFinal, interim]
    .map((s) => String(s || '').trim())
    .filter(Boolean)
    .join(' ')
}

export function shouldCommitListen(text) {
  return String(text || '').trim().length >= 3
}

/** no-speech / network: tiếp tục nghe; not-allowed: dừng. */
export function isRetryableListenError(code) {
  const c = String(code || '')
  return c === 'no-speech' || c === 'network' || c === 'aborted'
}

function RecognitionCtor() {
  if (typeof window === 'undefined') return null
  return window.SpeechRecognition || window.webkitSpeechRecognition || null
}

function preferContinuous() {
  if (typeof navigator === 'undefined') return true
  return !/Android|iPhone|iPad|iPod/i.test(navigator.userAgent || '')
}

function makeRec(Ctor, lang) {
  const rec = new Ctor()
  rec.lang = lang || 'vi-VN'
  rec.interimResults = true
  rec.continuous = preferContinuous()
  rec.maxAlternatives = 1
  return rec
}

export function startSpeechListen({
  lang = 'vi-VN',
  onText,
  onReady,
  onEnd,
  onError,
  onStart,
  silenceMs = 2400,
} = {}) {
  const Ctor = RecognitionCtor()
  if (!Ctor) {
    onError?.(new Error('Trình duyệt chưa hỗ trợ nhận giọng nói. Dùng Chrome hoặc Edge (HTTPS).'))
    return { stop() {}, abort() {}, snapshot: () => '' }
  }
  if (window.isSecureContext === false) {
    onError?.(new Error('Mic chỉ hoạt động trên HTTPS hoặc localhost.'))
    return { stop() {}, abort() {}, snapshot: () => '' }
  }

  let rec = makeRec(Ctor, lang)
  let stopped = false
  let committed = false
  let started = false
  let restartTimer = null
  let startWatch = null
  let keptFinals = ''
  let sessionFinal = ''
  let lastInterim = ''
  let lastDisplay = ''
  let silenceTimer = null
  let networkFails = 0
  let langTriedFallback = false

  function clearSilence() {
    if (silenceTimer) {
      clearTimeout(silenceTimer)
      silenceTimer = null
    }
  }

  function clearRestart() {
    if (restartTimer) {
      clearTimeout(restartTimer)
      restartTimer = null
    }
  }

  function clearStartWatch() {
    if (startWatch) {
      clearTimeout(startWatch)
      startWatch = null
    }
  }

  function haltRec() {
    try {
      rec.stop()
    } catch {
      /* ignore */
    }
  }

  function displayNow(interim = lastInterim) {
    return joinListenParts(keptFinals, sessionFinal, interim)
  }

  function publish(interim = lastInterim) {
    lastDisplay = displayNow(interim)
    if (lastDisplay) onText?.(lastDisplay, Boolean(keptFinals || sessionFinal))
    return lastDisplay
  }

  function snapshotText() {
    return String(displayNow() || lastDisplay || '').trim()
  }

  function closeOut() {
    clearSilence()
    clearRestart()
    clearStartWatch()
    haltRec()
  }

  function commit(text) {
    const t = String(text || snapshotText()).trim()
    if (committed) return
    if (!shouldCommitListen(t)) return
    committed = true
    stopped = true
    closeOut()
    onReady?.(t)
    onEnd?.()
  }

  function armSilence() {
    clearSilence()
    silenceTimer = setTimeout(() => {
      const t = snapshotText()
      if (shouldCommitListen(t)) commit(t)
    }, silenceMs)
  }

  function bind(instance) {
    instance.onstart = () => {
      if (stopped || committed) return
      started = true
      clearStartWatch()
      onStart?.()
    }

    instance.onresult = (e) => {
      if (stopped || committed) return
      networkFails = 0
      const merged = mergeListenTranscript(e.results, e.resultIndex)
      sessionFinal = merged.finalText
      lastInterim = merged.interim
      publish(merged.interim)
      armSilence()
    }

    instance.onerror = (e) => {
      const code = e.error || ''
      if (stopped || committed) return
      if (code === 'no-speech') {
        if (shouldCommitListen(snapshotText())) armSilence()
        return
      }
      if (code === 'aborted') return
      if (code === 'network') {
        networkFails += 1
        if (networkFails < 3) return
      }
      if (code === 'language-not-supported' && !langTriedFallback) {
        langTriedFallback = true
        rec.lang = 'vi'
        return
      }
      stopped = true
      closeOut()
      const msg = speechErrorMessage(code)
      if (msg) onError?.(new Error(msg))
      onEnd?.()
    }

    instance.onend = () => {
      if (sessionFinal || lastInterim) {
        keptFinals = joinListenParts(keptFinals, sessionFinal, lastInterim)
        sessionFinal = ''
        lastInterim = ''
        lastDisplay = keptFinals
        if (keptFinals) onText?.(keptFinals, true)
      }
      if (stopped || committed) return
      scheduleRestart()
    }
  }

  function scheduleRestart() {
    if (stopped || committed) return
    clearRestart()
    restartTimer = setTimeout(() => {
      if (stopped || committed) return
      rec = makeRec(Ctor, langTriedFallback ? 'vi' : lang)
      bind(rec)
      try {
        rec.start()
      } catch {
        setTimeout(() => {
          if (stopped || committed) return
          try {
            rec.start()
          } catch {
            if (shouldCommitListen(snapshotText())) commit(snapshotText())
            else {
              stopped = true
              closeOut()
              onEnd?.()
            }
          }
        }, 220)
      }
    }, 180)
  }

  bind(rec)

  startWatch = setTimeout(() => {
    if (started || stopped || committed) return
    stopped = true
    closeOut()
    onError?.(
      new Error('Không bật được nhận giọng. Dùng Chrome hoặc Edge, cho phép micro, rồi bấm mic lại.')
    )
    onEnd?.()
  }, 20000)

  try {
    rec.start()
  } catch (err) {
    const msg = speechErrorMessage(err?.message) || err?.message || 'Không bật được mic'
    closeOut()
    onError?.(new Error(msg))
    onEnd?.()
    return { stop() {}, abort() {}, snapshot: () => '' }
  }

  return {
    /** Dừng thu, giữ câu trong ô — không gửi. */
    stop() {
      stopped = true
      committed = true
      const t = snapshotText()
      closeOut()
      if (t) onText?.(t, true)
      else onError?.(new Error('Chưa nghe thấy câu nói. Bấm mic, nói rõ, rồi bấm Dừng hoặc Gửi.'))
      onEnd?.()
    },
    /** Dừng thu, không báo lỗi — caller tự gửi hoặc hủy. */
    abort() {
      stopped = true
      committed = true
      const t = snapshotText()
      closeOut()
      if (t) onText?.(t, true)
      onEnd?.()
    },
    snapshot() {
      return snapshotText()
    },
    started() {
      return started
    },
  }
}
