import { Scale, Sparkles } from 'lucide-react'
import { MODES } from '../lib/modes'

/**
 * Tra cứu / Tư vấn — hàng dưới, căn phải, màu nổi bật.
 */
export default function ChatModeSwitcher({ mode, onChange, disabled = false }) {
  return (
    <div
      className="inline-flex gap-2 rounded-2xl border border-white/25 bg-gradient-to-r from-black/50 to-black/30 p-1.5 shadow-[0_4px_24px_rgba(0,0,0,0.45)] backdrop-blur-sm"
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
            className={`inline-flex min-h-10 cursor-pointer items-center justify-center gap-1.5 rounded-xl px-4 py-2 text-sm font-bold tracking-wide transition disabled:opacity-50 sm:min-h-11 sm:px-5 ${
              active
                ? isAdvise
                  ? 'btn-gold scale-[1.02] shadow-[0_0_20px_rgba(212,175,55,0.45)] ring-2 ring-[var(--hcc-gold-bright)]/60'
                  : 'scale-[1.02] bg-[var(--hcc-red)] text-white shadow-[0_0_20px_rgba(185,28,28,0.5)] ring-2 ring-red-300/50'
                : isAdvise
                  ? 'border border-amber-400/25 bg-amber-500/10 text-amber-100/90 hover:bg-amber-500/20'
                  : 'border border-red-400/25 bg-red-500/10 text-red-100/90 hover:bg-red-500/20'
            }`}
          >
            {isAdvise ? (
              <Sparkles className="h-4 w-4 shrink-0" aria-hidden="true" />
            ) : (
              <Scale className="h-4 w-4 shrink-0" aria-hidden="true" />
            )}
            {m.label}
          </button>
        )
      })}
    </div>
  )
}
