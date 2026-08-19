import { useCallback, useEffect, useState } from 'react'
import { useOutletContext } from 'react-router-dom'
import { PenLine, Save } from 'lucide-react'
import { adminFetch } from '../../lib/adminApi'

const TONE = [
  { id: 'formal', label: 'Trang trọng' },
  { id: 'citizen', label: 'Gần dân' },
  { id: 'detailed', label: 'Pháp chế chi tiết' },
]

const LENGTH = [
  { id: 'short', label: 'Ngắn' },
  { id: 'medium', label: 'Vừa' },
  { id: 'detailed', label: 'Đầy đủ' },
]

function Field({ label, children }) {
  return (
    <label className="block text-xs text-white/60">
      {label}
      {children}
    </label>
  )
}

export default function QuantriVoice() {
  const { me } = useOutletContext() || {}
  const [voice, setVoice] = useState(null)
  const [hardRules, setHardRules] = useState('')
  const [presets, setPresets] = useState([])
  const [error, setError] = useState('')
  const [ok, setOk] = useState('')
  const [busy, setBusy] = useState(false)
  const [previewOpen, setPreviewOpen] = useState(false)
  const [preview, setPreview] = useState('')
  const [talk, setTalk] = useState(null)
  const [talkOk, setTalkOk] = useState('')

  const load = useCallback(async () => {
    const res = await adminFetch('/api/quantri/voice')
    const data = await res.json().catch(() => ({}))
    if (!res.ok) throw new Error(data.error || 'Không tải được giọng AI')
    setVoice(data.voice)
    setHardRules(data.hardRules || '')
    setPresets(data.presets || [])
    const talkRes = await adminFetch('/api/quantri/voice-talk')
    const talkData = await talkRes.json().catch(() => ({}))
    if (talkRes.ok) setTalk(talkData.talk || talkData)
  }, [])

  useEffect(() => {
    load().catch((e) => setError(e.message))
  }, [load])

  if (me?.role !== 'super_admin') {
    return <p className="p-6 text-sm text-white/70">Chỉ super-admin được cấu hình giọng trả lời.</p>
  }

  function patch(p) {
    setVoice((cur) => ({ ...cur, ...p }))
  }

  async function save(payload) {
    setBusy(true)
    setError('')
    setOk('')
    try {
      const res = await adminFetch('/api/quantri/voice', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok || !data.ok) throw new Error(data.error || 'Không lưu được')
      setVoice(data.voice)
      setOk('Đã lưu giọng AI. Luật cứng vẫn luôn gắn khi trả lời.')
      return data
    } catch (e) {
      setError(e.message)
      return null
    } finally {
      setBusy(false)
    }
  }

  async function applyPreset(id) {
    await save({ preset: id })
  }

  async function saveTalk(next) {
    setBusy(true)
    setError('')
    setTalkOk('')
    try {
      const res = await adminFetch('/api/quantri/voice-talk', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(next),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok || !data.ok) throw new Error(data.error || 'Không lưu được giọng nói')
      setTalk(data.talk)
      setTalkOk(data.talk?.enabled ? 'Đã bật giao tiếp giọng nói trên trang tra cứu.' : 'Đã tắt giọng nói.')
    } catch (e) {
      setError(e.message)
    } finally {
      setBusy(false)
    }
  }

  async function showPreview() {
    const data = await save(voice)
    if (data?.preview?.lookup) {
      setPreview(data.preview.lookup)
      setPreviewOpen(true)
    }
  }

  if (!voice) {
    return <p className="p-6 text-sm text-white/60">{error || 'Đang tải…'}</p>
  }

  return (
    <div className="mx-auto max-w-4xl px-4 py-8 text-slate-100">
      <header className="mb-5">
        <h1 className="m-0 flex items-center gap-2 text-2xl font-semibold">
          <PenLine className="h-6 w-6 text-[var(--hcc-gold-bright)]" />
          Giọng AI
        </h1>
        <p className="m-0 mt-1 text-sm text-white/65">
          Phong cách soạn câu trả lời. Luật chống bịa và bắt buộc nguồn <strong>không tắt được</strong>.
        </p>
      </header>

      {talk ? (
        <section className="mb-5 rounded-3xl border border-white/10 bg-white/5 p-4">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="m-0 text-base font-semibold">Giao tiếp giọng nói</h2>
              <p className="m-0 mt-1 text-xs text-white/55">
                Nói ngay từng câu khi AI đang viết — không đợi hết bài. Ưu tiên Groq / Gemini (token ra sớm).
              </p>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={talk.enabled}
              disabled={busy}
              onClick={() => saveTalk({ ...talk, enabled: !talk.enabled })}
              className={`relative h-6 w-11 shrink-0 rounded-full transition ${
                talk.enabled ? 'bg-emerald-500' : 'bg-white/20'
              }`}
            >
              <span
                className={`absolute top-0.5 h-5 w-5 rounded-full bg-white transition ${
                  talk.enabled ? 'left-5' : 'left-0.5'
                }`}
              />
            </button>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="flex items-center justify-between gap-2 text-sm text-white/75">
              Tự đọc câu trả lời
              <input
                type="checkbox"
                checked={talk.autoSpeak}
                onChange={(e) => setTalk((t) => ({ ...t, autoSpeak: e.target.checked }))}
              />
            </label>
            <label className="flex items-center justify-between gap-2 text-sm text-white/75">
              Ưu tiên AI nhanh (Groq → Gemini → …)
              <input
                type="checkbox"
                checked={talk.preferFastChat}
                onChange={(e) => setTalk((t) => ({ ...t, preferFastChat: e.target.checked }))}
              />
            </label>
            <label className="text-xs text-white/60">
              Ngôn ngữ TTS / mic
              <input
                value={talk.lang}
                onChange={(e) => setTalk((t) => ({ ...t, lang: e.target.value }))}
                className="mt-1 w-full rounded-xl border border-white/15 bg-black/20 px-3 py-2 text-sm text-white"
              />
            </label>
            <label className="text-xs text-white/60">
              Tốc độ đọc ({talk.rate})
              <input
                type="range"
                min="0.7"
                max="1.4"
                step="0.05"
                value={talk.rate}
                onChange={(e) => setTalk((t) => ({ ...t, rate: Number(e.target.value) }))}
                className="mt-2 w-full"
              />
            </label>
          </div>
          <button
            type="button"
            disabled={busy}
            onClick={() => saveTalk(talk)}
            className="mt-3 rounded-xl bg-white/10 px-3 py-2 text-xs disabled:opacity-40"
          >
            Lưu cài đặt giọng nói
          </button>
          {talkOk ? <p className="m-0 mt-2 text-xs text-emerald-200">{talkOk}</p> : null}
        </section>
      ) : null}

      <section className="mb-5 rounded-3xl border border-amber-400/20 bg-amber-500/10 p-4">
        <h2 className="m-0 text-sm font-semibold text-amber-100">Luật cứng (khóa)</h2>
        <pre className="m-0 mt-2 max-h-48 overflow-y-auto whitespace-pre-wrap text-[11px] leading-relaxed text-amber-50/90">
          {hardRules}
        </pre>
      </section>

      <section className="mb-5 rounded-3xl border border-white/10 bg-white/5 p-4">
        <h2 className="m-0 mb-3 text-base font-semibold">Preset</h2>
        <div className="flex flex-wrap gap-2">
          {presets.map((p) => (
            <button
              key={p.id}
              type="button"
              disabled={busy}
              onClick={() => applyPreset(p.id)}
              className={`rounded-full px-3 py-1.5 text-xs font-medium ${
                voice.preset === p.id
                  ? 'bg-[var(--hcc-gold)] text-[#1a1214]'
                  : 'bg-white/10 text-white/80 hover:bg-white/15'
              }`}
            >
              {p.label}
            </button>
          ))}
        </div>
      </section>

      <section className="mb-5 grid gap-3 rounded-3xl border border-white/10 bg-white/5 p-4 sm:grid-cols-2">
        <Field label="Vai trò">
          <textarea
            rows={3}
            value={voice.role}
            onChange={(e) => patch({ role: e.target.value })}
            className="mt-1 w-full rounded-xl border border-white/15 bg-black/20 px-3 py-2 text-sm text-white"
          />
        </Field>
        <div className="space-y-3">
          <Field label="Giọng">
            <select
              value={voice.tone}
              onChange={(e) => patch({ tone: e.target.value })}
              className="mt-1 w-full rounded-xl border border-white/15 bg-black/20 px-3 py-2 text-sm"
            >
              {TONE.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.label}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Độ dài">
            <select
              value={voice.length}
              onChange={(e) => patch({ length: e.target.value })}
              className="mt-1 w-full rounded-xl border border-white/15 bg-black/20 px-3 py-2 text-sm"
            >
              {LENGTH.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.label}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Temperature (0–0.3, pháp lý nên 0)">
            <input
              type="number"
              min="0"
              max="0.3"
              step="0.05"
              value={voice.temperature}
              onChange={(e) => patch({ temperature: Number(e.target.value) })}
              className="mt-1 w-full rounded-xl border border-white/15 bg-black/20 px-3 py-2 text-sm"
            />
          </Field>
        </div>
      </section>

      <section className="mb-5 space-y-3 rounded-3xl border border-white/10 bg-white/5 p-4">
        <h2 className="m-0 text-base font-semibold">Mẫu trả lời</h2>
        <Field label="Tra cứu">
          <textarea
            rows={7}
            value={voice.lookupTemplate}
            onChange={(e) => patch({ lookupTemplate: e.target.value })}
            className="mt-1 w-full rounded-xl border border-white/15 bg-black/20 px-3 py-2 font-mono text-[12px] text-white"
          />
        </Field>
        <Field label="Tư vấn thủ tục">
          <textarea
            rows={7}
            value={voice.adviseTemplate}
            onChange={(e) => patch({ adviseTemplate: e.target.value })}
            className="mt-1 w-full rounded-xl border border-white/15 bg-black/20 px-3 py-2 font-mono text-[12px] text-white"
          />
        </Field>
        <Field label="So sánh / sửa đổi">
          <textarea
            rows={6}
            value={voice.compareTemplate}
            onChange={(e) => patch({ compareTemplate: e.target.value })}
            className="mt-1 w-full rounded-xl border border-white/15 bg-black/20 px-3 py-2 font-mono text-[12px] text-white"
          />
        </Field>
        <Field label="Hướng dẫn thêm (không được trái luật cứng)">
          <textarea
            rows={3}
            value={voice.extraInstructions}
            onChange={(e) => patch({ extraInstructions: e.target.value })}
            placeholder="Ví dụ: xưng hô “Thầy/Cô” với cán bộ nhà trường…"
            className="mt-1 w-full rounded-xl border border-white/15 bg-black/20 px-3 py-2 text-sm text-white"
          />
        </Field>
      </section>

      {previewOpen && preview ? (
        <section className="mb-5 rounded-3xl border border-white/10 bg-black/30 p-4">
          <h2 className="m-0 mb-2 text-sm font-semibold">Prompt tra cứu (đã ghép luật cứng)</h2>
          <pre className="m-0 max-h-64 overflow-y-auto whitespace-pre-wrap text-[11px] text-white/70">
            {preview}
          </pre>
        </section>
      ) : null}

      {error ? <p className="text-sm text-rose-300">{error}</p> : null}
      {ok ? <p className="text-sm text-emerald-200">{ok}</p> : null}

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          disabled={busy}
          onClick={() => save(voice)}
          className="btn-gold inline-flex items-center gap-2 rounded-2xl px-5 py-3 text-sm font-semibold disabled:opacity-40"
        >
          <Save className="h-4 w-4" />
          {busy ? 'Đang lưu…' : 'Lưu giọng AI'}
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={showPreview}
          className="inline-flex items-center rounded-2xl border border-white/15 bg-white/10 px-4 py-3 text-sm disabled:opacity-40"
        >
          Xem prompt ghép
        </button>
      </div>
    </div>
  )
}
