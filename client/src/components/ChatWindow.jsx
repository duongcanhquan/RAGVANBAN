import { useEffect, useRef } from 'react'
import MessageBubble from './MessageBubble'

/**
 * ChatWindow — empty state theo chế độ Tra cứu / Tư vấn.
 */
export default function ChatWindow({
  messages,
  streaming,
  onExampleClick,
  modeConfig,
  statusText,
  wide = false,
}) {
  const bottomRef = useRef(null)
  const empty = messages.length === 0

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' })
  }, [messages, streaming, statusText])

  return (
    <div
      className={`mx-auto flex w-full flex-col gap-3 py-3 sm:py-4 ${
        wide ? 'max-w-none px-4 xl:px-6' : 'safe-x max-w-3xl'
      }`}
    >
      {empty && (
        <section className="rounded-2xl border border-[var(--hcc-line)]/80 bg-white/70 px-4 py-4 sm:px-5">
          <h1 className="m-0 text-lg font-semibold tracking-tight text-[var(--hcc-ink)] sm:text-xl">
            Hệ thống tra cứu văn bản thông minh
          </h1>
          <p className="m-0 mt-1 max-w-3xl text-sm text-[var(--hcc-muted)]">
            {modeConfig?.hint ||
              'Hỏi bên trái · dùng bàn làm việc bên phải để chọn VB, mẫu, lịch sử.'}
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            {(modeConfig?.examples || []).map((ex) => {
              const label = typeof ex === 'string' ? ex : ex.label || ex.query
              const query = typeof ex === 'string' ? ex : ex.query || ex.label
              return (
                <button
                  key={ex.id || query}
                  type="button"
                  onClick={() => onExampleClick(query)}
                  className="cursor-pointer rounded-full border border-[var(--hcc-line)] bg-white px-3 py-2 text-left text-xs text-[var(--hcc-ink)] transition hover:border-[var(--hcc-red)] hover:text-[var(--hcc-red)] sm:text-sm"
                >
                  {label}
                </button>
              )
            })}
          </div>
        </section>
      )}

      {statusText && (
        <p
          className="m-0 rounded-xl border border-[var(--hcc-line)] bg-white/80 px-3 py-2 text-xs text-[var(--hcc-muted)]"
          aria-live="polite"
        >
          {statusText}
        </p>
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
        />
      ))}
      <div ref={bottomRef} aria-hidden="true" />
    </div>
  )
}
