import { useEffect, useState } from 'react'
import { useOutletContext } from 'react-router-dom'
import { Check, Copy, Plus, Trash2 } from 'lucide-react'
import { adminFetch } from '../../lib/adminApi'

function Toggle({ on, onChange, disabled }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      disabled={disabled}
      onClick={() => onChange(!on)}
      className={`relative h-6 w-11 shrink-0 rounded-full transition ${
        on ? 'bg-emerald-500' : 'bg-white/20'
      } disabled:opacity-40`}
    >
      <span
        className={`absolute top-0.5 h-5 w-5 rounded-full bg-white transition ${
          on ? 'left-5' : 'left-0.5'
        }`}
      />
    </button>
  )
}

function CopyBtn({ text }) {
  const [ok, setOk] = useState(false)
  return (
    <button
      type="button"
      disabled={!text}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text)
          setOk(true)
          setTimeout(() => setOk(false), 1500)
        } catch {
          /* ignore */
        }
      }}
      className="inline-flex items-center gap-1 rounded-full bg-white/10 px-2.5 py-1 text-[11px] disabled:opacity-40"
    >
      {ok ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
      {ok ? 'Đã copy' : 'Copy'}
    </button>
  )
}

export default function QuantriIntegrations() {
  const { me } = useOutletContext()
  const isSuper = me?.role === 'super_admin'
  const [data, setData] = useState(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [saJson, setSaJson] = useState('')
  const [draft, setDraft] = useState({ folderUrl: '', categoryId: '', label: '', isShared: false })
  const [categories, setCategories] = useState([])

  async function load() {
    const [iRes, cRes] = await Promise.all([
      adminFetch('/api/quantri/integrations'),
      adminFetch('/api/quantri/categories'),
    ])
    const integ = await iRes.json().catch(() => ({}))
    const cats = await cRes.json().catch(() => ({}))
    if (!iRes.ok) throw new Error(integ.error || 'Không tải được tích hợp')
    setData(integ)
    setCategories(cats.items || [])
  }

  useEffect(() => {
    load().catch((e) => setError(e.message))
  }, [])

  const webhookUrl =
    typeof window !== 'undefined' ? `${window.location.origin}/api/webhooks/n8n` : '/api/webhooks/n8n'

  async function patchFlags(patch) {
    setBusy(true)
    setError('')
    try {
      const res = await adminFetch('/api/quantri/integrations/flags', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      })
      const j = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(j.error || 'Không lưu được')
      await load()
    } catch (e) {
      setError(e.message)
    } finally {
      setBusy(false)
    }
  }

  async function saveSa(e) {
    e.preventDefault()
    setBusy(true)
    setError('')
    try {
      const res = await adminFetch('/api/quantri/integrations/google-sa', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ json: saJson }),
      })
      const j = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(j.error || 'JSON không hợp lệ')
      setSaJson('')
      await load()
    } catch (e) {
      setError(e.message)
    } finally {
      setBusy(false)
    }
  }

  async function makeSecret() {
    setBusy(true)
    setError('')
    try {
      const res = await adminFetch('/api/quantri/integrations/n8n-secret', { method: 'POST' })
      const j = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(j.error || 'Không tạo secret')
      await load()
    } catch (e) {
      setError(e.message)
    } finally {
      setBusy(false)
    }
  }

  async function addFolder(e) {
    e.preventDefault()
    setBusy(true)
    setError('')
    try {
      const res = await adminFetch('/api/quantri/integrations/drive-sources', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          folderUrl: draft.folderUrl,
          categoryId: draft.categoryId || null,
          label: draft.label,
          isShared: draft.isShared,
        }),
      })
      const j = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(j.error || 'Không thêm thư mục')
      setDraft({ folderUrl: '', categoryId: '', label: '', isShared: false })
      await load()
    } catch (e) {
      setError(e.message)
    } finally {
      setBusy(false)
    }
  }

  async function removeFolder(id) {
    if (!window.confirm('Xóa nguồn Drive này?')) return
    const res = await adminFetch(`/api/quantri/integrations/drive-sources/${id}`, { method: 'DELETE' })
    if (!res.ok) {
      const j = await res.json().catch(() => ({}))
      setError(j.error || 'Không xóa được')
      return
    }
    await load()
  }

  const allowedCats = isSuper
    ? categories
    : categories.filter((c) => (me?.allowedCategoryIds || []).includes(c.id))

  const catLabel = (id) => {
    const c = categories.find((x) => x.id === id)
    return c?.name || 'Chưa gắn chuyên mục'
  }

  if (!data) {
    return <p className="text-sm text-white/60">{error || 'Đang tải…'}</p>
  }

  return (
    <div className="space-y-8">
      {error ? <p className="text-sm text-red-200">{error}</p> : null}

      <section className="rounded-3xl border border-white/10 bg-white/5 p-5">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h2 className="m-0 text-lg font-semibold">Google Drive</h2>
          <span
            className={`rounded-full px-2.5 py-0.5 text-[11px] ${
              data.drive.hasKey && data.drive.enabled
                ? 'bg-emerald-400/20 text-emerald-200'
                : 'bg-white/10 text-white/50'
            }`}
          >
            {data.drive.hasKey && data.drive.enabled ? 'ON' : 'OFF'}
          </span>
        </div>
        <p className="m-0 mb-4 text-sm text-white/65">
          Một tài khoản máy (service account) dùng chung cho cả trường. Mỗi cán bộ tạo thư mục Drive của
          phần mình, chia sẻ Viewer cho email bên dưới, rồi dán link thư mục + chọn chuyên mục.
        </p>

        {isSuper ? (
          <div className="mb-4 flex items-center justify-between gap-3 rounded-2xl border border-white/10 bg-black/20 px-3 py-2">
            <span className="text-sm">Bật đọc Drive (file riêng / thư mục đã share)</span>
            <Toggle
              on={data.drive.enabled}
              disabled={busy}
              onChange={(v) => patchFlags({ driveEnabled: v })}
            />
          </div>
        ) : null}

        <ol className="m-0 mb-4 list-decimal space-y-2 pl-5 text-sm text-white/75">
          <li>
            Super-admin vào{' '}
            <a
              className="text-[var(--hcc-gold-bright)] underline"
              href="https://console.cloud.google.com/"
              target="_blank"
              rel="noreferrer"
            >
              Google Cloud Console
            </a>{' '}
            → tạo project → bật <strong>Google Drive API</strong> → IAM → Service accounts → Create → Keys
            → JSON.
          </li>
          <li>Dán nguyên nội dung file JSON vào ô dưới (chỉ làm một lần). Không đưa file này cho cán bộ khác.</li>
          <li>
            Mỗi người: trên Drive, Share thư mục với email service account (quyền Viewer) → copy link thư
            mục (dạng <code className="text-white/90">drive.google.com/drive/folders/...</code>).
          </li>
        </ol>

        {data.drive.email ? (
          <div className="mb-4 flex flex-wrap items-center gap-2 rounded-2xl border border-emerald-400/20 bg-emerald-400/10 px-3 py-2 text-sm">
            <span className="text-white/70">Share thư mục với:</span>
            <code className="break-all text-emerald-100">{data.drive.email}</code>
            <CopyBtn text={data.drive.email} />
          </div>
        ) : (
          <p className="mb-4 text-sm text-amber-200">Chưa có service account — super-admin dán JSON bên dưới.</p>
        )}

        {isSuper ? (
          <form onSubmit={saveSa} className="mb-5 space-y-2">
            <textarea
              rows={5}
              value={saJson}
              onChange={(e) => setSaJson(e.target.value)}
              placeholder='{"type":"service_account","project_id":"...","private_key":"...","client_email":"..."}'
              className="w-full rounded-2xl border border-white/15 bg-black/20 px-3 py-2 font-mono text-xs"
            />
            <button
              type="submit"
              disabled={busy || !saJson.trim()}
              className="rounded-xl bg-[var(--hcc-red)] px-4 py-2 text-sm font-semibold disabled:opacity-40"
            >
              Lưu JSON (một lần)
            </button>
          </form>
        ) : null}

        <h3 className="m-0 mb-2 text-sm font-semibold">Thư mục Drive theo người / chuyên mục</h3>
        <form onSubmit={addFolder} className="mb-3 grid gap-2 sm:grid-cols-2">
          <input
            value={draft.label}
            onChange={(e) => setDraft({ ...draft, label: e.target.value })}
            placeholder="Tên gợi nhớ (CCCD của Phòng HC)"
            className="rounded-xl border border-white/15 bg-black/20 px-3 py-2 text-sm"
          />
          <input
            required
            value={draft.folderUrl}
            onChange={(e) => setDraft({ ...draft, folderUrl: e.target.value })}
            placeholder="https://drive.google.com/drive/folders/...."
            className="rounded-xl border border-white/15 bg-black/20 px-3 py-2 text-sm sm:col-span-2"
          />
          <select
            value={draft.categoryId}
            onChange={(e) => setDraft({ ...draft, categoryId: e.target.value })}
            className="rounded-xl border border-white/15 bg-black/20 px-3 py-2 text-sm"
          >
            <option value="">— Gắn chuyên mục khi có file mới —</option>
            {allowedCats.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
          {isSuper ? (
            <label className="flex items-center gap-2 text-xs text-white/70">
              <input
                type="checkbox"
                checked={draft.isShared}
                onChange={(e) => setDraft({ ...draft, isShared: e.target.checked })}
              />
              Thư mục chung (mọi cán bộ dùng)
            </label>
          ) : (
            <span />
          )}
          <button
            type="submit"
            disabled={busy}
            className="inline-flex items-center justify-center gap-1 rounded-xl bg-[var(--hcc-red)] px-3 py-2 text-sm font-semibold sm:col-span-2 disabled:opacity-40"
          >
            <Plus className="h-4 w-4" />
            Thêm thư mục
          </button>
        </form>

        <ul className="m-0 list-none space-y-2 p-0">
          {(data.sources || []).map((s) => (
            <li
              key={s.id}
              className="flex flex-wrap items-center gap-2 rounded-2xl border border-white/10 bg-black/20 px-3 py-2 text-sm"
            >
              <span className="font-medium">{s.label || 'Thư mục Drive'}</span>
              <span className="text-white/45">{s.isShared ? 'Chung' : s.email}</span>
              <span className="min-w-0 flex-1 truncate text-xs text-white/50">{s.folderUrl}</span>
              <span className="text-[11px] text-white/60">{catLabel(s.categoryId)}</span>
              <CopyBtn text={s.folderUrl} />
              <button
                type="button"
                onClick={() => removeFolder(s.id)}
                className="rounded-full bg-red-500/20 p-1.5 text-red-100"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </li>
          ))}
        </ul>
      </section>

      <section className="rounded-3xl border border-white/10 bg-white/5 p-5">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h2 className="m-0 text-lg font-semibold">n8n</h2>
          <span
            className={`rounded-full px-2.5 py-0.5 text-[11px] ${
              data.n8n.enabled && data.n8n.secretConfigured
                ? 'bg-emerald-400/20 text-emerald-200'
                : 'bg-white/10 text-white/50'
            }`}
          >
            {data.n8n.enabled && data.n8n.secretConfigured ? 'ON' : 'OFF'}
          </span>
        </div>
        <p className="m-0 mb-4 text-sm text-white/65">
          Khi có file mới trên Drive, n8n chỉ việc gọi webhook này. Không cần điền Folder ID trên server.
        </p>

        {isSuper ? (
          <div className="mb-4 flex items-center justify-between gap-3 rounded-2xl border border-white/10 bg-black/20 px-3 py-2">
            <span className="text-sm">Bật webhook n8n</span>
            <Toggle on={data.n8n.enabled} disabled={busy} onChange={(v) => patchFlags({ n8nEnabled: v })} />
          </div>
        ) : null}

        <div className="space-y-3 text-sm">
          <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-white/10 bg-black/20 px-3 py-2">
            <span className="text-white/55">URL</span>
            <code className="min-w-0 flex-1 break-all text-xs">{webhookUrl}</code>
            <CopyBtn text={webhookUrl} />
          </div>
          <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-white/10 bg-black/20 px-3 py-2">
            <span className="text-white/55">Header</span>
            <code className="text-xs">X-N8N-Secret</code>
            {data.n8n.secret ? (
              <>
                <code className="min-w-0 flex-1 truncate text-xs">{data.n8n.secret}</code>
                <CopyBtn text={data.n8n.secret} />
              </>
            ) : (
              <span className="flex-1 text-xs text-white/50">
                {isSuper ? 'Chưa có secret' : 'Super-admin tạo secret rồi gửi cho bạn'}
              </span>
            )}
            {isSuper ? (
              <button
                type="button"
                disabled={busy}
                onClick={makeSecret}
                className="rounded-full bg-white/10 px-2.5 py-1 text-[11px]"
              >
                {data.n8n.secretConfigured ? 'Tạo lại' : 'Tạo secret'}
              </button>
            ) : null}
          </div>
          <div className="rounded-2xl border border-white/10 bg-black/20 px-3 py-2">
            <p className="m-0 mb-1 text-xs text-white/55">Body mẫu (HTTP Request node)</p>
            <pre className="m-0 overflow-x-auto text-[11px] text-white/80">{`{ "fileId": "{{ $json.id }}" }`}</pre>
          </div>
        </div>
      </section>

      <p className="m-0 text-[11px] text-white/40">
        R2 (file upload tay): {data.r2 ? 'ON' : 'OFF — cấu hình trên Vercel nếu cần lưu bản gốc'}
      </p>
    </div>
  )
}
