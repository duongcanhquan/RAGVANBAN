import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useOutletContext } from 'react-router-dom'
import { Lightbulb, Pencil, Plus, Trash2 } from 'lucide-react'
import { adminFetch } from '../../lib/adminApi'

const emptyForm = {
  id: '',
  categoryId: '',
  title: '',
  question: '',
  answer: '',
}

function categoryOptions(items, me) {
  const flat = items || []
  const byId = new Map(flat.map((c) => [c.id, c]))
  const pathOf = (id, guard = new Set()) => {
    const c = byId.get(id)
    if (!c || guard.has(id)) return ''
    guard.add(id)
    const parent = c.parent_id ? pathOf(c.parent_id, guard) : ''
    return parent ? `${parent} / ${c.name}` : c.name
  }
  const allowed = me?.role === 'super_admin' ? null : new Set(me?.allowedCategoryIds || [])
  return flat
    .filter((c) => !allowed || allowed.has(c.id))
    .map((c) => ({ id: c.id, label: pathOf(c.id) }))
    .sort((a, b) => a.label.localeCompare(b.label, 'vi'))
}

export default function QuantriScenarios() {
  const { me } = useOutletContext() || {}
  const [items, setItems] = useState([])
  const [cats, setCats] = useState([])
  const [q, setQ] = useState('')
  const [filterCat, setFilterCat] = useState('')
  const [form, setForm] = useState(emptyForm)
  const [open, setOpen] = useState(false)
  const [error, setError] = useState('')
  const [ok, setOk] = useState('')
  const [busy, setBusy] = useState(false)

  const options = useMemo(() => categoryOptions(cats, me), [cats, me])
  const labelById = useMemo(() => new Map(options.map((o) => [o.id, o.label])), [options])

  const load = useCallback(async () => {
    const [scRes, catRes] = await Promise.all([
      adminFetch(`/api/scenarios?limit=400${q.trim() ? `&q=${encodeURIComponent(q.trim())}` : ''}${filterCat ? `&categoryId=${encodeURIComponent(filterCat)}` : ''}`),
      adminFetch('/api/library/categories'),
    ])
    const sc = await scRes.json().catch(() => ({}))
    const cat = await catRes.json().catch(() => ({}))
    if (!scRes.ok) throw new Error(sc.error || 'Không tải được tình huống')
    setItems(sc.items || [])
    setCats(cat.items || [])
  }, [q, filterCat])

  useEffect(() => {
    const t = setTimeout(() => {
      load().catch((e) => setError(e.message))
    }, 200)
    return () => clearTimeout(t)
  }, [load])

  function startCreate() {
    setForm({ ...emptyForm, categoryId: filterCat || options[0]?.id || '' })
    setOpen(true)
    setOk('')
    setError('')
  }

  function startEdit(s) {
    setForm({
      id: s.id,
      categoryId: s.category_id || '',
      title: s.title || '',
      question: s.question || s.suggested_question || '',
      answer: s.answer || s.sample_answer || '',
    })
    setOpen(true)
    setOk('')
    setError('')
  }

  async function save(e) {
    e.preventDefault()
    setBusy(true)
    setError('')
    setOk('')
    try {
      const payload = {
        categoryId: form.categoryId,
        title: form.title.trim() || form.question.trim().slice(0, 120),
        question: form.question.trim(),
        answer: form.answer.trim(),
        situation: form.question.trim(),
      }
      const res = await adminFetch(form.id ? `/api/scenarios/${form.id}` : '/api/scenarios', {
        method: form.id ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok || data.ok === false) throw new Error(data.error || 'Không lưu được')
      setOpen(false)
      setForm(emptyForm)
      setOk('Đã lưu tình huống Q&A.')
      await load()
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  async function remove(id) {
    if (!window.confirm('Xóa tình huống này khỏi kho Q&A?')) return
    setBusy(true)
    setError('')
    try {
      const res = await adminFetch(`/api/scenarios/${id}`, { method: 'DELETE' })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || 'Không xóa được')
      await load()
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="mx-auto max-w-5xl px-4 py-6 text-slate-100 sm:py-8">
      <header className="mb-5">
        <h1 className="m-0 flex items-center gap-2 text-2xl font-semibold">
          <Lightbulb className="h-6 w-6 text-[var(--hcc-gold-bright)]" />
          Tình huống Q&A
        </h1>
        <p className="m-0 mt-1 text-sm text-white/65">
          Admin và quản lý nhập sẵn câu hỏi–câu trả lời theo hạng mục. Trang ngoài chỉ xem và tìm —
          không nhờ AI soạn.
        </p>
      </header>

      <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Tìm câu hỏi / câu trả lời…"
          className="min-h-11 flex-1 rounded-xl border border-white/15 bg-black/20 px-3 py-2 text-base sm:text-sm"
        />
        <select
          value={filterCat}
          onChange={(e) => setFilterCat(e.target.value)}
          className="min-h-11 rounded-xl border border-white/15 bg-black/20 px-3 py-2 text-sm sm:max-w-xs"
        >
          <option value="">Mọi hạng mục</option>
          {options.map((o) => (
            <option key={o.id} value={o.id}>
              {o.label}
            </option>
          ))}
        </select>
        <button
          type="button"
          onClick={startCreate}
          className="btn-gold inline-flex min-h-11 items-center justify-center gap-1 rounded-2xl px-4 text-sm font-semibold"
        >
          <Plus className="h-4 w-4" />
          Thêm Q&A
        </button>
      </div>

      {error ? <p className="mb-3 text-sm text-rose-300">{error}</p> : null}
      {ok ? <p className="mb-3 text-sm text-emerald-200">{ok}</p> : null}

      {open ? (
        <form onSubmit={save} className="mb-5 space-y-3 rounded-3xl border border-white/10 bg-white/5 p-4">
          <label className="block text-xs text-white/60">
            Hạng mục *
            <select
              required
              value={form.categoryId}
              onChange={(e) => setForm((f) => ({ ...f, categoryId: e.target.value }))}
              className="mt-1 min-h-11 w-full rounded-xl border border-white/15 bg-black/20 px-3 py-2 text-sm"
            >
              <option value="">— Chọn hạng mục —</option>
              {options.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.label}
                </option>
              ))}
            </select>
          </label>
          <label className="block text-xs text-white/60">
            Tiêu đề (tuỳ chọn)
            <input
              value={form.title}
              onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
              placeholder="Để trống thì lấy câu hỏi"
              className="mt-1 min-h-11 w-full rounded-xl border border-white/15 bg-black/20 px-3 py-2 text-sm"
            />
          </label>
          <label className="block text-xs text-white/60">
            Câu hỏi *
            <textarea
              required
              rows={3}
              value={form.question}
              onChange={(e) => setForm((f) => ({ ...f, question: e.target.value }))}
              className="mt-1 w-full rounded-xl border border-white/15 bg-black/20 px-3 py-2 text-sm"
            />
          </label>
          <label className="block text-xs text-white/60">
            Câu trả lời sẵn *
            <textarea
              required
              rows={8}
              value={form.answer}
              onChange={(e) => setForm((f) => ({ ...f, answer: e.target.value }))}
              className="mt-1 w-full rounded-xl border border-white/15 bg-black/20 px-3 py-2 text-sm"
            />
          </label>
          <div className="flex flex-wrap gap-2">
            <button
              type="submit"
              disabled={busy}
              className="btn-gold min-h-11 rounded-2xl px-5 text-sm font-semibold disabled:opacity-40"
            >
              {busy ? 'Đang lưu…' : form.id ? 'Cập nhật' : 'Lưu tình huống'}
            </button>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="min-h-11 rounded-2xl border border-white/15 px-4 text-sm text-white/70"
            >
              Hủy
            </button>
          </div>
        </form>
      ) : null}

      <ul className="m-0 flex list-none flex-col gap-3 p-0">
        {items.map((s) => (
          <li key={s.id} className="rounded-2xl border border-white/10 bg-white/5 p-4">
            <p className="m-0 text-[11px] font-medium uppercase tracking-wide text-[var(--hcc-gold-bright)]">
              {labelById.get(s.category_id) || 'Chưa gắn hạng mục'}
            </p>
            <h2 className="m-0 mt-1 text-base font-semibold">{s.title || s.question}</h2>
            <p className="m-0 mt-2 text-sm text-white/80">
              <span className="text-white/45">Hỏi: </span>
              {s.question || s.suggested_question}
            </p>
            <p className="m-0 mt-2 whitespace-pre-wrap text-sm leading-relaxed text-white/70">
              {s.answer || s.sample_answer}
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => startEdit(s)}
                className="inline-flex min-h-11 items-center gap-1 rounded-xl bg-white/10 px-3 text-xs"
              >
                <Pencil className="h-3.5 w-3.5" />
                Sửa
              </button>
              <button
                type="button"
                onClick={() => remove(s.id)}
                className="inline-flex min-h-11 items-center gap-1 rounded-xl bg-red-500/20 px-3 text-xs text-red-100"
              >
                <Trash2 className="h-3.5 w-3.5" />
                Xóa
              </button>
            </div>
          </li>
        ))}
      </ul>

      {!items.length ? (
        <p className="mt-4 text-sm text-white/50">
          Chưa có tình huống. Bấm Thêm Q&A hoặc kiểm tra hạng mục ở <Link to="/quantri" className="text-[var(--hcc-gold-bright)] underline">Tài liệu</Link>.
        </p>
      ) : null}
    </div>
  )
}
