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
        wide ? 'max-w-none px-3 sm:px-4 xl:px-6' : 'safe-x max-w-3xl'
      }`}
    >
      {empty && (
        <section className="glass-panel rounded-2xl px-3 py-3 sm:px-5 sm:py-4">
          <h1 className="m-0 text-base font-semibold tracking-tight text-[var(--hcc-ink)] sm:text-xl">
            {modeConfig?.id === 'advise'
              ? 'Tư vấn tình huống theo văn bản'
              : 'Tra cứu văn bản nhanh'}
          </h1>
          <p className="m-0 mt-1 max-w-3xl text-sm text-[var(--hcc-muted)]">
            {modeConfig?.id === 'lookup' ? (
              <>
                {/* Mobile: tránh nội dung hướng dẫn tra cứu nhanh quá dài/chiếm chỗ */}
                <span className="hidden lg:inline">
                  {modeConfig?.hint ||
                    'Hỏi bên trái · dùng bàn làm việc bên phải để chọn VB, mẫu, lịch sử.'}
                </span>
                <span className="lg:hidden">Nhập câu hỏi để tra cứu văn bản.</span>
              </>
            ) : (
              modeConfig?.hint || 'Hỏi bên trái · dùng bàn làm việc bên phải để chọn VB, mẫu, lịch sử.'
            )}
          </p>
          <p className="m-0 mt-1.5 text-[11px] text-white/40 xl:hidden">
            Lịch sử chỉ trên phiên đang mở. Đóng tab hoặc bấm Hết phiên để xóa.
          </p>
          {(modeConfig?.examples || []).length ? (
            <div className="mt-3 flex flex-wrap gap-2">
              {(modeConfig?.examples || []).map((ex) => {
                const label = typeof ex === 'string' ? ex : ex.label || ex.query
                const query = typeof ex === 'string' ? ex : ex.query || ex.label
                return (
                  <button
                    key={ex.id || query}
                    type="button"
                    disabled={streaming}
                    onClick={() => !streaming && onExampleClick(query)}
                    className="min-h-11 cursor-pointer rounded-2xl border border-white/15 bg-white/10 px-3 py-2 text-left text-xs text-slate-100 transition hover:border-[var(--hcc-gold)] hover:text-[var(--hcc-gold-bright)] disabled:cursor-not-allowed disabled:opacity-40 sm:min-h-0 sm:rounded-full sm:text-sm"
                  >
                    {label}
                  </button>
                )
              })}
            </div>
          ) : (
            <p className="m-0 mt-3 text-xs text-[var(--hcc-muted)]">
              {modeConfig?.id === 'lookup' ? (
                <>
                  <span className="hidden lg:inline">
                    Gợi ý nhanh lấy từ văn bản đã số hóa. Chưa có tài liệu thì ô gợi ý để trống — hỏi theo
                    tên hoặc số hiệu văn bản bạn đã tải lên.
                  </span>
                  <span className="lg:hidden">Nhập câu hỏi của bạn.</span>
                </>
              ) : (
                'Gợi ý nhanh lấy từ văn bản đã số hóa. Chưa có tài liệu thì ô gợi ý để trống — hỏi theo tên hoặc số hiệu văn bản bạn đã tải lên.'
              )}
            </p>
          )}
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
        />
      ))}
      <div ref={bottomRef} aria-hidden="true" />
    </div>
  )
}
