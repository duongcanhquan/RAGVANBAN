import { Scale, Sparkles } from 'lucide-react'
import { MODES } from '../lib/modes'

/**
 * Tra cứu / Tư vấn — segment gọn, hai nút liền nhau (toggle).
 */
export default function ChatModeSwitcher({ mode, onChange, disabled = false, className = '' }) {
  return (
    <div
      className={`inline-flex gap-1 rounded-2xl border border-white/15 bg-white/10 p-1 sm:rounded-full ${className}`}
      role="tablist"
      aria-label="Chế độ xử lý"
    >
      {Object.values(MODES).map((m) => {
        const active = mode === m.id
        const isAdvise = m.id === 'advise'
        return (
          <button
            key={m.id}
            type="button"
            role="tab"
            aria-selected={active}
            disabled={disabled}
            onClick={() => onChange(m.id)}
            className={`inline-flex min-h-9 cursor-pointer items-center justify-center gap-1 rounded-xl px-2.5 text-xs font-semibold transition disabled:opacity-50 sm:min-h-9 sm:rounded-full sm:px-3 sm:text-xs ${
              active
                ? isAdvise
                  ? 'btn-gold'
                  : 'bg-[var(--hcc-red)] text-white'
                : 'text-white/60 hover:text-white'
            }`}
          >
            {isAdvise ? (
              <Sparkles className="h-3.5 w-3.5 sm:h-3.5 sm:w-3.5" aria-hidden="true" />
            ) : (
              <Scale className="h-3.5 w-3.5 sm:h-3.5 sm:w-3.5" aria-hidden="true" />
            )}
            {m.label}
          </button>
        )
      })}
    </div>
  )
}
