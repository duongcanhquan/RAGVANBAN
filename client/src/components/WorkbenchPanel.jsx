import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  FolderTree,
  History,
  Lightbulb,
  Scale,
  Sparkles,
  Zap,
} from 'lucide-react'
import { loadLocalHistory } from '../lib/chatHistory'
import { groupHistoryIntoThreads } from '../lib/conversationHistory'
import { MODES } from '../lib/modes'
import { apiUrl } from '../lib/apiBase'
import { cachedJson } from '../lib/apiCache'

/**
 * Panel phải (desktop) — thao tác nhanh · cây VB · tình huống · lịch sử.
 */
export default function WorkbenchPanel({
  mode,
  onModeChange,
  onRestore,
  sessionId,
  streaming,
  refreshKey = 0,
}) {
  const [tab, setTab] = useState('quick')
  const [scenarios, setScenarios] = useState([])
  const [history, setHistory] = useState([])
  const [loading, setLoading] = useState(false)

  const loadSideData = useCallback(async () => {
    setLoading(true)
    try {
      const scRes = await cachedJson(apiUrl('/api/scenarios?limit=30'))
      setScenarios(scRes.items || [])
      const local = loadLocalHistory(sessionId)
      setHistory(groupHistoryIntoThreads(local).slice(0, 24))
    } finally {
      setLoading(false)
    }
  }, [sessionId])

  useEffect(() => {
    loadSideData()
  }, [loadSideData, refreshKey])

  const tabs = [
    { id: 'quick', label: 'Nhanh', Icon: Zap },
    { id: 'cases', label: 'Mẫu', Icon: Lightbulb },
    { id: 'hist', label: 'Gần đây', Icon: History },
  ]

  return (
    <aside className="flex h-full min-h-0 w-full flex-col border-l border-white/10 bg-black/25 backdrop-blur-xl">
      <div className="border-b border-white/10 px-4 py-3">
        <p className="m-0 text-xs font-semibold uppercase tracking-[0.16em] text-[var(--hcc-gold-bright)]">
          Bàn làm việc
        </p>
      </div>

      <div className="flex gap-0.5 border-b border-white/10 bg-black/20 p-1.5">
        {tabs.map(({ id, label, Icon }) => (
          <button
            key={id}
            type="button"
            onClick={() => setTab(id)}
            className={`flex flex-1 cursor-pointer flex-col items-center justify-center gap-0.5 rounded-xl px-1 py-2 text-[10px] font-semibold transition min-h-11 ${
              tab === id
                ? 'bg-white/15 text-[var(--hcc-gold-bright)] shadow-sm'
                : 'text-white/55 hover:bg-white/10 hover:text-white'
            }`}
          >
            <Icon className="h-4 w-4" />
            {label}
          </button>
        ))}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-3">
        {tab === 'quick' && (
          <div className="space-y-4">
            <div>
              <p className="m-0 mb-2 text-[11px] font-semibold uppercase tracking-wider text-[var(--hcc-muted)]">
                Chế độ xử lý
              </p>
              <div className="grid grid-cols-2 gap-2">
                {Object.values(MODES).map((m) => (
                  <button
                    key={m.id}
                    type="button"
                    disabled={streaming}
                    onClick={() => onModeChange?.(m.id)}
                    className={`cursor-pointer rounded-2xl border px-3 py-3 text-left transition ${
                      mode === m.id
                        ? m.id === 'advise'
                          ? 'border-[var(--hcc-gold)] bg-[var(--hcc-gold)]/15'
                          : 'border-[var(--hcc-red)] bg-[var(--hcc-red-soft)]'
                        : 'border-white/15 bg-white/5 hover:border-white/30'
                    } disabled:opacity-50`}
                  >
                    <span className="flex items-center gap-1.5 text-sm font-semibold text-[var(--hcc-ink)]">
                      {m.id === 'advise' ? (
                        <Sparkles className="h-4 w-4 text-[var(--hcc-gold)]" />
                      ) : (
                        <Scale className="h-4 w-4 text-[var(--hcc-red)]" />
                      )}
                      {m.label}
                    </span>
                    <span className="mt-1 block text-[11px] leading-snug text-[var(--hcc-muted)]">
                      {m.short}
                    </span>
                  </button>
                ))}
              </div>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <Link
                to="/thu-vien"
                className="rounded-2xl border border-white/15 bg-white/5 px-3 py-3 text-center text-xs font-medium text-slate-100 hover:border-[var(--hcc-gold)]"
              >
                <FolderTree className="mx-auto mb-1 h-4 w-4 text-[var(--hcc-red)]" />
                Thư viện đầy đủ
              </Link>
              <Link
                to="/tinh-huong"
                className="col-span-2 rounded-2xl border border-white/15 bg-white/5 px-3 py-3 text-center text-xs font-medium text-slate-100 hover:border-[var(--hcc-gold)]"
              >
                <Lightbulb className="mx-auto mb-1 h-4 w-4 text-[var(--hcc-gold)]" />
                Kho tình huống
              </Link>
            </div>
          </div>
        )}

        {tab === 'cases' && (
          <div className="space-y-2">
            <p className="m-0 mb-2 text-[11px] font-semibold uppercase tracking-wider text-[var(--hcc-muted)]">
              Q&A có sẵn
            </p>
            {loading && !scenarios.length ? (
              <p className="text-xs text-[var(--hcc-muted)]">Đang tải…</p>
            ) : null}
            {!loading && !scenarios.length && (
              <p className="text-xs text-[var(--hcc-muted)]">
                Chưa có tình huống. Admin thêm tại Quản trị → Tình huống.
              </p>
            )}
            {scenarios.map((s) => (
              <article key={s.id} className="glass-panel rounded-2xl p-3">
                <h3 className="m-0 text-sm font-semibold text-[var(--hcc-ink)]">
                  {s.question || s.suggested_question || s.title}
                </h3>
                <p className="m-0 mt-1 line-clamp-3 text-[11px] text-[var(--hcc-muted)]">
                  {s.answer || s.sample_answer || s.situation}
                </p>
              </article>
            ))}
            <Link
              to="/tinh-huong"
              className="mt-2 block rounded-2xl border border-white/15 bg-white/5 px-3 py-3 text-center text-xs font-medium text-slate-100 hover:border-[var(--hcc-gold)]"
            >
              Xem tất cả theo hạng mục
            </Link>
          </div>
        )}

        {tab === 'hist' && (
          <div className="space-y-2">
            <p className="m-0 mb-2 text-[11px] font-semibold uppercase tracking-wider text-[var(--hcc-muted)]">
              Phiên này (xóa khi đóng tab)
            </p>
            {!history.length && (
              <p className="text-xs text-[var(--hcc-muted)]">Chưa hỏi trong phiên đang mở.</p>
            )}
            {history.map((h) => (
              <button
                key={h.id}
                type="button"
                disabled={streaming}
                onClick={() => onRestore?.(h)}
                className="w-full cursor-pointer rounded-xl border border-white/15 bg-white/5 px-3 py-2.5 text-left transition hover:border-[var(--hcc-gold)]"
              >
                <p className="m-0 line-clamp-2 text-xs font-medium text-[var(--hcc-ink)]">
                  {h.question}
                </p>
                <p className="m-0 mt-1 text-[10px] text-[var(--hcc-muted)]">
                  {h.turnCount > 1 ? `${h.turnCount} lượt · ` : ''}
                  {h.created_at ? new Date(h.created_at).toLocaleString('vi-VN') : ''}
                </p>
              </button>
            ))}
          </div>
        )}
      </div>
    </aside>
  )
}
