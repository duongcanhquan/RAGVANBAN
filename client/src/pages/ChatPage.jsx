import { useEffect, useMemo, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { History, PanelRightClose, PanelRightOpen, Plus, Scale, Sparkles, Volume2, VolumeX } from 'lucide-react'
import ChatWindow from '../components/ChatWindow'
import ChatInput from '../components/ChatInput'
import HistoryPanel from '../components/HistoryPanel'
import WorkbenchPanel from '../components/WorkbenchPanel'
import { streamChat } from '../lib/streamChat'
import { getSessionId } from '../lib/session'
import { saveLocalTurn } from '../lib/chatHistory'
import { getMode, MODES } from '../lib/modes'
import { createSpeakAhead } from '../lib/speakAhead'
import { speechRecognitionSupported, startSpeechListen } from '../lib/speechListen'
import { apiUrl } from '../lib/apiBase'

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
  const [sideOpen, setSideOpen] = useState(true)
  const [quickKeywords, setQuickKeywords] = useState([])
  const [talkCfg, setTalkCfg] = useState(null)
  const [disclaimer, setDisclaimer] = useState('')
  const [speakOn, setSpeakOn] = useState(true)
  const [listening, setListening] = useState(false)
  const abortRef = useRef(null)
  const speakRef = useRef(null)
  const listenRef = useRef(null)
  const sessionId = getSessionId()
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
    fetch(apiUrl('/api/settings/quick-keywords'))
      .then((r) => r.json())
      .then((d) => setQuickKeywords(d.items || []))
      .catch(() => {})
  }, [])

  useEffect(() => {
    fetch(apiUrl('/api/settings/rag'))
      .then((r) => r.json())
      .then((d) => {
        if (d?.disclaimer) setDisclaimer(d.disclaimer)
      })
      .catch(() => {})
  }, [])

  useEffect(() => {
    fetch(apiUrl('/api/settings/voice-talk'))
      .then((r) => r.json())
      .then((d) => {
        if (!d?.enabled) {
          setTalkCfg(null)
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
      listenRef.current?.stop()
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
    try {
      const saved = localStorage.getItem('hcc_side_open')
      if (saved === '0') setSideOpen(false)
    } catch {
      // ignore
    }
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

  function newChat() {
    speakRef.current?.cancel()
    listenRef.current?.stop()
    setListening(false)
    setMessages([])
    setInput('')
    setError('')
    setStatusText('')
  }

  function toggleSpeak() {
    setSpeakOn((v) => {
      const next = !v
      try {
        localStorage.setItem('hcc_speak_on', next ? '1' : '0')
      } catch {
        // ignore
      }
      if (!next) speakRef.current?.cancel()
      return next
    })
  }

  function handleMic() {
    if (!talkCfg?.enabled) return
    if (listening) {
      listenRef.current?.stop()
      setListening(false)
      return
    }
    if (!speechRecognitionSupported()) {
      setError('Trình duyệt chưa hỗ trợ mic. Dùng Chrome/Edge và cho phép micro.')
      return
    }
    setError('')
    setListening(true)
    listenRef.current = startSpeechListen({
      lang: talkCfg.lang || 'vi-VN',
      onText: (text, isFinal) => {
        if (text) setInput(text)
        if (isFinal && text.trim()) {
          listenRef.current?.stop()
          setListening(false)
          sendMessage(text.trim())
        }
      },
      onEnd: () => setListening(false),
      onError: (err) => {
        setListening(false)
        setError(err.message || 'Không nghe được')
      },
    })
  }

  function restoreFromHistory(item) {
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

  async function sendMessage(text) {
    const question = String(text || '').trim()
    if (!question || streaming) return

    setError('')
    setInput('')
    setStreaming(true)
    setStatusText('Đang tiếp nhận câu hỏi…')

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
        qaMode: mode,
      },
    ])

    const controller = new AbortController()
    abortRef.current = controller

    speakRef.current?.cancel()
    const speaker =
      talkCfg?.enabled && speakOn && ttsSupported
        ? createSpeakAhead({ lang: talkCfg.lang || 'vi-VN', rate: talkCfg.rate || 1.05 })
        : null
    speakRef.current = speaker

    try {
      await streamChat(question, {
        signal: controller.signal,
        sessionId,
        mode,
        voiceTalk: Boolean(talkCfg?.enabled && speakOn),
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
                    streaming: false,
                  }
                : m
            )
          )
          saveLocalTurn({
            sessionId,
            question,
            answer: answer || '',
            sources,
          })
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
        <div className="flex shrink-0 items-center justify-between gap-3 border-b border-white/10 bg-black/20 px-4 py-1.5 backdrop-blur-md xl:px-6">
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <div
              className="inline-flex rounded-full border border-white/15 bg-white/10 p-1"
              role="tablist"
              aria-label="Chế độ"
            >
              {Object.values(MODES).map((m) => (
                <button
                  key={m.id}
                  type="button"
                  role="tab"
                  aria-selected={mode === m.id}
                  disabled={streaming}
                  onClick={() => setMode(m.id)}
                  className={`inline-flex cursor-pointer items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-semibold transition sm:text-sm ${
                    mode === m.id
                      ? m.id === 'advise'
                        ? 'btn-gold'
                        : 'bg-[var(--hcc-red)] text-white'
                      : 'text-white/60 hover:text-white'
                  } disabled:opacity-50`}
                >
                  {m.id === 'advise' ? (
                    <Sparkles className="h-3.5 w-3.5" />
                  ) : (
                    <Scale className="h-3.5 w-3.5" />
                  )}
                  {m.label}
                </button>
              ))}
            </div>
            <p className="m-0 hidden text-xs text-[var(--hcc-muted)] lg:block">
              {modeConfig.hint}
            </p>
            {disclaimer ? (
              <p className="m-0 hidden max-w-xl truncate text-[10px] text-white/40 xl:block" title={disclaimer}>
                {disclaimer}
              </p>
            ) : null}
          </div>

          <div className="flex shrink-0 items-center gap-0.5">
            {talkCfg?.enabled ? (
              <button
                type="button"
                onClick={toggleSpeak}
                className="inline-flex cursor-pointer items-center gap-1 rounded-xl px-2.5 py-1.5 text-xs font-medium text-white/60 hover:bg-white/10 hover:text-white"
                aria-pressed={speakOn}
                title={
                  !ttsSupported
                    ? 'Trình duyệt không hỗ trợ đọc thoại'
                    : speakOn
                      ? 'Tắt đọc câu trả lời'
                      : 'Bật đọc ngay khi AI viết'
                }
              >
                {speakOn && ttsSupported ? <Volume2 className="h-3.5 w-3.5 text-emerald-300" /> : <VolumeX className="h-3.5 w-3.5" />}
                <span className="hidden sm:inline">
                  {!ttsSupported ? 'Không TTS' : speakOn ? 'Đang nói' : 'Im lặng'}
                </span>
              </button>
            ) : null}
            <button
              type="button"
              onClick={newChat}
              className="inline-flex cursor-pointer items-center gap-1 rounded-xl px-2.5 py-1.5 text-xs font-medium text-white/60 hover:bg-white/10 hover:text-white"
            >
              <Plus className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">Chat mới</span>
            </button>
            <button
              type="button"
              onClick={() => setHistoryOpen(true)}
              className="inline-flex cursor-pointer items-center gap-1 rounded-xl px-2.5 py-1.5 text-xs font-medium text-white/60 hover:bg-white/10 hover:text-white xl:hidden"
            >
              <History className="h-3.5 w-3.5" />
              Lịch sử
            </button>
            <button
              type="button"
              onClick={toggleSide}
              className="hidden cursor-pointer items-center gap-1 rounded-xl px-2.5 py-1.5 text-xs font-medium text-white/60 hover:bg-white/10 hover:text-white xl:inline-flex"
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

        <main className="min-h-0 flex-1 overflow-y-auto overscroll-contain" aria-live="polite">
          <ChatWindow
            messages={messages}
            streaming={streaming}
            onExampleClick={sendMessage}
            modeConfig={{ ...modeConfig, examples: chipExamples }}
            statusText={streaming ? statusText : ''}
            wide
          />
        </main>

        {error && (
          <div role="alert" className="px-4 py-1 text-sm text-[var(--color-destructive)] xl:px-6">
            {error}
          </div>
        )}

        <ChatInput
          value={input}
          onChange={setInput}
          onSubmit={() => sendMessage(input)}
          disabled={streaming}
          placeholder={
            listening
              ? 'Đang nghe… hãy nói câu hỏi'
              : talkCfg?.enabled
                ? `${modeConfig.placeholder} · hoặc bấm mic`
                : modeConfig.placeholder
          }
          wide
          voiceEnabled={Boolean(talkCfg?.enabled)}
          listening={listening}
          onMicClick={handleMic}
        />
      </section>

      {/* Cột phải: bàn làm việc — desktop */}
      {sideOpen && (
        <div className="hidden min-h-0 w-[360px] shrink-0 xl:flex 2xl:w-[400px]">
          <WorkbenchPanel
            mode={mode}
            onModeChange={setMode}
            onAsk={sendMessage}
            onRestore={restoreFromHistory}
            sessionId={sessionId}
            streaming={streaming}
            quickKeywords={chipExamples}
          />
        </div>
      )}

      <HistoryPanel
        open={historyOpen}
        onClose={() => setHistoryOpen(false)}
        sessionId={sessionId}
        onRestore={restoreFromHistory}
      />
    </div>
  )
}
