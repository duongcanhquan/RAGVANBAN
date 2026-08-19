import { useCallback, useEffect, useState } from 'react'
import { Lock, LockOpen, PenLine, RotateCcw, Save } from 'lucide-react'
import { Link, useOutletContext } from 'react-router-dom'
import { adminFetch } from '../../lib/adminApi'
import VoiceTalkCard from './VoiceTalkCard'

const TONE = [
  { id: 'formal', label: 'Trang trọng (cán bộ NV)' },
  { id: 'citizen', label: 'Dễ hiểu (học sinh)' },
  { id: 'detailed', label: 'Chi tiết (giảng viên)' },
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
  const [presets, setPresets] = useState([])
  const [defaultHardRules, setDefaultHardRules] = useState('')
  const [rulesUnlocked, setRulesUnlocked] = useState(false)
  const [error, setError] = useState('')
  const [ok, setOk] = useState('')
  const [busy, setBusy] = useState(false)
  const [previewOpen, setPreviewOpen] = useState(false)
  const [preview, setPreview] = useState('')

  const load = useCallback(async () => {
    const res = await adminFetch('/api/quantri/voice')
    const data = await res.json().catch(() => ({}))
    if (!res.ok) throw new Error(data.error || 'Không tải được giọng AI')
    setVoice(data.voice)
    setPresets(data.presets || [])
    setDefaultHardRules(data.defaultHardRules || data.hardRules || '')
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
      setRulesUnlocked(false)
      setOk('Đã lưu giọng AI. Luật cứng luôn gắn đầu câu trả lời.')
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

  async function showPreview() {
    const data = await save(voice)
    if (data?.preview?.lookup) {
      setPreview(data.preview.lookup)
      setPreviewOpen(true)
    }
  }

  function toggleRulesLock() {
    if (rulesUnlocked) {
      setRulesUnlocked(false)
      return
    }
    const okUnlock =
      typeof window === 'undefined' ||
      window.confirm('Mở khóa luật cứng để sửa? Phần này luôn được gắn đầu câu trả lời của AI.')
    if (okUnlock) setRulesUnlocked(true)
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
          Phong cách soạn câu trả lời theo vai trò nhà trường (giảng viên, học sinh, cán bộ nhân viên).
          Luật cứng mặc định khóa; mở khóa mới sửa được.
        </p>
      </header>

      <div className="mb-5">
        <VoiceTalkCard />
      </div>

      <section className="mb-5 rounded-3xl border border-amber-400/20 bg-amber-500/10 p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="m-0 text-sm font-semibold text-amber-100">
            Luật cứng {rulesUnlocked ? '(đang mở — có thể sửa)' : '(khóa)'}
          </h2>
          <div className="flex flex-wrap gap-2">
            {rulesUnlocked ? (
              <button
                type="button"
                disabled={busy}
                onClick={() => patch({ hardRules: defaultHardRules })}
                className="inline-flex min-h-11 items-center gap-1 rounded-full border border-amber-200/30 px-3 text-xs text-amber-100 hover:bg-amber-500/20"
              >
                <RotateCcw className="h-3.5 w-3.5" />
                Mặc định
              </button>
            ) : null}
            <button
              type="button"
              onClick={toggleRulesLock}
              className="inline-flex min-h-11 items-center gap-1.5 rounded-full bg-amber-500/25 px-3 text-xs font-semibold text-amber-50 hover:bg-amber-500/35"
            >
              {rulesUnlocked ? (
                <>
                  <Lock className="h-3.5 w-3.5" />
                  Khóa lại
                </>
              ) : (
                <>
                  <LockOpen className="h-3.5 w-3.5" />
                  Mở khóa để sửa
                </>
              )}
            </button>
          </div>
        </div>
        <textarea
          rows={8}
          readOnly={!rulesUnlocked}
          value={voice.hardRules || ''}
          onChange={(e) => rulesUnlocked && patch({ hardRules: e.target.value })}
          className={`mt-3 w-full rounded-2xl border px-3 py-2 font-mono text-[12px] leading-relaxed text-amber-50 outline-none ${
            rulesUnlocked
              ? 'border-amber-200/40 bg-black/30'
              : 'cursor-not-allowed border-white/10 bg-black/20 opacity-80'
          }`}
        />
        <p className="m-0 mt-2 text-[11px] text-amber-100/70">
          {rulesUnlocked
            ? 'Sửa xong bấm Lưu giọng AI — hệ thống sẽ khóa lại. Luật này luôn gắn đầu prompt.'
            : 'Bấm Mở khóa để sửa. Không tắt được khi AI trả lời, chỉ đổi nội dung khi đã mở.'}
        </p>
      </section>

      <section className="mb-5 rounded-3xl border border-white/10 bg-white/5 p-4">
        <h2 className="m-0 mb-3 text-base font-semibold">Preset vai trò</h2>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
          {presets.map((p) => (
            <button
              key={p.id}
              type="button"
              disabled={busy}
              onClick={() => applyPreset(p.id)}
              className={`min-h-11 rounded-2xl px-3 py-2 text-sm font-medium ${
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
            rows={4}
            value={voice.role}
            onChange={(e) => patch({ role: e.target.value })}
            className="mt-1 min-h-24 w-full rounded-xl border border-white/15 bg-black/20 px-3 py-2 text-sm text-white"
          />
        </Field>
        <div className="space-y-3">
          <Field label="Giọng văn">
            <select
              value={voice.tone}
              onChange={(e) => patch({ tone: e.target.value })}
              className="mt-1 min-h-11 w-full rounded-xl border border-white/15 bg-black/20 px-3 py-2 text-sm"
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
              className="mt-1 min-h-11 w-full rounded-xl border border-white/15 bg-black/20 px-3 py-2 text-sm"
            >
              {LENGTH.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.label}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Temperature (0–0.3, nên 0 để đúng văn bản)">
            <input
              type="number"
              min="0"
              max="0.3"
              step="0.05"
              value={voice.temperature}
              onChange={(e) => patch({ temperature: Number(e.target.value) })}
              className="mt-1 min-h-11 w-full rounded-xl border border-white/15 bg-black/20 px-3 py-2 text-sm"
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
        <Field label="Tư vấn tình huống">
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
            placeholder="Ví dụ: xưng hô Thầy/Cô với giảng viên; em với học sinh…"
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
          className="btn-gold inline-flex min-h-11 items-center gap-2 rounded-2xl px-5 py-3 text-sm font-semibold disabled:opacity-40"
        >
          <Save className="h-4 w-4" />
          {busy ? 'Đang lưu…' : 'Lưu giọng AI'}
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={showPreview}
          className="inline-flex min-h-11 items-center rounded-2xl border border-white/15 bg-white/10 px-4 py-3 text-sm disabled:opacity-40"
        >
          Xem prompt ghép
        </button>
      </div>
    </div>
  )
}
