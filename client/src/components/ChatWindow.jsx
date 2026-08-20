import { useEffect, useRef } from 'react'
import MessageBubble from './MessageBubble'
import ChatModeSwitcher from './ChatModeSwitcher'

const EMPTY_HINT =
  'Nhập thông tin để tra cứu văn bản liên quan hoặc nhận thông tin tư vấn tham khảo văn bản theo tình huống.'

/**
 * ChatWindow — empty state gọn; tra cứu = thuần chat, không chip VB.
 */
export default function ChatWindow({
  messages,
  streaming,
  onExampleClick,
  modeConfig,
  mode,
  onModeChange,
  statusText,
  wide = false,
  onFeedback,
}) {
  const bottomRef = useRef(null)
  const empty = messages.length === 0
  const isLookup = modeConfig?.id === 'lookup'
  const examples = isLookup ? [] : modeConfig?.examples || []

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' })
  }, [messages, streaming, statusText])

  return (
    <div
      className={`mx-auto flex w-full flex-col gap-3 py-3 sm:py-4 ${
        wide ? 'max-w-none px-3 sm:px-4 xl:px-6' : 'safe-x max-w-3xl'
      }`}
    >
      {empty && (
        <section className="rounded-2xl border border-white/10 bg-black/15 px-4 py-5 sm:px-6 sm:py-6">
          <div className="flex flex-wrap items-center justify-between gap-2 gap-y-2">
            <h1 className="m-0 min-w-0 flex-1 text-lg font-semibold tracking-tight text-[var(--hcc-ink)] sm:text-xl">
              {isLookup ? 'Tra cứu văn bản' : 'Tư vấn tình huống'}
            </h1>
            {onModeChange ? (
              <ChatModeSwitcher mode={mode} onChange={onModeChange} disabled={streaming} className="shrink-0" />
            ) : null}
          </div>
          <p className="m-0 mt-2 text-sm text-[var(--hcc-muted)]">{EMPTY_HINT}</p>

          {!isLookup && examples.length > 0 ? (
            <div className="mt-4 flex flex-wrap gap-2">
              {examples.map((ex) => {
                const label = typeof ex === 'string' ? ex : ex.label || ex.query
                const query = typeof ex === 'string' ? ex : ex.query || ex.label
                return (
                  <button
                    key={ex.id || query}
                    type="button"
                    disabled={streaming}
                    onClick={() => !streaming && onExampleClick?.(query)}
                    className="min-h-11 cursor-pointer rounded-2xl border border-white/15 bg-white/10 px-3 py-2 text-left text-xs text-slate-100 transition hover:border-[var(--hcc-gold)] hover:text-[var(--hcc-gold-bright)] disabled:cursor-not-allowed disabled:opacity-40 sm:min-h-0 sm:rounded-full sm:text-sm"
                  >
                    {label}
                  </button>
                )
              })}
            </div>
          ) : null}
        </section>
      )}

      {messages.map((m) => (
        <MessageBubble
          key={m.id}
          role={m.role}
          content={m.content}
          streaming={m.streaming}
          sources={m.sources}
          confidence={m.confidence}
          qaMode={m.qaMode}
          statusText={m.streaming ? statusText : ''}
          logId={m.logId}
          feedback={m.feedback}
          onFeedback={onFeedback}
        />
      ))}
      <div ref={bottomRef} aria-hidden="true" />
    </div>
  )
}
