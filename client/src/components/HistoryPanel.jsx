import { useEffect, useState } from 'react'
import { BookmarkPlus, History, X } from 'lucide-react'
import { loadLocalHistory, markLocalKnowledge, promoteToScenario } from '../lib/chatHistory'
import { groupHistoryIntoThreads } from '../lib/conversationHistory'
import { adminFetch } from '../lib/adminApi'

/**
 * Lịch sử phiên hiện tại — điện thoại: sheet dưới; desktop: drawer phải.
 */
export default function HistoryPanel({
  open,
  onClose,
  sessionId,
  onRestore,
  streaming = false,
  refreshKey = 0,
  onEndSession,
}) {
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(false)
  const [busyId, setBusyId] = useState('')
  const [canEnrich, setCanEnrich] = useState(false)

  useEffect(() => {
    if (!open) return
    let cancelled = false
    adminFetch('/api/quantri/me')
      .then((res) => {
        if (!cancelled) setCanEnrich(res.ok)
      })
      .catch(() => {
        if (!cancelled) setCanEnrich(false)
      })
    return () => {
      cancelled = true
    }
  }, [open])

  useEffect(() => {
    if (!open) return
    setLoading(true)
    const local = loadLocalHistory(sessionId)
    setItems(groupHistoryIntoThreads(local))
    setLoading(false)
  }, [open, sessionId, refreshKey])

  async function enrich(item) {
    const last = item.turns?.[item.turns.length - 1] || item
    const targetId = last.id || item.id
    setBusyId(item.id)
    try {
      await promoteToScenario(last)
      markLocalKnowledge(targetId, true)
      setItems((prev) =>
        prev.map((x) => (x.id === item.id ? { ...x, marked_knowledge: true } : x))
      )
    } catch (e) {
      console.warn('[history] enrich', e.message)
    } finally {
      setBusyId('')
    }
  }

  if (!open) return null

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center xl:items-stretch xl:justify-end"
      role="dialog"
      aria-modal="true"
      aria-label="Lịch sử phiên này"
    >
      <button
        type="button"
        className="absolute inset-0 cursor-pointer bg-black/40"
        aria-label="Đóng"
        onClick={onClose}
      />
      <aside className="relative flex max-h-[85dvh] w-full flex-col rounded-t-3xl border border-white/10 bg-[#1a080c] shadow-2xl xl:h-full xl:max-w-md xl:rounded-none xl:border-l xl:border-t-0">
        <div className="mx-auto mt-2 h-1 w-10 rounded-full bg-white/25 xl:hidden" aria-hidden="true" />
        <div className="flex items-center justify-between border-b border-white/10 px-4 py-3">
          <div className="flex items-center gap-2 text-[var(--hcc-gold-bright)]">
            <History className="h-5 w-5" />
            <h2 className="m-0 text-base font-semibold text-[var(--hcc-ink)]">Phiên này</h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="inline-flex min-h-11 min-w-11 cursor-pointer items-center justify-center rounded-xl p-2 text-[var(--hcc-muted)] hover:bg-white/10"
            aria-label="Đóng panel"
          >
            <X className="h-5 w-5" />
          </button>
        </div>
        <p className="m-0 border-b border-white/10 px-4 py-2 text-xs text-[var(--hcc-muted)]">
          Chỉ trên tab đang mở. Đóng tab hoặc Kết thúc phiên sẽ xóa — người sau không xem được.
        </p>
        <div className="min-h-0 flex-1 overflow-y-auto p-3">
          {loading && <p className="text-sm text-[var(--hcc-muted)]">Đang tải…</p>}
          {!loading && items.length === 0 && (
            <p className="text-sm text-[var(--hcc-muted)]">Chưa hỏi gì trong phiên này.</p>
          )}
          <ul className="m-0 flex list-none flex-col gap-2 p-0">
            {items.map((item) => (
              <li key={item.id} className="rounded-2xl border border-white/10 bg-white/5 p-3">
                <button
                  type="button"
                  disabled={streaming}
                  className="min-h-11 w-full cursor-pointer text-left disabled:opacity-40"
                  onClick={() => {
                    onRestore?.(item)
                    onClose()
                  }}
                >
                  <p className="m-0 line-clamp-2 text-sm font-medium text-[var(--hcc-ink)]">
                    {item.question}
                  </p>
                  <p className="m-0 mt-1 text-[11px] text-[var(--hcc-muted)]">
                    {item.turnCount > 1 ? `${item.turnCount} lượt · ` : ''}
                    {item.created_at ? new Date(item.created_at).toLocaleString('vi-VN') : ''}
                    {item.marked_knowledge ? ' · đã làm giàu' : ''}
                  </p>
                </button>
                {canEnrich ? (
                  <button
                    type="button"
                    disabled={busyId === item.id || item.marked_knowledge}
                    onClick={() => enrich(item)}
                    className="mt-2 inline-flex min-h-11 cursor-pointer items-center gap-1 rounded-xl px-3 py-1 text-xs text-[var(--hcc-gold-bright)] hover:bg-white/10 disabled:opacity-40"
                  >
                    <BookmarkPlus className="h-3.5 w-3.5" />
                    {item.marked_knowledge ? 'Đã lưu mẫu' : 'Làm giàu AI'}
                  </button>
                ) : null}
              </li>
            ))}
          </ul>
        </div>
        {onEndSession ? (
          <div className="border-t border-white/10 p-3">
            <button
              type="button"
              onClick={onEndSession}
              className="inline-flex min-h-11 w-full cursor-pointer items-center justify-center rounded-2xl border border-white/15 bg-white/5 text-sm font-medium text-white/80 hover:bg-white/10"
            >
              Kết thúc phiên — xóa lịch sử trên máy
            </button>
          </div>
        ) : null}
      </aside>
    </div>
  )
}
