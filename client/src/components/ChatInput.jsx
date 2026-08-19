import { useEffect, useRef } from 'react'
import { Loader2, SendHorizontal, Mic, Square } from 'lucide-react'

/**
 * ChatInput — placeholder theo chế độ + mic bật/dừng khi admin bật voice.
 */
export default function ChatInput({
  value,
  onChange,
  onSubmit,
  disabled,
  placeholder,
  wide = false,
  voiceEnabled = false,
  listening = false,
  onMicClick,
  onStopListen,
  streaming = false,
  onStop,
}) {
  const ref = useRef(null)

  useEffect(() => {
    if (!disabled && !listening) ref.current?.focus()
  }, [disabled, listening])

  useEffect(() => {
    const el = ref.current
    if (!el) return
    el.style.height = 'auto'
    // Giới hạn chiều cao composer để không che mất phần chat phía dưới
    const next = Math.min(el.scrollHeight, 128)
    el.style.height = `${Math.max(next, 48)}px`
  }, [value])

  function handleKeyDown(e) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      if (streaming) return
      if (listening) {
        onStopListen?.({ send: true })
        return
      }
      if (!disabled && value.trim()) onSubmit()
    }
  }

  return (
    <form
      className="z-20 shrink-0 xl:border-t xl:border-white/10 xl:bg-black/30 xl:backdrop-blur-xl"
      onSubmit={(e) => {
        e.preventDefault()
        if (streaming) return
        if (listening) {
          onStopListen?.({ send: true })
          return
        }
        if (!disabled && value.trim()) onSubmit()
      }}
    >
      {listening ? (
        <p className="m-0 px-3 pt-2 text-center text-[11px] text-emerald-200/90 sm:px-4 xl:px-6" role="status">
          Đang nghe — nói câu hỏi. Im lặng khoảng 2 giây sẽ gửi. <strong>Dừng</strong> giữ chữ, không gửi. <strong>Gửi</strong> gửi ngay.
        </p>
      ) : null}
      <div
        className={`mx-auto flex w-full items-end gap-2 py-2 sm:gap-3 sm:py-3 ${
          wide ? 'max-w-none px-3 sm:px-4 xl:px-6' : 'safe-x max-w-3xl'
        }`}
      >
        <label htmlFor="chat-input" className="sr-only">
          Câu hỏi hệ thống văn bản thông minh
        </label>
        <textarea
          id="chat-input"
          ref={ref}
          rows={1}
          value={value}
          disabled={disabled}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={placeholder || 'Nhập câu hỏi…'}
          enterKeyHint="send"
          className="field-glass min-h-12 max-h-32 flex-1 resize-none overflow-y-auto rounded-2xl border px-4 py-3 text-base leading-normal transition disabled:opacity-50"
        />
        {voiceEnabled && !listening ? (
          <button
            type="button"
            onClick={onMicClick}
            disabled={disabled}
            aria-label="Bật mic, nói câu hỏi"
            className="relative inline-flex h-12 w-12 shrink-0 cursor-pointer items-center justify-center rounded-2xl border border-white/15 bg-white/10 text-white/85 transition hover:bg-white/15 disabled:opacity-40"
          >
            <Mic className="h-5 w-5" aria-hidden="true" />
          </button>
        ) : null}
        {voiceEnabled && listening ? (
          <button
            type="button"
            onClick={() => onStopListen?.({ send: false })}
            aria-label="Dừng thu giọng"
            className="relative inline-flex h-12 min-w-12 shrink-0 cursor-pointer items-center justify-center gap-1.5 rounded-2xl border border-amber-300/50 bg-amber-500/30 px-3 text-amber-50"
          >
            <Square className="h-4 w-4 fill-current" aria-hidden="true" />
            <span className="hidden text-xs font-semibold sm:inline">Dừng</span>
          </button>
        ) : null}
        {streaming ? (
          <button
            type="button"
            onClick={() => onStop?.()}
            aria-label="Dừng trả lời"
            className="btn-red inline-flex h-12 w-12 shrink-0 cursor-pointer items-center justify-center rounded-2xl transition duration-200 hover:brightness-105"
          >
            <Square className="h-4 w-4 fill-current" aria-hidden="true" />
          </button>
        ) : (
          <button
            type="submit"
            disabled={disabled || (!value.trim() && !listening)}
            aria-label={listening ? 'Dừng và gửi câu hỏi' : 'Gửi câu hỏi'}
            className="btn-red inline-flex h-12 min-w-12 shrink-0 cursor-pointer items-center justify-center gap-1 rounded-2xl px-3 transition duration-200 hover:brightness-105 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {disabled ? (
              <Loader2 className="h-5 w-5 animate-spin" aria-hidden="true" />
            ) : (
              <>
                <SendHorizontal className="h-5 w-5" aria-hidden="true" />
                {listening ? <span className="hidden text-xs font-semibold sm:inline">Gửi</span> : null}
              </>
            )}
          </button>
        )}
      </div>
    </form>
  )
}
