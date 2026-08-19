import { useEffect, useState } from 'react'
import { useOutletContext } from 'react-router-dom'
import { Check, Copy, Plus, Trash2 } from 'lucide-react'
import { adminFetch } from '../../lib/adminApi'
import { publicApiUrl } from '../../lib/apiBase'

function StatusPill({ on, reason, missingLabel }) {
  const label = on ? 'ON' : reason === 'disabled' ? 'TẮT' : missingLabel
  const cls = on
    ? 'bg-emerald-400/20 text-emerald-200'
    : reason === 'disabled'
      ? 'bg-white/10 text-white/50'
      : 'bg-amber-400/20 text-amber-100'
  return (
    <span className={`rounded-full px-2.5 py-0.5 text-[11px] ${cls}`}>{label}</span>
  )
}

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
  const [draft, setDraft] = useState({
    folderUrls: [''],
    categoryId: '',
    label: '',
    isShared: false,
  })
  const [categories, setCategories] = useState([])
  const [syncOut, setSyncOut] = useState('')

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

  const webhookUrl = publicApiUrl('/api/webhooks/n8n')
  const healthUrl = publicApiUrl('/api/webhooks/n8n/health')
  const isLocalWebhook = /localhost|127\.0\.0\.1/i.test(webhookUrl)

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
    const urls = (draft.folderUrls || []).map((s) => s.trim()).filter(Boolean)
    if (!urls.length) {
      setError('Dán ít nhất một link thư mục Drive')
      return
    }
    setBusy(true)
    setError('')
    try {
      const errors = []
      for (const folderUrl of urls) {
        const res = await adminFetch('/api/quantri/integrations/drive-sources', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            folderUrl,
            categoryId: draft.categoryId || null,
            label: draft.label,
            isShared: draft.isShared,
          }),
        })
        const j = await res.json().catch(() => ({}))
        if (!res.ok) errors.push(j.error || folderUrl)
      }
      setDraft({ folderUrls: [''], categoryId: '', label: '', isShared: false })
      await load()
      if (errors.length) throw new Error(errors.join(' · '))
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
          <StatusPill
            on={data.drive.on}
            reason={data.drive.reason}
            missingLabel="CHƯA KEY"
          />
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

        <h3 className="m-0 mb-1 text-sm font-semibold">Nguồn Drive theo cán bộ + chuyên mục mặc định</h3>
        <p className="m-0 mb-3 text-xs text-white/60">
          Mỗi <strong>nguồn Drive</strong> là 1 thư mục Drive của 1 cán bộ. Khi App quét thư mục này,
          <strong> file mới</strong> sẽ tự được gắn vào <strong>chuyên mục mặc định</strong> (nếu bạn chọn).
        </p>
        <form onSubmit={addFolder} className="mb-3 grid gap-2 sm:grid-cols-2">
          <input
            value={draft.label}
            onChange={(e) => setDraft({ ...draft, label: e.target.value })}
            placeholder="Tên gợi nhớ (tên cán bộ/đơn vị) — tuỳ chọn"
            className="rounded-xl border border-white/15 bg-black/20 px-3 py-2 text-sm"
          />
          <input
            value={draft.folderUrls[0] || ''}
            onChange={(e) =>
              setDraft({
                ...draft,
                folderUrls: [e.target.value, ...(draft.folderUrls || []).slice(1)],
              })
            }
            placeholder="https://drive.google.com/drive/folders/...."
            className="rounded-xl border border-white/15 bg-black/20 px-3 py-2 text-sm sm:col-span-2"
          />
          {(draft.folderUrls || []).slice(1).map((url, i) => (
            <div key={i + 1} className="flex gap-2 sm:col-span-2">
              <input
                value={url}
                onChange={(e) =>
                  setDraft({
                    ...draft,
                    folderUrls: draft.folderUrls.map((x, idx) => (idx === i + 1 ? e.target.value : x)),
                  })
                }
                placeholder="Link thư mục Drive thêm"
                className="min-w-0 flex-1 rounded-xl border border-white/15 bg-black/20 px-3 py-2 text-sm"
              />
              <button
                type="button"
                onClick={() =>
                  setDraft({
                    ...draft,
                    folderUrls: draft.folderUrls.filter((_, idx) => idx !== i + 1),
                  })
                }
                className="rounded-xl bg-white/10 px-3 text-xs text-white/70"
              >
                Bỏ
              </button>
            </div>
          ))}
          <button
            type="button"
            onClick={() => setDraft({ ...draft, folderUrls: [...(draft.folderUrls || ['']), ''] })}
            className="inline-flex items-center justify-center gap-1 rounded-xl bg-white/10 px-3 py-2 text-xs sm:col-span-2"
          >
            <Plus className="h-3.5 w-3.5" />
            Thêm link thư mục
          </button>
          <select
            value={draft.categoryId}
            onChange={(e) => setDraft({ ...draft, categoryId: e.target.value })}
            required={!isSuper}
            className="rounded-xl border border-white/15 bg-black/20 px-3 py-2 text-sm"
          >
            {isSuper ? <option value="">— (tuỳ chọn) Không gắn chuyên mục —</option> : null}
            {allowedCats.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
          <p className="sm:col-span-2 m-0 -mt-1 text-[11px] text-white/45">
            Chuyên mục này chỉ là mặc định để tự gắn khi số hóa từ thư mục Drive. Bạn vẫn có thể đổi chuyên mục tài liệu sau khi đã vào danh mục.
          </p>
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
            Thêm nguồn Drive
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
          <h2 className="m-0 text-lg font-semibold">Tự số hóa file Drive mới</h2>
          <StatusPill on={data.drive.on} reason={data.drive.reason} missingLabel="CHƯA KEY" />
        </div>
        <p className="m-0 mb-4 text-sm text-white/65">
          App tự quét thư mục đã thêm ở trên, chỉ số hóa <strong>file chưa có trong kho</strong>. Vercel cron
          mỗi 15 phút (gói Pro). Công tắc n8n <strong>không</strong> tự tìm file — n8n chỉ là webhook tùy
          chọn bên ngoài.
        </p>

        {isLocalWebhook ? (
          <p className="mb-4 rounded-xl bg-amber-500/20 px-3 py-2 text-xs text-amber-100">
            URL đang là máy local. Mở trang này trên domain Vercel (hoặc custom domain) rồi copy URL,
            không dùng 127.0.0.1 trên n8n Cloud.
          </p>
        ) : null}

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
          <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-white/10 bg-black/20 px-3 py-2">
            <span className="text-white/55">Health</span>
            <code className="min-w-0 flex-1 break-all text-xs">{healthUrl}</code>
            <CopyBtn text={healthUrl} />
          </div>
          <ol className="m-0 list-decimal space-y-1 pl-5 text-xs text-white/70">
            <li>Thêm thư mục Drive ở khối trên (đã share cho service account).</li>
            <li>Bấm «Đồng bộ Drive ngay» — phải ra file mới, không phải 8 file cũ lặp lại.</li>
            <li>
              Cron Vercel <code className="text-white/90">/api/cron/drive-sync</code> mỗi 15 phút. Đặt{' '}
              <code className="text-white/90">CRON_SECRET</code> trên Vercel nếu muốn gọi tay.
            </li>
            <li>
              n8n Cloud (không bắt buộc): bật webhook + secret, import{' '}
              <code className="text-white/90">docs/n8n/ragvanban-sync.workflow.json</code>, dán URL production,
              Folder ID, bật <strong>Active</strong>. File JSON mặc định tắt nên import xong chưa chạy.
            </li>
          </ol>
          {isSuper ? (
            <div className="mt-3 flex flex-wrap gap-2">
              <button
                type="button"
                disabled={busy}
                onClick={async () => {
                  setBusy(true)
                  setError('')
                  setSyncOut('')
                  try {
                    const res = await adminFetch('/api/quantri/integrations/n8n-ping', { method: 'POST' })
                    const body = await res.json().catch(() => ({}))
                    if (!res.ok || !body.ok) throw new Error(body.error || 'Cổng webhook chưa sẵn sàng')
                    setSyncOut(body.hint || 'Cổng webhook sẵn sàng.')
                  } catch (e) {
                    setError(e.message)
                  } finally {
                    setBusy(false)
                  }
                }}
                className="rounded-full bg-white/10 px-3 py-1.5 text-xs"
              >
                Thử cổng webhook
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={async () => {
                  setBusy(true)
                  setError('')
                  setSyncOut('Đang đọc thư mục Drive…')
                  try {
                    const res = await adminFetch('/api/quantri/integrations/drive-sync', {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({ limit: 8 }),
                    })
                    const body = await res.json().catch(() => ({}))
                    if (!res.ok) throw new Error(body.error || 'Đồng bộ thất bại')
                    const okN = (body.results || []).filter((r) => r.ok).length
                    const failN = body.failed || 0
                    const skipped = body.skipped || 0
                    const pending = body.pending || 0
                    setSyncOut(
                      pending === 0 && okN === 0 && !failN
                        ? `Không có file mới. Đã bỏ qua ${skipped} file đã số hóa (tổng ${body.totalListed || 0} trong thư mục).`
                        : `File mới: thành công ${okN} · lỗi ${failN} · còn chờ ${Math.max(0, pending - okN - failN)} · đã có trong kho ${skipped}`
                    )
                    if (failN && !okN) setError(body.error || 'Không số hóa được file nào')
                  } catch (e) {
                    setSyncOut('')
                    setError(e.message)
                  } finally {
                    setBusy(false)
                  }
                }}
                className="rounded-full bg-[var(--hcc-red)] px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-40"
              >
                Đồng bộ Drive ngay
              </button>
            </div>
          ) : null}
          {syncOut ? <p className="m-0 mt-2 text-xs text-emerald-100/80">{syncOut}</p> : null}
          <div className="rounded-2xl border border-white/10 bg-black/20 px-3 py-2">
            <p className="m-0 mb-1 text-xs text-white/55">Body khi có file mới</p>
            <pre className="m-0 overflow-x-auto text-[11px] text-white/80">{`{ "fileId": "{{ $json.id }}" }`}</pre>
          </div>
        </div>
      </section>

      <section className="rounded-2xl border border-white/10 bg-black/20 p-4">
        <div className="mb-2 flex items-center justify-between gap-2">
          <h2 className="m-0 text-lg font-semibold">Cloudflare R2</h2>
          <StatusPill
            on={Boolean(data.r2?.configured)}
            reason={data.r2?.configured ? 'ok' : data.r2?.hasCredentials ? 'missing_url' : 'missing_key'}
            missingLabel={data.r2?.hasCredentials ? 'THIẾU URL' : 'CHƯA KEY'}
          />
        </div>
        <p className="m-0 mb-3 text-sm text-white/60">
          File upload tay lưu bản gốc trên R2. Key đặt trong .env / Vercel: R2_ACCOUNT_ID,
          R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET, R2_PUBLIC_BASE_URL.
        </p>
        {data.r2?.bucket ? (
          <p className="m-0 mb-2 text-xs text-white/50">
            Bucket {data.r2.bucket}
            {data.r2.publicBaseUrl ? ` · ${data.r2.publicBaseUrl}` : ''}
          </p>
        ) : null}
        {isSuper ? (
          <button
            type="button"
            disabled={busy}
            onClick={async () => {
              setBusy(true)
              setError('')
              try {
                const res = await adminFetch('/api/quantri/integrations/r2-ping', { method: 'POST' })
                const body = await res.json().catch(() => ({}))
                if (!res.ok || !body.ok) throw new Error(body.error || 'Thử ghi R2 thất bại')
                setError('')
                alert('R2 ghi/xóa thử thành công.')
              } catch (e) {
                setError(e.message)
              } finally {
                setBusy(false)
              }
            }}
            className="rounded-full bg-white/10 px-3 py-1.5 text-xs"
          >
            Thử ghi R2
          </button>
        ) : null}
      </section>

      <p className="m-0 text-[11px] text-white/40">
        Drive folder ID toàn cục (GOOGLE_DRIVE_FOLDER_ID) chỉ còn là dự phòng khi chưa thêm nguồn trong danh sách trên.
      </p>
    </div>
  )
}
