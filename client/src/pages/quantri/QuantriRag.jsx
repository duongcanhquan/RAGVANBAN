import { useCallback, useEffect, useState } from 'react'
import { useOutletContext } from 'react-router-dom'
import { RefreshCw, Save, Search } from 'lucide-react'
import { adminFetch } from '../../lib/adminApi'

function Field({ label, children }) {
  return (
    <label className="block text-xs text-white/60">
      {label}
      {children}
    </label>
  )
}

const inputCls =
  'mt-1 w-full rounded-xl border border-white/15 bg-white/10 px-3 py-2 text-sm text-white outline-none'

const MB = 1024 * 1024
const UPLOAD_MB_MIN = 1
const UPLOAD_MB_MAX = 512
const UPLOAD_MB_PRESETS = [40, 80, 200, 512]

function uploadMb(rag) {
  const bytes = Number(rag?.uploadMaxBytes) || 40 * MB
  return Math.min(UPLOAD_MB_MAX, Math.max(UPLOAD_MB_MIN, Math.round(bytes / MB)))
}

export default function QuantriRag() {
  const { me } = useOutletContext() || {}
  const [rag, setRag] = useState(null)
  const [r2, setR2] = useState(null)
  const [error, setError] = useState('')
  const [ok, setOk] = useState('')
  const [busy, setBusy] = useState(false)
  const [reindexOut, setReindexOut] = useState(null)

  const load = useCallback(async () => {
    const res = await adminFetch('/api/quantri/rag')
    const data = await res.json().catch(() => ({}))
    if (!res.ok) throw new Error(data.error || 'Không tải được cấu hình RAG')
    setRag(data.rag)
    setR2(data.r2 || null)
  }, [])

  useEffect(() => {
    load().catch((e) => setError(e.message))
  }, [load])

  if (me?.role !== 'super_admin') {
    return <p className="p-6 text-sm text-white/70">Chỉ super-admin được cấu hình RAG & số hóa.</p>
  }

  function patch(p) {
    setRag((cur) => ({ ...cur, ...p }))
  }

  async function save() {
    setBusy(true)
    setError('')
    setOk('')
    try {
      const res = await adminFetch('/api/quantri/rag', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(rag),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok || !data.ok) throw new Error(data.error || 'Không lưu được')
      setRag(data.rag)
      setOk('Đã lưu cấu hình RAG. Câu hỏi mới sẽ dùng topK / chunk này.')
    } catch (e) {
      setError(e.message)
    } finally {
      setBusy(false)
    }
  }

  async function reindexAll() {
    if (
      !window.confirm(
        'Số hóa lại kho từ file gốc (R2/Drive), từng lô 40 tài liệu cho đến hết? Việc này ghi đè vector cũ.'
      )
    ) {
      return
    }
    setBusy(true)
    setError('')
    setOk('')
    setReindexOut(null)
    try {
      const allResults = []
      let offset = 0
      let failed = 0
      let processed = 0
      let last = null
      do {
        const res = await adminFetch('/api/quantri/rag/reindex-all', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ limit: 40, offset }),
        })
        const data = await res.json().catch(() => ({}))
        if (!res.ok) throw new Error(data.error || 'Số hóa lại thất bại')
        last = data
        allResults.push(...(data.results || []))
        failed += Number(data.failed || 0)
        processed += Number(data.processed || 0)
        if (!data.hasMore) break
        offset = data.nextOffset || offset + 40
      } while (offset < 2000)
      const data = { ...last, results: allResults, processed, failed }
      setReindexOut(data)
      setOk(
        data.failed
          ? `Xong ${data.processed} file, ${data.failed} lỗi.`
          : `Đã số hóa lại ${data.processed} tài liệu.`
      )
    } catch (e) {
      setError(e.message)
    } finally {
      setBusy(false)
    }
  }

  if (!rag) {
    return <p className="p-6 text-sm text-white/60">{error || 'Đang tải…'}</p>
  }

  return (
    <div className="mx-auto max-w-3xl px-4 py-8 text-slate-100">
      <header className="mb-6 flex items-start gap-3">
        <Search className="mt-1 h-6 w-6 text-[var(--hcc-gold-bright)]" />
        <div>
          <h1 className="m-0 text-2xl font-semibold">RAG & số hóa</h1>
          <p className="m-0 mt-1 text-sm text-white/65">
            Top-K, cắt đoạn, chỉ còn hiệu lực, OCR. Số hóa lại kho sau khi đổi chunk hoặc sửa
            pipeline.
          </p>
        </div>
      </header>

      {error ? <p className="mb-3 rounded-xl bg-red-500/20 px-3 py-2 text-sm">{error}</p> : null}
      {ok ? <p className="mb-3 rounded-xl bg-emerald-500/15 px-3 py-2 text-sm text-emerald-100">{ok}</p> : null}

      <section className="mb-5 rounded-2xl border border-white/10 bg-black/25 p-4">
        <h2 className="m-0 mb-3 text-sm font-semibold">Truy xuất</h2>
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="Top-K vector">
            <input
              className={inputCls}
              type="number"
              min={4}
              max={40}
              value={rag.topK}
              onChange={(e) => patch({ topK: e.target.value })}
            />
          </Field>
          <Field label="Đoạn / văn bản">
            <input
              className={inputCls}
              type="number"
              min={1}
              max={12}
              value={rag.maxPerDoc}
              onChange={(e) => patch({ maxPerDoc: e.target.value })}
            />
          </Field>
          <Field label="Tổng đoạn đưa vào prompt">
            <input
              className={inputCls}
              type="number"
              min={4}
              max={32}
              value={rag.maxTotal}
              onChange={(e) => patch({ maxTotal: e.target.value })}
            />
          </Field>
        </div>
        <label className="mt-3 flex items-center gap-2 text-sm text-white/80">
          <input
            type="checkbox"
            checked={rag.onlyActiveDefault !== false}
            onChange={(e) => patch({ onlyActiveDefault: e.target.checked })}
          />
          Mặc định chỉ lấy văn bản còn hiệu lực (trừ khi câu hỏi hỏi hết hiệu lực)
        </label>
        <label className="mt-2 flex items-center gap-2 text-sm text-white/80">
          <input
            type="checkbox"
            checked={rag.skipIntentLlmWhenAnchored !== false}
            onChange={(e) => patch({ skipIntentLlmWhenAnchored: e.target.checked })}
          />
          Bỏ bước LLM phân loại khi câu hỏi đã có số hiệu / Điều
        </label>
      </section>

      <section className="mb-5 rounded-2xl border border-amber-400/25 bg-black/25 p-4">
        <h2 className="m-0 mb-1 text-sm font-semibold">Dung lượng file</h2>
        <p className="m-0 mb-3 text-[11px] text-white/50">
          Đây là mức <strong className="font-medium text-white/70">tối đa</strong>. File 10 KB, 200 KB, 900
          KB vẫn tải bình thường. Mặc định 40 MB.
        </p>
        <Field label="Dung lượng tối đa (MB)">
          <input
            className={inputCls}
            type="number"
            min={UPLOAD_MB_MIN}
            max={UPLOAD_MB_MAX}
            step={1}
            value={uploadMb(rag)}
            onChange={(e) => {
              const mb = Math.min(
                UPLOAD_MB_MAX,
                Math.max(UPLOAD_MB_MIN, Number(e.target.value) || 40)
              )
              patch({ uploadMaxBytes: mb * MB })
            }}
          />
        </Field>
        <div className="mt-3 flex flex-wrap gap-2">
          {UPLOAD_MB_PRESETS.map((mb) => (
            <button
              key={mb}
              type="button"
              onClick={() => patch({ uploadMaxBytes: mb * MB })}
              className={`rounded-lg px-2.5 py-1 text-xs ${
                uploadMb(rag) === mb
                  ? 'bg-amber-400/90 text-black'
                  : 'bg-white/10 text-white/80 hover:bg-white/15'
              }`}
            >
              {mb} MB
            </button>
          ))}
        </div>
        <p className="m-0 mt-3 text-[11px] text-white/45">
          Trên website, file trên khoảng 4,5 MB không gửi trực tiếp được — cán bộ sẽ được hướng dẫn dán
          link Google Drive (không cần biết kỹ thuật). Drive vẫn tôn trọng mức tối đa ở trên.
        </p>
      </section>

      <section className="mb-5 rounded-2xl border border-white/10 bg-black/25 p-4">
        <h2 className="m-0 mb-3 text-sm font-semibold">Số hóa</h2>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Độ dài chunk">
            <input
              className={inputCls}
              type="number"
              min={400}
              max={4000}
              value={rag.chunkSize}
              onChange={(e) => patch({ chunkSize: e.target.value })}
            />
          </Field>
          <Field label="Overlap">
            <input
              className={inputCls}
              type="number"
              min={0}
              max={800}
              value={rag.chunkOverlap}
              onChange={(e) => patch({ chunkOverlap: e.target.value })}
            />
          </Field>
          <Field label="OCR (Tesseract)">
            <input
              className={inputCls}
              value={rag.ocrLangs}
              onChange={(e) => patch({ ocrLangs: e.target.value })}
            />
          </Field>
        </div>
        <p className="m-0 mt-3 text-[11px] text-white/45">
          Tài liệu số hóa trước khi có cắt Điều/Khoản cần bấm số hóa lại để vector khớp pipeline mới.
        </p>
        <button
          type="button"
          disabled={busy}
          onClick={reindexAll}
          className="mt-3 inline-flex items-center gap-1.5 rounded-xl bg-white/10 px-3 py-2 text-sm disabled:opacity-50"
        >
          <RefreshCw className="h-4 w-4" />
          Số hóa lại toàn bộ kho
        </button>
        {reindexOut?.results?.length ? (
          <ul className="mt-3 max-h-40 list-none overflow-y-auto p-0 text-[11px] text-white/55">
            {reindexOut.results.map((r) => (
              <li key={r.id} className="border-t border-white/5 py-1">
                {r.ok ? 'OK' : 'Lỗi'} · {r.fileName}
                {r.error ? ` — ${r.error}` : ''}
              </li>
            ))}
          </ul>
        ) : null}
      </section>

      <section className="mb-5 rounded-2xl border border-white/10 bg-black/25 p-4">
        <h2 className="m-0 mb-3 text-sm font-semibold">Cảnh báo pháp lý (chat)</h2>
        <textarea
          className={`${inputCls} min-h-[72px]`}
          value={rag.disclaimer}
          onChange={(e) => patch({ disclaimer: e.target.value })}
        />
        {r2 ? (
          <p className="m-0 mt-3 text-[11px] text-white/45">
            R2: {r2.configured ? `ON · ${r2.bucket}` : r2.hasCredentials ? 'có key, thiếu URL công khai' : 'chưa cấu hình'}
            {r2.publicBaseUrl ? ` · ${r2.publicBaseUrl}` : ''}
          </p>
        ) : null}
      </section>

      <button
        type="button"
        disabled={busy}
        onClick={save}
        className="inline-flex items-center gap-1.5 rounded-xl bg-[var(--hcc-red)] px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50"
      >
        <Save className="h-4 w-4" />
        Lưu cấu hình
      </button>
    </div>
  )
}
