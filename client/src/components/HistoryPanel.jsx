import { useEffect, useState } from 'react'
import { BookmarkPlus, History, X } from 'lucide-react'
import {
  fetchServerHistory,
  loadLocalHistory,
  markLocalKnowledge,
  promoteToScenario,
} from '../lib/chatHistory'

/**
 * Panel lịch sử chat — tải lại Q&A / đánh dấu làm giàu kiến thức.
 */
export default function HistoryPanel({ open, onClose, sessionId, onRestore }) {
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(false)
  const [busyId, setBusyId] = useState('')

  useEffect(() => {
    if (!open) return
    let cancelled = false
    ;(async () => {
      setLoading(true)
      const local = loadLocalHistory(sessionId)
      const server = await fetchServerHistory(sessionId)
      if (cancelled) return
      const map = new Map()
      for (const s of server) {
        map.set(s.id, {
          id: s.id,
          question: s.question,
          answer: s.answer,
          sources: s.citations_used || [],
          created_at: s.created_at,
          marked_knowledge: s.marked_knowledge,
          from: 'server',
        })
      }
      for (const l of local) {
        if (!map.has(l.id)) {
          map.set(l.id, { ...l, from: 'local' })
        }
      }
      setItems([...map.values()].sort((a, b) => String(b.created_at).localeCompare(String(a.created_at))))
      setLoading(false)
    })()
    return () => {
      cancelled = true
    }
  }, [open, sessionId])

  async function enrich(item) {
    setBusyId(item.id)
    try {
      markLocalKnowledge(item.id, true)
      if (item.from === 'server') {
        await fetch(`/api/history/${item.id}/mark-knowledge`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ marked: true, asScenario: true }),
        })
      } else {
        await promoteToScenario(item)
      }
      setItems((prev) =>
        prev.map((x) => (x.id === item.id ? { ...x, marked_knowledge: true } : x))
      )
    } finally {
      setBusyId('')
    }
  }

  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 flex justify-end" role="dialog" aria-modal="true" aria-label="Lịch sử chat">
      <button
        type="button"
        className="absolute inset-0 cursor-pointer bg-black/30"
        aria-label="Đóng"
        onClick={onClose}
      />
      <aside className="relative flex h-full w-full max-w-md flex-col bg-white shadow-2xl">
        <div className="flex items-center justify-between border-b border-[var(--hcc-line)] px-4 py-3">
          <div className="flex items-center gap-2 text-[var(--hcc-red)]">
            <History className="h-5 w-5" />
            <h2 className="m-0 text-base font-semibold text-[var(--hcc-ink)]">Lịch sử tra cứu</h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="cursor-pointer rounded-xl p-2 text-[var(--hcc-muted)] hover:bg-[var(--hcc-red-soft)]"
            aria-label="Đóng panel"
          >
            <X className="h-5 w-5" />
          </button>
        </div>
        <p className="m-0 border-b border-[var(--hcc-line)] px-4 py-2 text-xs text-[var(--hcc-muted)]">
          Bấm mục để xem lại · Bookmark để đưa vào kho tình huống (làm giàu AI)
        </p>
        <div className="flex-1 overflow-y-auto p-3">
          {loading && <p className="text-sm text-[var(--hcc-muted)]">Đang tải…</p>}
          {!loading && items.length === 0 && (
            <p className="text-sm text-[var(--hcc-muted)]">Chưa có lịch sử trên thiết bị / server.</p>
          )}
          <ul className="m-0 flex list-none flex-col gap-2 p-0">
            {items.map((item) => (
              <li
                key={item.id}
                className="rounded-2xl border border-[var(--hcc-line)] bg-[var(--hcc-canvas)] p-3"
              >
                <button
                  type="button"
                  className="w-full cursor-pointer text-left"
                  onClick={() => {
                    onRestore?.(item)
                    onClose()
                  }}
                >
                  <p className="m-0 line-clamp-2 text-sm font-medium text-[var(--hcc-ink)]">
                    {item.question}
                  </p>
                  <p className="m-0 mt-1 text-[11px] text-[var(--hcc-muted)]">
                    {item.created_at
                      ? new Date(item.created_at).toLocaleString('vi-VN')
                      : ''}{' '}
                    · {item.from === 'server' ? 'server' : 'máy này'}
                    {item.marked_knowledge ? ' · đã làm giàu' : ''}
                  </p>
                </button>
                <button
                  type="button"
                  disabled={busyId === item.id || item.marked_knowledge}
                  onClick={() => enrich(item)}
                  className="mt-2 inline-flex cursor-pointer items-center gap-1 rounded-xl px-2 py-1 text-xs text-[var(--hcc-red)] hover:bg-[var(--hcc-red-soft)] disabled:opacity-40"
                >
                  <BookmarkPlus className="h-3.5 w-3.5" />
                  {item.marked_knowledge ? 'Đã lưu mẫu' : 'Làm giàu AI'}
                </button>
              </li>
            ))}
          </ul>
        </div>
      </aside>
    </div>
  )
}
