import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { History, LogOut, PanelRightClose, PanelRightOpen, Plus, Volume2, VolumeX } from 'lucide-react'
import ChatWindow from '../components/ChatWindow'
import ChatInput from '../components/ChatInput'
import CategoryScopePicker from '../components/CategoryScopePicker'
import MainSectionNav from '../components/MainSectionNav'
import ChatModeSwitcher from '../components/ChatModeSwitcher'
const HistoryPanel = lazy(() => import('../components/HistoryPanel'))
import WorkbenchPanel from '../components/WorkbenchPanel'
import { streamChat } from '../lib/streamChat'
import { getConversationId, getSessionId, newConversationId, rememberConversationId, startFreshSession } from '../lib/session'
import { clearSessionHistory, saveLocalTurn } from '../lib/chatHistory'
import {
  conversationHistoryFromMessages,
  threadToMessages,
} from '../lib/conversationHistory'
import { getMode } from '../lib/modes'
import { createSpeakAhead, unlockSpeech } from '../lib/speakAhead'
import { speechRecognitionSupported, startSpeechListen } from '../lib/speechListen'
import { apiUrl } from '../lib/apiBase'
import { cachedJson } from '../lib/apiCache'

/**
 * Workspace chuyên viên — desktop 2 cột rộng; mobile vẫn 1 cột.
 */
export default function ChatPage() {
  const [mode, setMode] = useState('lookup')
  const [messages, setMessages] = useState([])
  const [input, setInput] = useState('')
  const [streaming, setStreaming] = useState(false)
  const [statusText, setStatusText] = useState('')
  const [error, setError] = useState('')
  const [historyOpen, setHistoryOpen] = useState(false)
  const [sideOpen, setSideOpen] = useState(() => {
    if (typeof window === 'undefined') return false
    try {
      if (!window.matchMedia('(min-width: 1280px)').matches) return false
      return localStorage.getItem('hcc_side_open') !== '0'
    } catch {
      return false
    }
  })
  const [quickKeywords, setQuickKeywords] = useState([])
  const [talkCfg, setTalkCfg] = useState(null)
  const [disclaimer, setDisclaimer] = useState('')
  const [speakOn, setSpeakOn] = useState(true)
  const [listening, setListening] = useState(false)
  const [historyTick, setHistoryTick] = useState(0)
  const [categoryIds, setCategoryIds] = useState(() => {
    try {
      const raw = sessionStorage.getItem('hcc_chat_category_ids')
      const parsed = raw ? JSON.parse(raw) : []
      return Array.isArray(parsed) ? parsed.filter(Boolean).slice(0, 40) : []
    } catch {
      return []
    }
  })
  const abortRef = useRef(null)
  const inFlightRef = useRef(false)
  const speakRef = useRef(null)
  const listenRef = useRef(null)
  const transcriptRef = useRef('')
  const [sessionId, setSessionId] = useState(() => getSessionId())
  const [conversationId, setConversationId] = useState(() => getConversationId())
  const ttsSupported =
    typeof window !== 'undefined' && typeof window.speechSynthesis !== 'undefined'
  const location = useLocation()
  const navigate = useNavigate()
  const modeConfig = useMemo(() => getMode(mode), [mode])
  const chipExamples = useMemo(() => {
    return (quickKeywords || []).filter(
      (k) => !k.mode || k.mode === 'both' || k.mode === mode
    )
  }, [quickKeywords, mode])

  useEffect(() => {
    cachedJson(apiUrl('/api/settings/quick-keywords'))
      .then((d) => setQuickKeywords(d.items || []))
      .catch(() => {})
  }, [])

  useEffect(() => {
    cachedJson(apiUrl('/api/settings/rag'))
      .then((d) => {
        if (d?.disclaimer) setDisclaimer(d.disclaimer)
      })
      .catch(() => {})
  }, [])

  useEffect(() => {
    cachedJson(apiUrl('/api/settings/voice-talk'))
      .then((d) => {
        if (d?.enabled !== true) {
          setTalkCfg(null)
          setSpeakOn(false)
          speakRef.current?.cancel()
          listenRef.current?.abort?.()
          listenRef.current = null
          setListening(false)
          return
        }
        setTalkCfg(d)
        try {
          const saved = localStorage.getItem('hcc_speak_on')
          if (saved === '0') setSpeakOn(false)
          else setSpeakOn(d.autoSpeak !== false)
        } catch {
          setSpeakOn(d.autoSpeak !== false)
        }
      })
      .catch(() => {})
  }, [])

  useEffect(() => {
    return () => {
      speakRef.current?.cancel()
      listenRef.current?.abort?.()
    }
  }, [])

  useEffect(() => {
    if (!talkCfg?.enabled || typeof window === 'undefined' || !window.speechSynthesis) return
    window.speechSynthesis.getVoices()
    const warm = () => window.speechSynthesis.getVoices()
    window.speechSynthesis.addEventListener?.('voiceschanged', warm)
    return () => window.speechSynthesis.removeEventListener?.('voiceschanged', warm)
  }, [talkCfg])

  useEffect(() => {
    const prefill = location.state?.prefill
    const prefMode = location.state?.mode
    if (prefMode === 'advise' || prefMode === 'lookup') setMode(prefMode)
    if (prefill) {
      setInput(String(prefill))
      navigate(location.pathname, { replace: true, state: {} })
    }
  }, [location, navigate])

  useEffect(() => {
    function onHide(e) {
      if (e.persisted) return
      clearSessionHistory()
    }
    window.addEventListener('pagehide', onHide)
    return () => window.removeEventListener('pagehide', onHide)
  }, [])

  useEffect(() => {
    const root = document.documentElement
    if (sideOpen) root.classList.add('workbench-open')
    else root.classList.remove('workbench-open')
    return () => root.classList.remove('workbench-open')
  }, [sideOpen])

  function toggleSide() {
    setSideOpen((v) => {
      const next = !v
      try {
        localStorage.setItem('hcc_side_open', next ? '1' : '0')
      } catch {
        // ignore
      }
      return next
    })
  }

  function setCategoryScope(ids) {
    const next = Array.isArray(ids) ? ids.filter(Boolean).slice(0, 40) : []
    setCategoryIds(next)
    try {
      sessionStorage.setItem('hcc_chat_category_ids', JSON.stringify(next))
    } catch {
      /* ignore */
    }
  }

  function stopGeneration() {
    abortRef.current?.abort()
    speakRef.current?.cancel()
  }

  function newChat() {
    stopGeneration()
    inFlightRef.current = false
    speakRef.current?.cancel()
    listenRef.current?.abort?.()
    listenRef.current = null
    setListening(false)
    setStreaming(false)
    setConversationId(newConversationId())
    setMessages([])
    transcriptRef.current = ''
    setInput('')
    setError('')
    setStatusText('')
  }

  function endSession() {
    const ok =
      typeof window === 'undefined' ||
      window.confirm(
        'Kết thúc phiên? Lịch sử hỏi đáp trên máy này sẽ bị xóa. Người sau không xem được.'
      )
    if (!ok) return
    stopGeneration()
    inFlightRef.current = false
    speakRef.current?.cancel()
    listenRef.current?.abort?.()
    listenRef.current = null
    setListening(false)
    setStreaming(false)
    clearSessionHistory()
    try {
      sessionStorage.removeItem('hcc_chat_category_ids')
    } catch {
      /* ignore */
    }
    const next = startFreshSession()
    setSessionId(next.sessionId)
    setConversationId(next.conversationId)
    setCategoryIds([])
    setMessages([])
    transcriptRef.current = ''
    setInput('')
    setError('')
    setStatusText('')
    setHistoryTick((n) => n + 1)
    setHistoryOpen(false)
  }

  function toggleSpeak() {
    const next = !speakOn
    try {
      localStorage.setItem('hcc_speak_on', next ? '1' : '0')
    } catch {
      // ignore
    }
    setSpeakOn(next)
    if (next) unlockSpeech()
    else speakRef.current?.cancel()
  }

  function handleMic() {
    if (talkCfg?.enabled !== true) return
    speakRef.current?.cancel()
    if (listening) {
      stopListening({ send: false })
      return
    }
    unlockSpeech()
    try {
      window.speechSynthesis?.cancel()
    } catch {
      /* ignore */
    }
    if (!speechRecognitionSupported()) {
      setError(
        typeof window !== 'undefined' && window.isSecureContext === false
          ? 'Mic chỉ hoạt động trên HTTPS hoặc localhost. Dùng Chrome/Edge.'
          : 'Trình duyệt chưa hỗ trợ mic. Dùng Chrome hoặc Edge và cho phép micro.'
      )
      return
    }
    setError('')
    transcriptRef.current = ''
    setInput('')
    setListening(true)
    listenRef.current = startSpeechListen({
      lang: talkCfg.lang || 'vi-VN',
      onText: (text) => {
        const next = String(text || '')
        transcriptRef.current = next
        if (next) setInput(next)
      },
      onReady: (text) => {
        listenRef.current = null
        setListening(false)
        const q = String(text || transcriptRef.current || '').trim()
        if (q) sendMessage(q)
      },
      onEnd: () => setListening(false),
      onError: (err) => {
        setListening(false)
        if (err.message) setError(err.message)
      },
    })
  }

  function stopListening({ send = false } = {}) {
    const rec = listenRef.current
    listenRef.current = null
    const q = String(rec?.snapshot?.() || transcriptRef.current || input || '').trim()
    if (!rec) {
      setListening(false)
      if (send && q) sendMessage(q)
      return
    }
    if (send) {
      rec.abort()
      setListening(false)
      if (q) sendMessage(q)
      else setError('Chưa nghe thấy câu nói. Bấm mic, nói, rồi Gửi.')
      return
    }
    rec.stop()
  }

  useEffect(() => {
    if (mode !== 'lookup') return
    setSideOpen((open) => {
      if (open) return open
      if (typeof window === 'undefined') return open
      try {
        if (!window.matchMedia('(min-width: 1280px)').matches) return open
        return localStorage.getItem('hcc_side_open') !== '0'
      } catch {
        return open
      }
    })
  }, [mode])

  async function submitFeedback(logId, rating) {
    if (!logId || !rating) return
    try {
      const res = await fetch(apiUrl('/api/chat/feedback'), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(sessionId ? { 'X-Session-Id': sessionId } : {}),
        },
        body: JSON.stringify({ logId, rating, sessionId }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || 'Không gửi được phản hồi')
      setMessages((prev) =>
        prev.map((m) => (m.logId === logId ? { ...m, feedback: rating } : m))
      )
    } catch (e) {
      setError(e.message)
    }
  }

  function restoreFromHistory(item) {
    if (inFlightRef.current || streaming) stopGeneration()
    inFlightRef.current = false
    setStreaming(false)
    const cid = String(item?.conversationId || item?.id || '').trim()
    setConversationId(cid ? rememberConversationId(cid) : newConversationId())
    const restored = threadToMessages(item)
    if (restored.length) {
      setMessages(restored)
      return
    }
    setMessages([
      { id: crypto.randomUUID(), role: 'user', content: item.question || '' },
      {
        id: crypto.randomUUID(),
        role: 'assistant',
        content: item.answer || '',
        sources: item.sources || item.citations_used || [],
        streaming: false,
        confidence: {
          level: (item.sources || item.citations_used || []).length ? 'medium' : 'low',
          label: (item.sources || item.citations_used || []).length
            ? 'Có căn cứ pháp lý'
            : 'Chưa có căn cứ trong kho',
          sources: (item.sources || item.citations_used || []).length,
        },
      },
    ])
  }

  async function sendMessage(text, opts = {}) {
    const question = String(text || '').trim()
    if (!question || inFlightRef.current) return
    inFlightRef.current = true
    const qaMode = opts.mode === 'advise' || opts.mode === 'lookup' ? opts.mode : mode
    if (opts.mode === 'advise' || opts.mode === 'lookup') setMode(opts.mode)

    listenRef.current?.abort?.()
    listenRef.current = null
    setListening(false)
    unlockSpeech()

    setError('')
    transcriptRef.current = ''
    setInput('')
    setStreaming(true)
    setStatusText('Đang tiếp nhận câu hỏi…')

    const history = conversationHistoryFromMessages(messages, 6)
    const scopedCategoryIds = opts.categoryIds ?? categoryIds
    const scopedDocumentIds = opts.documentIds || []
    const userMsg = { id: crypto.randomUUID(), role: 'user', content: question }
    const assistantId = crypto.randomUUID()

    setMessages((prev) => [
      ...prev,
      userMsg,
      {
        id: assistantId,
        role: 'assistant',
        content: '',
        sources: [],
        streaming: true,
        qaMode,
      },
    ])

    const controller = new AbortController()
    abortRef.current = controller

    speakRef.current?.cancel()
    const voiceOn = talkCfg?.enabled === true
    const speaker =
      voiceOn && speakOn && ttsSupported
        ? createSpeakAhead({ lang: talkCfg.lang || 'vi-VN', rate: talkCfg.rate || 1.05 })
        : null
    speakRef.current = speaker

    try {
      await streamChat(question, {
        signal: controller.signal,
        sessionId,
        mode: qaMode,
        history,
        categoryIds: scopedCategoryIds,
        documentIds: scopedDocumentIds,
        voiceTalk: Boolean(talkCfg?.enabled === true && speakOn),
        onMeta: (meta) => {
          if (meta.status) setStatusText(meta.status)
          setMessages((prev) =>
            prev.map((m) =>
              m.id === assistantId
                ? {
                    ...m,
                    sources: meta.sources || m.sources || [],
                    intent: meta.intent || m.intent,
                    confidence: meta.confidence || m.confidence,
                    qaMode: meta.qaMode || m.qaMode,
                  }
                : m
            )
          )
        },
        onToken: (token) => {
          setStatusText('')
          speaker?.push(token)
          setMessages((prev) =>
            prev.map((m) =>
              m.id === assistantId ? { ...m, content: (m.content || '') + token } : m
            )
          )
        },
        onDone: (data) => {
          speaker?.flush()
          const answer = data.answer || ''
          const sources = data.sources || []
          setStatusText('')
          setMessages((prev) =>
            prev.map((m) =>
              m.id === assistantId
                ? {
                    ...m,
                    content: answer || m.content,
                    sources: sources.length ? sources : m.sources || [],
                    confidence: data.confidence || m.confidence,
                    qaMode: data.qaMode || m.qaMode,
                    logId: data.logId || m.logId,
                    streaming: false,
                  }
                : m
            )
          )
          saveLocalTurn({
            sessionId,
            conversationId,
            question,
            answer: answer || '',
            sources,
          })
          setHistoryTick((n) => n + 1)
        },
        onError: (err) => setError(err.message),
      })
    } catch (err) {
      if (err.name !== 'AbortError') {
        setError(err.message || 'Không gửi được câu hỏi')
        setMessages((prev) =>
          prev.map((m) =>
            m.id === assistantId
              ? {
                  ...m,
                  content:
                    m.content ||
                    'Xin lỗi, đã xảy ra lỗi khi kết nối máy chủ. Kiểm tra backend port 5000.',
                  streaming: false,
                }
              : m
          )
        )
      }
    } finally {
      inFlightRef.current = false
      setStreaming(false)
      setStatusText('')
      setMessages((prev) =>
        prev.map((m) => (m.id === assistantId ? { ...m, streaming: false } : m))
      )
      abortRef.current = null
    }
  }

  const shellH = 'h-full min-h-0'

  return (
    <div className={`${shellH} flex w-full overflow-hidden`}>
      {/* Cột chính: hỏi đáp */}
      <section className="flex min-h-0 min-w-0 flex-1 flex-col bg-transparent">
        <div className="flex shrink-0 flex-col border-b border-white/10 bg-black/20 backdrop-blur-md">
          <div className="flex flex-row items-center justify-between gap-1.5 px-3 py-1.5 sm:px-4 xl:px-6">
            <div className="hidden min-w-0 flex-1 items-center lg:flex">
              <MainSectionNav />
            </div>

            <div className="flex min-w-0 flex-1 items-center justify-end gap-0.5 lg:flex-none">
            {talkCfg?.enabled === true ? (
              <button
                type="button"
                onClick={toggleSpeak}
                className="inline-flex min-h-11 min-w-11 cursor-pointer items-center justify-center gap-1 rounded-xl px-2.5 text-xs font-medium text-white/60 hover:bg-white/10 hover:text-white sm:min-h-9"
                aria-pressed={speakOn}
                aria-label={speakOn ? 'Tắt đọc' : 'Bật đọc'}
                title={
                  !ttsSupported
                    ? 'Trình duyệt không hỗ trợ đọc thoại'
                    : speakOn
                      ? 'Tắt đọc câu trả lời'
                      : 'Bật đọc ngay khi AI viết'
                }
              >
                {speakOn && ttsSupported ? <Volume2 className="h-4 w-4 text-emerald-300" /> : <VolumeX className="h-4 w-4" />}
                <span className="hidden md:inline">
                  {!ttsSupported ? 'Không TTS' : speakOn ? 'Đang nói' : 'Im lặng'}
                </span>
              </button>
            ) : null}
            <button
              type="button"
              onClick={newChat}
              className="inline-flex min-h-9 min-w-9 cursor-pointer items-center justify-center gap-1 rounded-xl px-1.5 text-xs font-medium text-white/60 hover:bg-white/10 hover:text-white sm:min-h-9"
              aria-label="Chat mới"
            >
              <Plus className="h-4 w-4" />
              <span className="hidden sm:inline">Mới</span>
            </button>
            <button
              type="button"
              onClick={() => setHistoryOpen(true)}
              className="inline-flex min-h-9 min-w-9 cursor-pointer items-center justify-center gap-1 rounded-xl px-1.5 text-xs font-medium text-white/60 hover:bg-white/10 hover:text-white xl:hidden"
              aria-label="Lịch sử phiên này"
            >
              <History className="h-4 w-4" />
            </button>
            <button
              type="button"
              onClick={endSession}
              className="inline-flex min-h-9 min-w-9 cursor-pointer items-center justify-center gap-1 rounded-xl px-1.5 text-xs font-medium text-white/60 hover:bg-white/10 hover:text-white"
              title="Xóa lịch sử trên máy và bắt đầu phiên mới"
              aria-label="Hết phiên"
            >
              <LogOut className="h-4 w-4" />
              <span className="hidden sm:inline">Hết phiên</span>
            </button>
            <button
              type="button"
              onClick={toggleSide}
              className="hidden min-h-9 cursor-pointer items-center gap-1 rounded-xl px-2.5 text-xs font-medium text-white/60 hover:bg-white/10 hover:text-white xl:inline-flex"
              aria-pressed={sideOpen}
              title={sideOpen ? 'Ẩn bàn làm việc' : 'Hiện bàn làm việc'}
            >
              {sideOpen ? (
                <PanelRightClose className="h-4 w-4" />
              ) : (
                <PanelRightOpen className="h-4 w-4" />
              )}
              {sideOpen ? 'Thu panel' : 'Bàn việc'}
            </button>
          </div>
          </div>

          <div className="flex flex-row items-center justify-between gap-2 border-t border-white/5 px-3 py-2 sm:px-4 xl:px-6">
            {disclaimer ? (
              <p className="m-0 hidden max-w-xl truncate text-[10px] text-white/40 xl:block" title={disclaimer}>
                {disclaimer}
              </p>
            ) : (
              <span className="hidden xl:block" aria-hidden="true" />
            )}
            <div className="ml-auto flex shrink-0 justify-end">
              <ChatModeSwitcher mode={mode} onChange={setMode} disabled={streaming} />
            </div>
          </div>
        </div>

        <main
          className="min-h-0 flex-1 overflow-y-auto overscroll-contain pb-[var(--chat-composer-h)] xl:pb-0"
          aria-live="polite"
        >
          <ChatWindow
            messages={messages}
            streaming={streaming}
            onExampleClick={sendMessage}
            modeConfig={{ ...modeConfig, examples: mode === 'lookup' ? [] : chipExamples }}
            statusText={streaming ? statusText : ''}
            wide
            onFeedback={submitFeedback}
          />
        </main>

        {/* Mobile: ghim ô gõ ngay trên tab bar — luôn thấy đầy đủ, không bị lấp */}
        <div className="chat-composer fixed inset-x-0 bottom-[var(--composer-bottom)] z-30 shrink-0 border-t border-white/10 bg-[#1a080c]/95 pb-1 backdrop-blur-xl xl:static xl:bottom-auto xl:z-auto xl:border-t-0 xl:bg-transparent xl:pb-0">
          {error && (
            <div role="alert" className="px-4 py-1 text-sm text-[var(--color-destructive)] xl:px-6">
              {error}
            </div>
          )}

          <CategoryScopePicker
            selectedIds={categoryIds}
            onChange={setCategoryScope}
            disabled={streaming}
          />

          <ChatInput
            value={input}
            onChange={(next) => {
              transcriptRef.current = next
              setInput(next)
            }}
            onSubmit={() => sendMessage(transcriptRef.current || input)}
            disabled={streaming}
            streaming={streaming}
            onStop={stopGeneration}
            placeholder={
              listening
                ? 'Đang thu… nói câu hỏi, bấm Dừng hoặc Gửi khi xong'
                : talkCfg?.enabled === true
                  ? `${modeConfig.placeholder} · hoặc bấm mic`
                  : modeConfig.placeholder
            }
            wide
            voiceEnabled={talkCfg?.enabled === true}
            listening={listening}
            onMicClick={handleMic}
            onStopListen={stopListening}
          />
        </div>
      </section>

      {/* Cột phải: bàn làm việc — desktop */}
      {sideOpen ? (
        <div className="hidden min-h-0 w-[360px] shrink-0 xl:flex 2xl:w-[400px]">
          <WorkbenchPanel
            mode={mode}
            onModeChange={setMode}
            onAsk={(query, opts) => sendMessage(query, opts)}
            onRestore={restoreFromHistory}
            sessionId={sessionId}
            streaming={streaming}
            refreshKey={historyTick}
          />
        </div>
      ) : null}

      {historyOpen ? (
        <Suspense fallback={null}>
          <HistoryPanel
            open={historyOpen}
            onClose={() => setHistoryOpen(false)}
            sessionId={sessionId}
            onRestore={restoreFromHistory}
            streaming={streaming}
            refreshKey={historyTick}
            onEndSession={endSession}
          />
        </Suspense>
      ) : null}
    </div>
  )
}
