import { useEffect, useState } from 'react'
import { FileText, PenLine, ScanLine, Search, Sparkles } from 'lucide-react'
import { chatWaitScene, chatWaitTips, digitizeFunLine, digitizeTips } from '../lib/waitScenes'

function useCyclingLine(lines, enabled) {
  const [i, setI] = useState(0)
  useEffect(() => {
    if (!enabled || !lines?.length) return
    const reduced =
      typeof window !== 'undefined' &&
      window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches
    if (reduced) return undefined
    const t = setInterval(() => setI((n) => (n + 1) % lines.length), 2200)
    return () => clearInterval(t)
  }, [enabled, lines])
  return lines?.[i % (lines?.length || 1)] || ''
}

function PaperStack({ variant = 'scan' }) {
  return (
    <div className="wait-stack" aria-hidden="true">
      <span className="wait-sheet wait-sheet-a" />
      <span className="wait-sheet wait-sheet-b">
        <FileText className="h-7 w-7 text-[var(--hcc-gold-bright)]" />
      </span>
      <span className="wait-sheet wait-sheet-c" />
      {variant === 'scan' ? <span className="wait-scanline" /> : null}
      {variant === 'search' ? (
        <span className="wait-orbit">
          <Search className="h-4 w-4" />
        </span>
      ) : null}
      {variant === 'compose' ? (
        <span className="wait-pen">
          <PenLine className="h-4 w-4" />
        </span>
      ) : null}
      <span className="wait-bits">
        <i />
        <i />
        <i />
      </span>
    </div>
  )
}

export function DigitizingWait({ percent = 0, message = '', active = true }) {
  const p = Math.min(100, Math.max(0, Number(percent) || 0))
  const headline = digitizeFunLine(p, message)
  const extra = useCyclingLine(digitizeTips('default'), active)

  return (
    <div
      className="glass-progress wait-card mt-4 overflow-hidden rounded-2xl p-4"
      role="status"
      aria-live="polite"
      aria-busy={active}
    >
      <div className="flex items-center gap-4">
        <PaperStack variant="scan" />
        <div className="min-w-0 flex-1">
          <p className="m-0 flex items-center gap-1.5 text-sm font-medium text-[var(--hcc-gold-bright)]">
            <ScanLine className="h-4 w-4 shrink-0" />
            {headline}
          </p>
          <p className="m-0 mt-1 text-xs text-white/70">{message || extra}</p>
          <div className="mt-3 h-2 overflow-hidden rounded-full bg-white/10">
            <div
              className="wait-bar h-full rounded-full bg-gradient-to-r from-[var(--hcc-red)] to-[var(--hcc-gold-bright)]"
              style={{ width: `${p}%` }}
            />
          </div>
          <div className="mt-1 flex justify-between text-[11px] text-white/50">
            <span>{active ? extra : 'Xong'}</span>
            <span className="tabular-nums">{Math.round(p)}%</span>
          </div>
        </div>
      </div>
    </div>
  )
}

export function ChatWait({ statusText = '', compact = false }) {
  const scene = chatWaitScene(statusText)
  const tip = useCyclingLine(chatWaitTips(scene.kind), true)
  const variant = scene.kind === 'compose' ? 'compose' : scene.kind === 'route' ? 'scan' : 'search'

  return (
    <div
      className={`wait-chat ${compact ? 'wait-chat-compact' : ''}`}
      role="status"
      aria-live="polite"
      aria-busy="true"
    >
      <PaperStack variant={variant} />
      <div className="min-w-0">
        <p className="m-0 flex items-center gap-1.5 text-sm font-medium text-slate-100">
          <Sparkles className="h-4 w-4 shrink-0 text-[var(--hcc-gold-bright)] wait-spark" />
          {scene.line}
        </p>
        <p className="m-0 mt-1 text-xs text-white/60">{statusText || tip}</p>
        <span className="wait-dots mt-2" aria-hidden="true">
          <i />
          <i />
          <i />
        </span>
      </div>
    </div>
  )
}

export function ListeningBars() {
  return (
    <span className="wait-wave" aria-hidden="true">
      <i />
      <i />
      <i />
      <i />
      <i />
    </span>
  )
}
