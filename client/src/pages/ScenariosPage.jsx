import { useCallback, useEffect, useMemo, useState } from 'react'
import { ChevronDown, Lightbulb, Search } from 'lucide-react'
import PageSectionBar from '../components/PageSectionBar'
import { apiUrl } from '../lib/apiBase'
import { cachedJson } from '../lib/apiCache'

/**
 * Trang ngoài: xem Q&A có sẵn theo hạng mục + tìm kiếm. Không hỏi AI.
 */
export default function ScenariosPage() {
  const [items, setItems] = useState([])
  const [cats, setCats] = useState([])
  const [q, setQ] = useState('')
  const [categoryId, setCategoryId] = useState('')
  const [openId, setOpenId] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const labelById = useMemo(() => {
    const flat = cats
    const byId = new Map(flat.map((c) => [c.id, c]))
    const pathOf = (id, guard = new Set()) => {
      const c = byId.get(id)
      if (!c || guard.has(id)) return ''
      guard.add(id)
      const parent = c.parent_id ? pathOf(c.parent_id, guard) : ''
      return parent ? `${parent} / ${c.name}` : c.name
    }
    return new Map(flat.map((c) => [c.id, pathOf(c.id)]))
  }, [cats])

  const chips = useMemo(() => {
    return (cats || [])
      .filter((c) => !c.parent_id)
      .map((c) => ({ id: c.id, name: c.name }))
  }, [cats])

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const qs = new URLSearchParams({ limit: '200' })
      if (q.trim()) qs.set('q', q.trim())
      if (categoryId) qs.set('categoryId', categoryId)
      const [sc, cat] = await Promise.all([
        cachedJson(apiUrl(`/api/scenarios?${qs}`)),
        cachedJson(apiUrl('/api/library/categories')),
      ])
      setItems(sc.items || [])
      setCats(cat.items || [])
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }, [q, categoryId])

  useEffect(() => {
    const t = setTimeout(load, 200)
    return () => clearTimeout(t)
  }, [load])

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden">
      <PageSectionBar />
      <div className="safe-x mx-auto h-full min-h-0 w-full max-w-6xl overflow-y-auto py-4 xl:px-6">
      <header className="mb-4">
        <p className="m-0 mb-1 flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.18em] text-[var(--hcc-gold-bright)]">
          <Lightbulb className="h-3.5 w-3.5" />
          Tình huống
        </p>
        <h1 className="m-0 text-xl font-semibold text-[var(--hcc-ink)] sm:text-2xl">
          Hỏi đáp có sẵn theo hạng mục
        </h1>
      </header>

      <div className="relative mb-3">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--hcc-muted)]" />
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Tìm câu hỏi hoặc nội dung trả lời…"
          className="field-glass min-h-12 w-full rounded-2xl border py-3 pl-10 pr-3 text-base sm:text-sm"
        />
      </div>

      <div className="-mx-1 mb-4 flex gap-2 overflow-x-auto px-1 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        <button
          type="button"
          onClick={() => setCategoryId('')}
          className={`min-h-11 shrink-0 rounded-full px-3 text-xs font-semibold ${
            !categoryId
              ? 'bg-[var(--hcc-gold)] text-[#1a1214]'
              : 'border border-white/15 bg-white/10 text-white/80'
          }`}
        >
          Tất cả
        </button>
        {chips.map((c) => (
          <button
            key={c.id}
            type="button"
            onClick={() => setCategoryId((cur) => (cur === c.id ? '' : c.id))}
            className={`min-h-11 shrink-0 rounded-full px-3 text-xs font-semibold ${
              categoryId === c.id
                ? 'bg-[var(--hcc-gold)] text-[#1a1214]'
                : 'border border-white/15 bg-white/10 text-white/80'
            }`}
          >
            {c.name}
          </button>
        ))}
      </div>

      {cats.length ? (
        <select
          value={categoryId}
          onChange={(e) => setCategoryId(e.target.value)}
          className="field-glass mb-4 min-h-11 w-full rounded-2xl border px-3 py-2 text-base sm:text-sm"
        >
          <option value="">Hoặc chọn đúng hạng mục…</option>
          {cats.map((c) => (
            <option key={c.id} value={c.id} className="text-[var(--hcc-ink)]">
              {labelById.get(c.id) || c.name}
            </option>
          ))}
        </select>
      ) : null}

      {error ? (
        <p role="alert" className="mb-3 text-sm text-[var(--color-destructive)]">
          {error}
        </p>
      ) : null}
      {loading ? <p className="text-sm text-[var(--hcc-muted)]">Đang tải…</p> : null}

      <ul className="m-0 flex list-none flex-col gap-3 p-0">
        {items.map((s) => {
          const expanded = openId === s.id
          const question = s.question || s.suggested_question || s.title
          const answer = s.answer || s.sample_answer || ''
          return (
            <li key={s.id} className="glass-panel overflow-hidden rounded-2xl">
              <button
                type="button"
                onClick={() => {
                  const next = expanded ? '' : s.id
                  setOpenId(next)
                  if (!expanded && s.id) {
                    fetch(apiUrl(`/api/scenarios/${encodeURIComponent(s.id)}/use`), {
                      method: 'POST',
                    }).catch(() => {})
                  }
                }}
                className="flex min-h-11 w-full cursor-pointer items-start gap-2 px-4 py-3 text-left"
              >
                <div className="min-w-0 flex-1">
                  <p className="m-0 text-[11px] text-[var(--hcc-gold-bright)]">
                    {labelById.get(s.category_id) || 'Chưa gắn hạng mục'}
                  </p>
                  <h2 className="m-0 mt-1 text-sm font-semibold text-[var(--hcc-ink)] sm:text-base">
                    {question}
                  </h2>
                </div>
                <ChevronDown
                  className={`mt-1 h-4 w-4 shrink-0 text-white/50 transition ${expanded ? 'rotate-180' : ''}`}
                />
              </button>
              {expanded ? (
                <div className="border-t border-white/10 px-4 py-3">
                  <p className="m-0 whitespace-pre-wrap text-sm leading-relaxed text-[var(--hcc-muted)]">
                    {answer || 'Chưa có câu trả lời sẵn.'}
                  </p>
                </div>
              ) : null}
            </li>
          )
        })}
      </ul>

      {!loading && !items.length ? (
        <p className="glass-panel rounded-2xl p-4 text-sm text-[var(--hcc-muted)]">
          Chưa có tình huống trong phạm vi này. Quản trị thêm tại /quantri → Tình huống.
        </p>
      ) : null}
      </div>
    </div>
  )
}
