import { useCallback, useEffect, useState } from 'react'
import { Link, useOutletContext } from 'react-router-dom'
import { BookOpen, Check, GraduationCap, Plus, Save, Sparkles, Trash2 } from 'lucide-react'
import { adminFetch } from '../../lib/adminApi'

const TABS = [
  { id: 'skills', label: 'Kỹ năng' },
  { id: 'samples', label: 'Bài mẫu' },
  { id: 'learn', label: 'Học mỗi ngày' },
]

const emptySkill = {
  slug: '',
  title: '',
  whenToUse: '',
  triggers: '',
  instructions: '',
  alwaysOn: false,
  enabled: true,
}

export default function QuantriTeach() {
  const { me } = useOutletContext() || {}
  const superAdmin = me?.role === 'super_admin'
  const [tab, setTab] = useState('skills')
  const [items, setItems] = useState([])
  const [samples, setSamples] = useState([])
  const [learn, setLearn] = useState(null)
  const [error, setError] = useState('')
  const [ok, setOk] = useState('')
  const [busy, setBusy] = useState(false)
  const [editing, setEditing] = useState(null)
  const [sampleForm, setSampleForm] = useState({
    title: '',
    situation: '',
    suggested_question: '',
    sample_answer: '',
  })

  const load = useCallback(async () => {
    const res = await adminFetch('/api/quantri/skills')
    const data = await res.json().catch(() => ({}))
    if (!res.ok) throw new Error(data.error || 'Không tải được kho dạy AI')
    setItems(data.items || [])
    setSamples(data.samples || [])
    setLearn(data.learn || null)
  }, [])

  useEffect(() => {
    load().catch((e) => setError(e.message))
  }, [load])

  async function saveSkill(e) {
    e.preventDefault()
    if (!superAdmin) return
    setBusy(true)
    setError('')
    setOk('')
    try {
      const payload = {
        ...editing,
        triggers: String(editing.triggers || '')
          .split(/[,;\n]/)
          .map((t) => t.trim())
          .filter(Boolean),
      }
      const res = await adminFetch('/api/quantri/skills', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ skill: payload }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok || !data.ok) throw new Error(data.error || 'Không lưu được kỹ năng')
      setItems(data.items || [])
      setEditing(null)
      setOk('Đã lưu kỹ năng. Câu hỏi sau sẽ dùng ngay.')
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  async function toggleSkill(skill) {
    if (!superAdmin) return
    setBusy(true)
    try {
      const res = await adminFetch('/api/quantri/skills', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ skill: { ...skill, enabled: !skill.enabled } }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || 'Không đổi được')
      setItems(data.items || [])
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  async function removeSkill(slug) {
    if (!superAdmin) return
    if (!window.confirm('Tắt / xóa kỹ năng này?')) return
    setBusy(true)
    try {
      const res = await adminFetch('/api/quantri/skills', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ deleteSlug: slug }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || 'Không xóa được')
      setItems(data.items || [])
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  async function saveSample(e) {
    e.preventDefault()
    setBusy(true)
    setError('')
    try {
      const res = await adminFetch('/api/scenarios', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(sampleForm),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || 'Không lưu bài mẫu')
      setSampleForm({ title: '', situation: '', suggested_question: '', sample_answer: '' })
      await load()
      setOk('Đã thêm bài mẫu. Khi câu hỏi gần giống, AI học bố cục trả lời.')
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  async function runLearn() {
    if (!superAdmin) return
    setBusy(true)
    setError('')
    try {
      const res = await adminFetch('/api/quantri/learn/run', { method: 'POST' })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || 'Không chạy được vòng học')
      setLearn(data)
      setOk(
        `Đã quét ${data.stats?.scanned || 0} lượt chat · ${data.suggestions?.length || 0} gợi ý.`
      )
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  async function decideLearn(suggestion, approve) {
    if (!superAdmin) return
    setBusy(true)
    try {
      const path = approve ? '/api/quantri/learn/approve' : '/api/quantri/learn/dismiss'
      const res = await adminFetch(path, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(approve ? { suggestion } : { id: suggestion.id }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || 'Không xử lý được gợi ý')
      await load()
      setOk(approve ? 'Đã dạy vào kho.' : 'Đã bỏ gợi ý.')
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="mx-auto max-w-4xl px-4 py-8 text-slate-100">
      <header className="mb-5">
        <h1 className="m-0 flex items-center gap-2 text-2xl font-semibold">
          <GraduationCap className="h-6 w-6 text-[var(--hcc-gold-bright)]" />
          Dạy AI
        </h1>
        <p className="m-0 mt-1 text-sm text-white/65">
          Đây là chỗ train cách đọc văn bản và cách trả lời. Luật chống bịa không tắt được.
          Văn bản gốc vẫn nằm ở Tài liệu — skill chỉ dạy <em>cách làm</em>.
        </p>
      </header>

      <div className="mb-4 flex flex-wrap gap-1 rounded-full border border-white/10 bg-white/5 p-1">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTab(t.id)}
            className={`rounded-full px-3 py-1.5 text-xs font-semibold ${
              tab === t.id ? 'bg-white text-[var(--hcc-red)]' : 'text-white/70 hover:text-white'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {error ? <p className="mb-3 text-sm text-rose-300">{error}</p> : null}
      {ok ? <p className="mb-3 text-sm text-emerald-200">{ok}</p> : null}

      {tab === 'skills' ? (
        <section className="space-y-3">
          <p className="m-0 text-xs text-white/55">
            Kỹ năng luôn bật đi vào mọi câu hỏi. Kỹ năng theo từ khóa chỉ kích hoạt khi đúng chủ đề
            (ví dụ sửa đổi, thủ tục). Super-admin được sửa.
          </p>
          {superAdmin ? (
            <button
              type="button"
              onClick={() => setEditing({ ...emptySkill })}
              className="inline-flex items-center gap-1 rounded-xl bg-white/10 px-3 py-2 text-xs"
            >
              <Plus className="h-3.5 w-3.5" />
              Thêm kỹ năng
            </button>
          ) : (
            <p className="m-0 text-xs text-amber-100/80">Bạn xem được kỹ năng; chỉ super-admin được sửa.</p>
          )}

          {editing ? (
            <form onSubmit={saveSkill} className="space-y-2 rounded-2xl border border-white/10 bg-black/25 p-4">
              <input
                required
                value={editing.title}
                onChange={(e) => setEditing((s) => ({ ...s, title: e.target.value }))}
                placeholder="Tên kỹ năng"
                className="w-full rounded-xl border border-white/15 bg-black/20 px-3 py-2 text-sm"
              />
              <input
                value={editing.whenToUse}
                onChange={(e) => setEditing((s) => ({ ...s, whenToUse: e.target.value }))}
                placeholder="Khi nào dùng (mô tả)"
                className="w-full rounded-xl border border-white/15 bg-black/20 px-3 py-2 text-sm"
              />
              <input
                value={
                  Array.isArray(editing.triggers) ? editing.triggers.join(', ') : editing.triggers || ''
                }
                onChange={(e) => setEditing((s) => ({ ...s, triggers: e.target.value }))}
                placeholder="Từ khóa kích hoạt, cách nhau bởi dấu phẩy — để trống nếu luôn bật"
                className="w-full rounded-xl border border-white/15 bg-black/20 px-3 py-2 text-sm"
              />
              <textarea
                required
                rows={7}
                value={editing.instructions}
                onChange={(e) => setEditing((s) => ({ ...s, instructions: e.target.value }))}
                placeholder="Nội dung dạy: AI phải làm gì khi đọc / trả lời"
                className="w-full rounded-xl border border-white/15 bg-black/20 px-3 py-2 font-mono text-[13px]"
              />
              <label className="flex items-center gap-2 text-xs text-white/70">
                <input
                  type="checkbox"
                  checked={Boolean(editing.alwaysOn)}
                  onChange={(e) => setEditing((s) => ({ ...s, alwaysOn: e.target.checked }))}
                />
                Luôn bật (mọi câu hỏi)
              </label>
              <div className="flex gap-2">
                <button
                  type="submit"
                  disabled={busy}
                  className="btn-gold inline-flex items-center gap-1 rounded-xl px-3 py-2 text-xs font-semibold"
                >
                  <Save className="h-3.5 w-3.5" />
                  Lưu kỹ năng
                </button>
                <button type="button" onClick={() => setEditing(null)} className="text-xs text-white/60">
                  Hủy
                </button>
              </div>
            </form>
          ) : null}

          {items.map((s) => (
            <article key={s.slug} className="rounded-2xl border border-white/10 bg-white/5 p-4">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <h2 className="m-0 text-sm font-semibold">
                    {s.title}
                    {s.system ? (
                      <span className="ml-2 rounded-full bg-white/10 px-2 py-0.5 text-[10px] font-normal text-white/55">
                        hệ thống
                      </span>
                    ) : null}
                    {s.alwaysOn ? (
                      <span className="ml-2 rounded-full bg-emerald-500/20 px-2 py-0.5 text-[10px] font-normal text-emerald-100">
                        luôn bật
                      </span>
                    ) : null}
                  </h2>
                  <p className="m-0 mt-1 text-xs text-white/55">{s.whenToUse}</p>
                </div>
                {superAdmin ? (
                  <div className="flex gap-2">
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => toggleSkill(s)}
                      className="rounded-lg bg-white/10 px-2 py-1 text-[11px]"
                    >
                      {s.enabled ? 'Đang bật' : 'Đang tắt'}
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        setEditing({
                          ...s,
                          triggers: (s.triggers || []).join(', '),
                        })
                      }
                      className="rounded-lg bg-white/10 px-2 py-1 text-[11px]"
                    >
                      Sửa
                    </button>
                    <button type="button" onClick={() => removeSkill(s.slug)} className="text-[11px] text-rose-200">
                      <Trash2 className="inline h-3.5 w-3.5" />
                    </button>
                  </div>
                ) : null}
              </div>
              <pre className="m-0 mt-2 max-h-40 overflow-auto whitespace-pre-wrap text-[11px] text-white/70">
                {s.instructions}
              </pre>
            </article>
          ))}
        </section>
      ) : null}

      {tab === 'samples' ? (
        <section className="space-y-3">
          <p className="m-0 text-xs text-white/55">
            Bài mẫu = few-shot. AI học bố cục, không copy số liệu nếu khác văn bản lần hỏi.
            Có thể lưu từ lịch sử chat («Làm giàu AI»).
          </p>
          <form onSubmit={saveSample} className="space-y-2 rounded-2xl border border-white/10 bg-black/25 p-4">
            <input
              required
              value={sampleForm.title}
              onChange={(e) => setSampleForm((s) => ({ ...s, title: e.target.value }))}
              placeholder="Tên bài (vd. Cấp lại CCCD)"
              className="w-full rounded-xl border border-white/15 bg-black/20 px-3 py-2 text-sm"
            />
            <textarea
              required
              rows={2}
              value={sampleForm.situation}
              onChange={(e) => setSampleForm((s) => ({ ...s, situation: e.target.value }))}
              placeholder="Tình huống / cách hỏi"
              className="w-full rounded-xl border border-white/15 bg-black/20 px-3 py-2 text-sm"
            />
            <input
              value={sampleForm.suggested_question}
              onChange={(e) => setSampleForm((s) => ({ ...s, suggested_question: e.target.value }))}
              placeholder="Câu hỏi mẫu"
              className="w-full rounded-xl border border-white/15 bg-black/20 px-3 py-2 text-sm"
            />
            <textarea
              rows={5}
              value={sampleForm.sample_answer}
              onChange={(e) => setSampleForm((s) => ({ ...s, sample_answer: e.target.value }))}
              placeholder="Câu trả lời mẫu — kết luận trước, căn cứ, một nguồn"
              className="w-full rounded-xl border border-white/15 bg-black/20 px-3 py-2 text-sm"
            />
            <button
              type="submit"
              disabled={busy}
              className="btn-gold inline-flex items-center gap-1 rounded-xl px-3 py-2 text-xs font-semibold"
            >
              <BookOpen className="h-3.5 w-3.5" />
              Lưu bài mẫu
            </button>
          </form>
          {samples.map((s) => (
            <article key={s.id} className="rounded-2xl border border-white/10 bg-white/5 p-3">
              <h2 className="m-0 text-sm font-semibold">{s.title}</h2>
              <p className="m-0 mt-1 text-xs text-white/60">{s.suggested_question || s.situation}</p>
            </article>
          ))}
          {!samples.length ? (
            <p className="text-xs text-white/45">Chưa có bài mẫu. Thêm ở đây hoặc đánh dấu lịch sử chat.</p>
          ) : null}
        </section>
      ) : null}

      {tab === 'learn' ? (
        <section className="space-y-3">
          <p className="m-0 text-xs text-white/55">
            Mỗi ngày (0h giờ Việt Nam) hệ thống quét câu hỏi trả lời yếu / không có nguồn, gom thành
            gợi ý. <strong>Không tự sửa prompt</strong> — bạn duyệt rồi mới dạy. Có thể chạy tay.
          </p>
          {superAdmin ? (
            <button
              type="button"
              disabled={busy}
              onClick={runLearn}
              className="inline-flex items-center gap-1 rounded-xl bg-white/10 px-3 py-2 text-xs"
            >
              <Sparkles className="h-3.5 w-3.5" />
              Quét lịch sử ngay
            </button>
          ) : null}
          <p className="m-0 text-[11px] text-white/40">
            Lần quét: {learn?.lastRun ? new Date(learn.lastRun).toLocaleString('vi-VN') : 'chưa'}
            {learn?.stats?.weak != null ? ` · ${learn.stats.weak} câu yếu / ${learn.stats.scanned || 0}` : ''}
          </p>
          {(learn?.suggestions || []).map((s) => (
            <article key={s.id} className="rounded-2xl border border-amber-400/20 bg-amber-500/10 p-3">
              <h2 className="m-0 text-sm font-semibold text-amber-50">{s.title}</h2>
              <p className="m-0 mt-1 text-xs text-amber-50/80">{s.reason}</p>
              {s.question ? <p className="m-0 mt-1 text-xs text-white/70">Ví dụ: {s.question}</p> : null}
              {superAdmin ? (
                <div className="mt-2 flex gap-2">
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => decideLearn(s, true)}
                    className="inline-flex items-center gap-1 rounded-lg bg-emerald-500/30 px-2 py-1 text-[11px]"
                  >
                    <Check className="h-3.5 w-3.5" />
                    Dạy vào kho
                  </button>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => decideLearn(s, false)}
                    className="text-[11px] text-white/55"
                  >
                    Bỏ
                  </button>
                </div>
              ) : null}
            </article>
          ))}
          {!learn?.suggestions?.length ? (
            <p className="text-xs text-white/45">Chưa có gợi ý. Chat thêm hoặc bấm quét lịch sử.</p>
          ) : null}
        </section>
      ) : null}

      <p className="mt-6 text-xs text-white/40">
        Văn phong / TTS:{' '}
        <Link to="/quantri/giong-ai" className="text-[var(--hcc-gold-bright)] underline">
          Giọng AI
        </Link>
        {' · '}
        Model / Pinecone:{' '}
        <Link to="/quantri/bo-nao" className="text-[var(--hcc-gold-bright)] underline">
          Bộ não
        </Link>
      </p>
    </div>
  )
}
