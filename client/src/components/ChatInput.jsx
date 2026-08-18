import { useEffect, useRef } from 'react'
import { Loader2, SendHorizontal } from 'lucide-react'

/**
 * ChatInput — placeholder theo chế độ + touch-friendly.
 */
export default function ChatInput({
  value,
  onChange,
  onSubmit,
  disabled,
  placeholder,
  wide = false,
}) {
  const ref = useRef(null)

  useEffect(() => {
    if (!disabled) ref.current?.focus()
  }, [disabled])

  useEffect(() => {
    const el = ref.current
    if (!el) return
    el.style.height = 'auto'
    const next = Math.min(el.scrollHeight, 160)
    el.style.height = `${Math.max(next, 48)}px`
  }, [value])

  function handleKeyDown(e) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      if (!disabled && value.trim()) onSubmit()
    }
  }

  return (
    <form
      className="z-20 shrink-0 border-t border-[var(--hcc-line)]/80 bg-white/95 backdrop-blur-xl"
      style={{
        paddingBottom: 'max(0.5rem, env(safe-area-inset-bottom))',
      }}
      onSubmit={(e) => {
        e.preventDefault()
        if (!disabled && value.trim()) onSubmit()
      }}
    >
      <div
        className={`mx-auto flex w-full items-end gap-2 py-3 sm:gap-3 ${
          wide ? 'max-w-none px-4 xl:px-6' : 'safe-x max-w-3xl'
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
          className="min-h-12 max-h-40 flex-1 resize-none overflow-y-auto rounded-2xl border border-[var(--hcc-line)] bg-[var(--hcc-canvas)] px-4 py-3 text-base leading-normal text-[var(--hcc-ink)] placeholder:text-[var(--hcc-muted)]/70 transition focus:border-[var(--hcc-red)] focus:bg-white focus:outline-none disabled:opacity-50"
        />
        <button
          type="submit"
          disabled={disabled || !value.trim()}
          aria-label={disabled ? 'Đang xử lý' : 'Gửi câu hỏi'}
          className="btn-red inline-flex h-12 w-12 shrink-0 cursor-pointer items-center justify-center rounded-2xl transition duration-200 hover:brightness-105 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {disabled ? (
            <Loader2 className="h-5 w-5 animate-spin" aria-hidden="true" />
          ) : (
            <SendHorizontal className="h-5 w-5" aria-hidden="true" />
          )}
        </button>
      </div>
    </form>
  )
}
