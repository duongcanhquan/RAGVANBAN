import { useEffect, useState } from 'react'
import { Plus, Trash2 } from 'lucide-react'
import { adminFetch } from '../../lib/adminApi'
import CategoryTreeEditor from './QuantriCategories'
import QuantriIntegrations from './QuantriIntegrations'
import VoiceTalkCard from './VoiceTalkCard'

const SECTIONS = [
  { id: 'voice-chat', label: 'Voice chat' },
  { id: 'chuyen-muc', label: 'Chuyên mục' },
  { id: 'tu-khoa', label: 'Từ khóa tìm nhanh' },
  { id: 'drive-n8n', label: 'Google Drive & n8n' },
]

export default function QuantriSettings() {
  const [section, setSection] = useState('voice-chat')
  const [seen, setSeen] = useState(() => new Set(['voice-chat']))
  const [items, setItems] = useState([])
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [draft, setDraft] = useState({ label: '', query: '', mode: 'both' })
  const [keywordsLoaded, setKeywordsLoaded] = useState(false)

  function go(id) {
    setSection(id)
    setSeen((cur) => {
      if (cur.has(id)) return cur
      const next = new Set(cur)
      next.add(id)
      return next
    })
  }

  async function loadKeywords() {
    const res = await adminFetch('/api/quantri/quick-keywords')
    const data = await res.json().catch(() => ({}))
    if (!res.ok) throw new Error(data.error || 'Không tải được từ khóa')
    setItems(data.items || [])
    setKeywordsLoaded(true)
  }

  useEffect(() => {
    if (section !== 'tu-khoa' || keywordsLoaded) return
    loadKeywords().catch((e) => setError(e.message))
  }, [section, keywordsLoaded])

  async function save(nextItems) {
    setBusy(true)
    setError('')
    try {
      const res = await adminFetch('/api/quantri/quick-keywords', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ items: nextItems }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok || !data.ok) throw new Error(data.error || 'Không lưu được từ khóa')
      setItems(data.items || nextItems)
    } catch (e) {
      setError(e.message)
    } finally {
      setBusy(false)
    }
  }

  function addKeyword(e) {
    e.preventDefault()
    const query = draft.query.trim()
    const label = (draft.label.trim() || query).slice(0, 80)
    if (!query) return
    const next = [...items, { id: `k-${Date.now()}`, label, query, mode: draft.mode }]
    setDraft({ label: '', query: '', mode: 'both' })
    save(next)
  }

  return (
    <div className="mx-auto max-w-5xl px-4 py-8 text-slate-100">
      <header className="mb-5">
        <h1 className="m-0 text-2xl font-semibold">Cài đặt</h1>
      </header>

      <nav className="mb-6 flex flex-wrap gap-1">
        {SECTIONS.map((s) => (
          <button
            key={s.id}
            type="button"
            onClick={() => go(s.id)}
            className={`rounded-full px-3 py-1.5 text-xs font-medium ${
              section === s.id ? 'bg-white text-[var(--hcc-red)]' : 'bg-white/10 text-white/80'
            }`}
          >
            {s.label}
          </button>
        ))}
      </nav>

      {seen.has('voice-chat') ? (
        <div hidden={section !== 'voice-chat'} className="max-w-3xl">
          <VoiceTalkCard />
        </div>
      ) : null}

      {seen.has('chuyen-muc') ? (
        <div hidden={section !== 'chuyen-muc'}>
          <CategoryTreeEditor />
        </div>
      ) : null}

      {seen.has('tu-khoa') ? (
        <section hidden={section !== 'tu-khoa'}>
          <h2 className="m-0 text-lg font-semibold">Từ khóa tìm nhanh</h2>
          {error ? <p className="mb-3 mt-4 text-sm text-red-200">{error}</p> : null}

          <form
            onSubmit={addKeyword}
            className="mb-4 mt-4 grid gap-2 rounded-3xl border border-white/10 bg-white/5 p-4 sm:grid-cols-[8rem_1fr_8rem_auto]"
          >
            <input
              value={draft.label}
              onChange={(e) => setDraft({ ...draft, label: e.target.value })}
              placeholder="Nhãn (số hiệu / tên VB)"
              className="rounded-xl border border-white/15 bg-black/20 px-3 py-2 text-sm"
            />
            <input
              value={draft.query}
              onChange={(e) => setDraft({ ...draft, query: e.target.value })}
              placeholder="Câu hỏi / từ khóa tìm…"
              className="rounded-xl border border-white/15 bg-black/20 px-3 py-2 text-sm"
              required
            />
            <select
              value={draft.mode}
              onChange={(e) => setDraft({ ...draft, mode: e.target.value })}
              className="rounded-xl border border-white/15 bg-black/20 px-2 py-2 text-sm"
            >
              <option value="both">Cả 2 chế độ</option>
              <option value="lookup">Tra cứu</option>
              <option value="advise">Tư vấn</option>
            </select>
            <button
              type="submit"
              disabled={busy}
              className="inline-flex items-center justify-center gap-1 rounded-xl bg-[var(--hcc-red)] px-3 py-2 text-sm font-semibold disabled:opacity-40"
            >
              <Plus className="h-4 w-4" />
              Thêm
            </button>
          </form>

          <ul className="m-0 list-none space-y-2 p-0">
            {items.map((it) => (
              <li
                key={it.id}
                className="flex flex-wrap items-center gap-2 rounded-2xl border border-white/10 bg-white/5 px-3 py-2"
              >
                <span className="rounded-full bg-white/10 px-2 py-0.5 text-xs">{it.label}</span>
                <span className="min-w-0 flex-1 text-sm text-white/80">{it.query}</span>
                <span className="text-[10px] text-white/45">
                  {it.mode === 'both' ? 'Cả 2' : it.mode === 'advise' ? 'Tư vấn' : 'Tra cứu'}
                </span>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => save(items.filter((x) => x.id !== it.id))}
                  className="inline-flex items-center gap-1 rounded-full bg-red-500/20 px-2.5 py-1 text-[11px] text-red-100"
                >
                  <Trash2 className="h-3 w-3" />
                  Xóa
                </button>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {seen.has('drive-n8n') ? (
        <div hidden={section !== 'drive-n8n'}>
          <QuantriIntegrations />
        </div>
      ) : null}
    </div>
  )
}
