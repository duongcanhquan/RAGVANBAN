import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Lightbulb, Plus, Trash2, Play } from 'lucide-react'

/**
 * Kho tình huống đặc thù mẫu — làm giàu AI & tái sử dụng.
 */
export default function ScenariosPage() {
  const navigate = useNavigate()
  const [items, setItems] = useState([])
  const [q, setQ] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [formOpen, setFormOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [form, setForm] = useState({
    title: '',
    situation: '',
    suggested_question: '',
    sample_answer: '',
    tags: '',
  })

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const qs = new URLSearchParams()
      if (q.trim()) qs.set('q', q.trim())
      const res = await fetch(`/api/scenarios?${qs}`)
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Không tải được')
      setItems(data.items || [])
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }, [q])

  useEffect(() => {
    const t = setTimeout(load, 200)
    return () => clearTimeout(t)
  }, [load])

  async function handleCreate(e) {
    e.preventDefault()
    setSaving(true)
    setError('')
    try {
      const res = await fetch('/api/scenarios', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Lưu thất bại')
      setForm({
        title: '',
        situation: '',
        suggested_question: '',
        sample_answer: '',
        tags: '',
      })
      setFormOpen(false)
      await load()
    } catch (err) {
      setError(err.message)
    } finally {
      setSaving(false)
    }
  }

  async function handleUse(id) {
    const res = await fetch(`/api/scenarios/${id}/use`, { method: 'POST' })
    const data = await res.json()
    if (data.ask) {
      navigate('/', { state: { prefill: data.ask, mode: 'advise' } })
    }
  }

  async function handleDelete(id) {
    if (!confirm('Xóa tình huống này?')) return
    await fetch(`/api/scenarios/${id}`, { method: 'DELETE' })
    await load()
  }

  return (
    <div className="safe-x mx-auto h-full min-h-0 w-full max-w-6xl overflow-y-auto py-4 xl:px-6">
      <header className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="m-0 mb-1 flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.18em] text-[var(--hcc-red)]">
            <Lightbulb className="h-3.5 w-3.5" />
            Kho mẫu
          </p>
          <h1 className="m-0 text-xl font-semibold text-[var(--hcc-ink)] sm:text-2xl">
            Tình huống đặc thù
          </h1>
          <p className="m-0 mt-1 text-sm text-[var(--hcc-muted)]">
            Lưu case hay gặp → người sau dùng lại · AI tham khảo khi trả lời
          </p>
        </div>
        <button
          type="button"
          onClick={() => setFormOpen((v) => !v)}
          className="btn-red inline-flex cursor-pointer items-center gap-1.5 rounded-2xl px-4 py-2.5 text-sm font-semibold"
        >
          <Plus className="h-4 w-4" />
          Thêm mẫu
        </button>
      </header>

      {formOpen && (
        <form
          onSubmit={handleCreate}
          className="mb-4 space-y-3 rounded-2xl border border-[var(--hcc-line)] bg-white p-4 shadow-[var(--shadow-sm)]"
        >
          <input
            required
            value={form.title}
            onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
            placeholder="Tiêu đề tình huống *"
            className="w-full rounded-xl border border-[var(--hcc-line)] px-3 py-2.5 text-sm outline-none focus:border-[var(--hcc-red)]"
          />
          <textarea
            required
            rows={3}
            value={form.situation}
            onChange={(e) => setForm((f) => ({ ...f, situation: e.target.value }))}
            placeholder="Mô tả tình huống đặc thù *"
            className="w-full resize-y rounded-xl border border-[var(--hcc-line)] px-3 py-2.5 text-sm outline-none focus:border-[var(--hcc-red)]"
          />
          <input
            value={form.suggested_question}
            onChange={(e) => setForm((f) => ({ ...f, suggested_question: e.target.value }))}
            placeholder="Câu hỏi gợi ý để tra cứu"
            className="w-full rounded-xl border border-[var(--hcc-line)] px-3 py-2.5 text-sm outline-none focus:border-[var(--hcc-red)]"
          />
          <textarea
            rows={3}
            value={form.sample_answer}
            onChange={(e) => setForm((f) => ({ ...f, sample_answer: e.target.value }))}
            placeholder="Gợi ý xử lý / câu trả lời mẫu (tuỳ chọn)"
            className="w-full resize-y rounded-xl border border-[var(--hcc-line)] px-3 py-2.5 text-sm outline-none focus:border-[var(--hcc-red)]"
          />
          <input
            value={form.tags}
            onChange={(e) => setForm((f) => ({ ...f, tags: e.target.value }))}
            placeholder="Tags (cách nhau bởi dấu phẩy)"
            className="w-full rounded-xl border border-[var(--hcc-line)] px-3 py-2.5 text-sm outline-none focus:border-[var(--hcc-red)]"
          />
          <div className="flex gap-2">
            <button
              type="submit"
              disabled={saving}
              className="btn-gold cursor-pointer rounded-xl px-4 py-2 text-sm font-semibold disabled:opacity-40"
            >
              {saving ? 'Đang lưu…' : 'Lưu tình huống'}
            </button>
            <button
              type="button"
              onClick={() => setFormOpen(false)}
              className="cursor-pointer rounded-xl px-4 py-2 text-sm text-[var(--hcc-muted)]"
            >
              Hủy
            </button>
          </div>
        </form>
      )}

      <input
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Tìm tình huống…"
        className="mb-4 w-full rounded-2xl border border-[var(--hcc-line)] bg-white px-4 py-3 text-sm outline-none focus:border-[var(--hcc-red)]"
      />

      {error && (
        <p role="alert" className="mb-3 text-sm text-[var(--color-destructive)]">
          {error}
        </p>
      )}
      {loading && <p className="text-sm text-[var(--hcc-muted)]">Đang tải…</p>}

      <ul className="m-0 flex list-none flex-col gap-3 p-0">
        {items.map((s) => (
          <li
            key={s.id}
            className="rounded-2xl border border-[var(--hcc-line)] bg-white p-4 shadow-[var(--shadow-sm)]"
          >
            <h2 className="m-0 text-base font-semibold text-[var(--hcc-ink)]">{s.title}</h2>
            <p className="m-0 mt-2 text-sm leading-relaxed text-[var(--hcc-muted)]">{s.situation}</p>
            {s.suggested_question && (
              <p className="m-0 mt-2 text-xs text-[var(--hcc-red)]">
                Hỏi gợi ý: {s.suggested_question}
              </p>
            )}
            {(s.tags || []).length > 0 && (
              <div className="mt-2 flex flex-wrap gap-1">
                {s.tags.map((t) => (
                  <span
                    key={t}
                    className="rounded-full bg-[var(--hcc-red-soft)] px-2 py-0.5 text-[11px] text-[var(--hcc-red-deep)]"
                  >
                    {t}
                  </span>
                ))}
              </div>
            )}
            <div className="mt-3 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => handleUse(s.id)}
                className="inline-flex cursor-pointer items-center gap-1 rounded-xl bg-[var(--hcc-red)] px-3 py-2 text-xs font-semibold text-white"
              >
                <Play className="h-3.5 w-3.5" />
                Dùng để hỏi
              </button>
              <button
                type="button"
                onClick={() => handleDelete(s.id)}
                className="inline-flex cursor-pointer items-center gap-1 rounded-xl px-3 py-2 text-xs text-[var(--hcc-muted)] hover:bg-[var(--hcc-red-soft)] hover:text-[var(--hcc-red)]"
              >
                <Trash2 className="h-3.5 w-3.5" />
                Xóa
              </button>
              <span className="ml-auto self-center text-[11px] text-[var(--hcc-muted)]">
                dùng {s.use_count || 0} lần
              </span>
            </div>
          </li>
        ))}
      </ul>

      {!loading && !items.length && (
        <p className="text-sm text-[var(--hcc-muted)]">Chưa có tình huống — thêm mẫu đầu tiên.</p>
      )}
    </div>
  )
}
