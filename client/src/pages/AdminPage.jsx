import { useCallback, useEffect, useRef, useState } from 'react'
import { useOutletContext } from 'react-router-dom'
import {
  Cloud,
  FileText,
  FolderSync,
  Globe,
  MessageSquareText,
  Sparkles,
  Type,
  UploadCloud,
  Webhook,
} from 'lucide-react'
import logo from '../assets/hcc-logo.jpg'
import { adminFetch } from '../lib/adminApi'

const ALLOWED_RE =
  /\.(pdf|doc|docx|ppt|pptx|png|jpe?g|webp|gif|bmp|tiff?|txt|md|csv)$/i

function errorFromResponseBody(text, status) {
  const raw = String(text || '').trim()
  if (!raw) return `HTTP ${status}`
  try {
    const j = JSON.parse(raw)
    return j.error || j.message || raw
  } catch {
    return raw.length > 280 ? `${raw.slice(0, 280)}…` : raw
  }
}

/**
 * Admin Dashboard — luxury glass · đỏ–vàng HCC.
 */
export default function AdminPage() {
  const { me } = useOutletContext() || {}
  const isSuper = me?.role === 'super_admin'
  const [stats, setStats] = useState({
    totalQuestions: 0,
    totalDocuments: 0,
    supabaseConfigured: false,
  })
  const [drive, setDrive] = useState({
    configured: false,
    folderId: null,
    n8n: false,
  })
  const [driveFiles, setDriveFiles] = useState([])
  const [ingestTab, setIngestTab] = useState('file')
  const [dragOver, setDragOver] = useState(false)
  const [file, setFile] = useState(null)
  const [pasteTitle, setPasteTitle] = useState('')
  const [pasteText, setPasteText] = useState('')
  const [webUrl, setWebUrl] = useState('')
  const [uploading, setUploading] = useState(false)
  const [syncing, setSyncing] = useState(false)
  const [progress, setProgress] = useState({ percent: 0, message: '' })
  const [result, setResult] = useState(null)
  const [error, setError] = useState('')
  const [categoryId, setCategoryId] = useState('')
  const [categoryOptions, setCategoryOptions] = useState([])
  const inputRef = useRef(null)

  const loadStats = useCallback(async () => {
    try {
      const res = await adminFetch('/api/admin/stats')
      if (!res.ok) throw new Error('Không tải được thống kê')
      const data = await res.json()
      setStats(data)
    } catch (e) {
      console.warn(e)
    }
  }, [])

  const loadCategories = useCallback(async () => {
    try {
      const res = await adminFetch('/api/library/categories')
      const data = await res.json()
      if (!res.ok) return
      const flat = data.items || []
      const byId = new Map(flat.map((c) => [c.id, c]))
      const pathOf = (id, guard = new Set()) => {
        const c = byId.get(id)
        if (!c || guard.has(id)) return ''
        guard.add(id)
        const parent = c.parent_id ? pathOf(c.parent_id, guard) : ''
        return parent ? `${parent} / ${c.name}` : c.name
      }
      const allowed =
        me?.role === 'super_admin' ? null : new Set(me?.allowedCategoryIds || [])
      setCategoryOptions(
        flat
          .filter((c) => !allowed || allowed.has(c.id))
          .map((c) => ({ id: c.id, label: pathOf(c.id), kind: c.kind }))
          .sort((a, b) => a.label.localeCompare(b.label, 'vi'))
      )
    } catch (e) {
      console.warn(e)
    }
  }, [me])

  const loadDriveStatus = useCallback(async () => {
    try {
      const [dRes, hRes] = await Promise.all([
        adminFetch('/api/drive/status'),
        fetch('/api/health'),
      ])
      const d = dRes.ok ? await dRes.json() : { configured: false }
      const h = hRes.ok ? await hRes.json() : {}
      setDrive({
        configured: Boolean(d.configured),
        folderId: d.folderId || null,
        n8n: Boolean(h.n8nWebhook),
      })
    } catch (e) {
      console.warn(e)
    }
  }, [])

  useEffect(() => {
    loadStats()
    loadDriveStatus()
    loadCategories()
  }, [loadStats, loadDriveStatus, loadCategories])

  function onDrop(e) {
    e.preventDefault()
    setDragOver(false)
    const f = e.dataTransfer.files?.[0]
    if (f) acceptFile(f)
  }

  function acceptFile(f) {
    if (!ALLOWED_RE.test(f.name)) {
      setError('Hỗ trợ: PDF, DOC/DOCX, PPT/PPTX, ảnh (OCR), TXT/MD')
      return
    }
    setError('')
    setResult(null)
    setFile(f)
  }

  async function readSse(res, { onProgress, onDone }) {
    const reader = res.body.getReader()
    const decoder = new TextDecoder('utf-8')
    let buffer = ''

    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      const parts = buffer.split('\n\n')
      buffer = parts.pop() || ''

      for (const part of parts) {
        const lines = part.split('\n')
        let event = 'message'
        const dataLines = []
        for (const line of lines) {
          if (line.startsWith('event:')) event = line.slice(6).trim()
          else if (line.startsWith('data:')) dataLines.push(line.slice(5).trim())
        }
        if (!dataLines.length) continue
        let data
        try {
          data = JSON.parse(dataLines.join('\n'))
        } catch {
          continue
        }
        if (event === 'progress') onProgress?.(data)
        else if (event === 'done') onDone?.(data)
        else if (event === 'error') throw new Error(data.message || 'Lỗi SSE')
      }
    }
  }

  async function handleUpload() {
    if (!file || uploading) return
    if (!isSuper && !categoryId) {
      setError('Chọn ngành / hạng mục / chủ đề trước khi upload')
      return
    }
    setUploading(true)
    setError('')
    setResult(null)
    setProgress({ percent: 1, message: 'Đang tải lên…' })

    try {
      const form = new FormData()
      form.append('file', file)
      if (categoryId) form.append('categoryId', categoryId)

      const res = await adminFetch('/api/upload', {
        method: 'POST',
        body: form,
        headers: { Accept: 'text/event-stream' },
      })

      if (!res.ok) {
        const t = await res.text()
        throw new Error(errorFromResponseBody(t, res.status))
      }

      await readSse(res, {
        onProgress: (data) =>
          setProgress({
            percent: data.percent || 0,
            message: data.message || data.stage || '',
          }),
        onDone: (data) => {
          setResult(data)
          setProgress({ percent: 100, message: 'Hoàn tất' })
          setFile(null)
          loadStats()
        },
      })
    } catch (e) {
      setError(e.message || 'Upload thất bại')
      setProgress({ percent: 0, message: '' })
    } finally {
      setUploading(false)
    }
  }

  async function handlePasteText() {
    if (!pasteText.trim() || uploading) return
    if (!isSuper && !categoryId) {
      setError('Chọn ngành / hạng mục / chủ đề trước khi nạp')
      return
    }
    setUploading(true)
    setError('')
    setResult(null)
    setProgress({ percent: 1, message: 'Đang số hóa văn bản dán…' })
    try {
      const res = await adminFetch('/api/upload/text', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'text/event-stream',
        },
        body: JSON.stringify({
          text: pasteText,
          title: pasteTitle || 'van-ban-dan',
          categoryId: categoryId || undefined,
        }),
      })
      if (!res.ok) throw new Error(errorFromResponseBody(await res.text(), res.status))
      await readSse(res, {
        onProgress: (data) =>
          setProgress({
            percent: data.percent || 0,
            message: data.message || '',
          }),
        onDone: (data) => {
          setResult(data)
          setProgress({ percent: 100, message: 'Hoàn tất' })
          setPasteText('')
          loadStats()
        },
      })
    } catch (e) {
      setError(e.message)
      setProgress({ percent: 0, message: '' })
    } finally {
      setUploading(false)
    }
  }

  async function handleWebUrl() {
    if (!webUrl.trim() || uploading) return
    if (!isSuper && !categoryId) {
      setError('Chọn ngành / hạng mục / chủ đề trước khi nạp')
      return
    }
    setUploading(true)
    setError('')
    setResult(null)
    setProgress({ percent: 1, message: 'Đang đọc link Drive / website…' })
    try {
      const res = await adminFetch('/api/upload/url', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'text/event-stream',
        },
        body: JSON.stringify({
          url: webUrl.trim(),
          categoryId: categoryId || undefined,
        }),
      })
      if (!res.ok) throw new Error(errorFromResponseBody(await res.text(), res.status))
      await readSse(res, {
        onProgress: (data) =>
          setProgress({
            percent: data.percent || 0,
            message: data.message || '',
          }),
        onDone: (data) => {
          setResult(data)
          setProgress({ percent: 100, message: 'Hoàn tất' })
          setWebUrl('')
          loadStats()
        },
      })
    } catch (e) {
      setError(e.message)
      setProgress({ percent: 0, message: '' })
    } finally {
      setUploading(false)
    }
  }

  async function handleListDrive() {
    setError('')
    try {
      const res = await adminFetch('/api/drive/list')
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Không liệt kê được Drive')
      setDriveFiles(data.files || [])
    } catch (e) {
      setError(e.message)
    }
  }

  async function handleSyncDrive() {
    if (syncing || !drive.configured) return
    setSyncing(true)
    setError('')
    setResult(null)
    setProgress({ percent: 1, message: 'Đồng bộ Google Drive…' })

    try {
      const res = await adminFetch('/api/drive/sync', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'text/event-stream',
        },
        body: JSON.stringify({ limit: 20 }),
      })
      if (!res.ok) {
        const t = await res.text()
        throw new Error(errorFromResponseBody(t, res.status))
      }

      await readSse(res, {
        onProgress: (data) =>
          setProgress({
            percent: data.percent || 0,
            message: data.message || data.stage || '',
          }),
        onDone: (data) => {
          setResult({
            fileName: `Đồng bộ Drive: ${data.processed || 0}/${data.totalListed || 0} file`,
            metadata: { loai_van_ban: 'Google Drive' },
            chunks: data.results?.filter((r) => r.ok).length || 0,
            upserted: data.processed || 0,
          })
          setProgress({ percent: 100, message: 'Đồng bộ xong' })
          loadStats()
          handleListDrive()
        },
      })
    } catch (e) {
      setError(e.message || 'Đồng bộ Drive thất bại')
      setProgress({ percent: 0, message: '' })
    } finally {
      setSyncing(false)
    }
  }

  async function handleIngestDriveFile(fileId, name) {
    if (syncing) return
    setSyncing(true)
    setError('')
    setProgress({ percent: 1, message: `Số hóa ${name}…` })
    try {
      const res = await adminFetch('/api/drive/ingest', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'text/event-stream',
        },
        body: JSON.stringify({ fileId }),
      })
      if (!res.ok) throw new Error(errorFromResponseBody(await res.text(), res.status))
      await readSse(res, {
        onProgress: (data) =>
          setProgress({
            percent: data.percent || 0,
            message: data.message || '',
          }),
        onDone: (data) => {
          setResult(data)
          setProgress({ percent: 100, message: 'Hoàn tất' })
          loadStats()
        },
      })
    } catch (e) {
      setError(e.message)
      setProgress({ percent: 0, message: '' })
    } finally {
      setSyncing(false)
    }
  }

  return (
    <div className="admin-shell relative min-h-[calc(100dvh-var(--nav-h)-var(--bottom-nav-h))] overflow-hidden text-slate-100">
      <div className="pointer-events-none absolute inset-0 admin-aurora" aria-hidden="true" />

      <div className="relative z-10 mx-auto flex w-full max-w-6xl flex-col px-4 py-6 sm:px-6 sm:py-10 xl:max-w-[1400px]">
        <header className="mb-8 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-3">
            <img
              src={logo}
              alt="HCC"
              width={52}
              height={52}
              className="h-12 w-12 rounded-full object-cover shadow-[0_0_0_3px_rgba(232,185,35,0.85)]"
            />
            <div>
              <p className="m-0 mb-0.5 text-xs font-semibold uppercase tracking-[0.2em] text-[var(--hcc-gold-bright)]">
                HCC · Quản trị
              </p>
              <h1 className="m-0 text-2xl font-semibold tracking-tight text-white sm:text-3xl">
                Trung tâm số hóa
              </h1>
              <p className="m-0 mt-1 text-sm text-white/70">
                Upload · Drive · n8n · Pinecone
              </p>
            </div>
          </div>
        </header>

        <section className="mb-6 grid gap-4 sm:grid-cols-2">
          <article className="glass-panel rounded-3xl p-5 sm:p-6">
            <div className="mb-3 flex h-11 w-11 items-center justify-center rounded-2xl bg-[var(--hcc-red)]/30 text-[var(--hcc-gold-bright)]">
              <MessageSquareText className="h-5 w-5" />
            </div>
            <p className="m-0 text-sm text-white/70">Tổng câu hỏi đã phục vụ</p>
            <p className="m-0 mt-1 text-4xl font-semibold tabular-nums text-white">
              {stats.totalQuestions}
            </p>
            <p className="m-0 mt-2 text-xs text-white/50">
              {stats.supabaseConfigured
                ? 'Đồng bộ từ Supabase chat_logs'
                : 'Supabase chưa cấu hình'}
            </p>
          </article>

          <article className="glass-panel rounded-3xl p-5 sm:p-6">
            <div className="mb-3 flex h-11 w-11 items-center justify-center rounded-2xl bg-[var(--hcc-gold)]/20 text-[var(--hcc-gold-bright)]">
              <FileText className="h-5 w-5" />
            </div>
            <p className="m-0 text-sm text-white/70">Tổng tài liệu đã số hóa</p>
            <p className="m-0 mt-1 text-4xl font-semibold tabular-nums text-white">
              {stats.totalDocuments}
            </p>
            <p className="m-0 mt-2 text-xs text-white/50">Bảng documents / Drive / upload</p>
          </article>
        </section>

        <section className="glass-panel mb-6 rounded-3xl p-5 sm:p-8">
          <h2 className="m-0 mb-1 text-lg font-semibold text-white">Nạp dữ liệu & Số hóa</h2>
          <p className="m-0 mb-4 text-sm text-white/70">
            PDF · Word · Drive link · Website · Text dán
          </p>

          <div className="mb-4 flex flex-wrap gap-1 rounded-full border border-white/15 bg-white/5 p-1">
            {[
              { id: 'file', label: 'File', Icon: UploadCloud },
              { id: 'text', label: 'Dán text', Icon: Type },
              { id: 'url', label: 'Link / Drive', Icon: Globe },
            ].map(({ id, label, Icon }) => (
              <button
                key={id}
                type="button"
                onClick={() => setIngestTab(id)}
                className={`inline-flex cursor-pointer items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-semibold transition sm:text-sm ${
                  ingestTab === id
                    ? 'btn-gold'
                    : 'text-white/70 hover:bg-white/10 hover:text-white'
                }`}
              >
                <Icon className="h-3.5 w-3.5" />
                {label}
              </button>
            ))}
          </div>

          <label className="mb-4 block">
            <span className="mb-1.5 block text-xs font-medium text-white/70">
              Ngành / hạng mục / chủ đề {isSuper ? '(tuỳ chọn)' : '(bắt buộc)'}
            </span>
            <select
              value={categoryId}
              onChange={(e) => setCategoryId(e.target.value)}
              className="w-full rounded-2xl border border-white/20 bg-white/10 px-3 py-2.5 text-sm text-white outline-none focus:border-[var(--hcc-gold)]"
            >
              <option value="" className="text-[var(--hcc-ink)]">
                {isSuper ? 'Tự gợi ý theo nội dung văn bản' : '— Chọn phần bạn được giao —'}
              </option>
              {categoryOptions.map((o) => (
                <option key={o.id} value={o.id} className="text-[var(--hcc-ink)]">
                  {o.label}
                </option>
              ))}
            </select>
            <span className="mt-1 block text-[11px] text-white/45">
              {isSuper
                ? 'Cây chuyên mục đầy đủ. Cán bộ khác chỉ thấy mục được gán.'
                : 'Chỉ hiện chuyên mục bạn được quản lý (kèm thư mục con).'}
            </span>
          </label>

          {ingestTab === 'file' && (
            <>
              <div
                onDragOver={(e) => {
                  e.preventDefault()
                  setDragOver(true)
                }}
                onDragLeave={() => setDragOver(false)}
                onDrop={onDrop}
                onClick={() => inputRef.current?.click()}
                className={`group cursor-pointer rounded-3xl border border-dashed px-4 py-10 text-center transition duration-300 ${
                  dragOver
                    ? 'border-[var(--hcc-gold)]/80 bg-white/15 shadow-[0_0_40px_rgba(232,185,35,0.2)]'
                    : 'border-white/20 bg-white/5 hover:border-white/40 hover:bg-white/10'
                }`}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') inputRef.current?.click()
                }}
              >
                <UploadCloud
                  className={`mx-auto mb-3 h-11 w-11 transition ${
                    dragOver
                      ? 'text-[var(--hcc-gold-bright)]'
                      : 'text-white/70 group-hover:text-white'
                  }`}
                />
                <p className="m-0 text-base font-medium text-white">
                  {file ? file.name : 'Kéo thả file vào đây'}
                </p>
                <p className="m-0 mt-1 text-sm text-white/50">
                  {file
                    ? `${(file.size / 1024 / 1024).toFixed(2)} MB`
                    : 'PDF, DOC/DOCX, PPTX, PNG/JPG… · tối đa ~40MB'}
                </p>
                <input
                  ref={inputRef}
                  type="file"
                  accept=".pdf,.doc,.docx,.ppt,.pptx,.png,.jpg,.jpeg,.webp,.gif,.bmp,.tif,.tiff,.txt,.md,.csv,application/pdf,image/*"
                  className="hidden"
                  onChange={(e) => {
                    const f = e.target.files?.[0]
                    if (f) acceptFile(f)
                  }}
                />
              </div>
              <div className="mt-5 flex flex-wrap items-center gap-3">
                <button
                  type="button"
                  disabled={!file || uploading}
                  onClick={handleUpload}
                  className="btn-gold inline-flex cursor-pointer items-center gap-2 rounded-2xl px-5 py-3 text-sm font-semibold transition hover:brightness-105 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  <Sparkles className="h-4 w-4" />
                  {uploading ? 'Đang số hóa…' : 'Tải lên & Số hóa'}
                </button>
                {file && !uploading && (
                  <button
                    type="button"
                    className="cursor-pointer rounded-2xl px-4 py-3 text-sm text-white/70 hover:text-white"
                    onClick={() => setFile(null)}
                  >
                    Hủy chọn
                  </button>
                )}
              </div>
            </>
          )}

          {ingestTab === 'text' && (
            <div className="space-y-3">
              <input
                value={pasteTitle}
                onChange={(e) => setPasteTitle(e.target.value)}
                placeholder="Tiêu đề (tuỳ chọn)"
                className="w-full rounded-2xl border border-white/15 bg-white/5 px-4 py-3 text-sm text-white outline-none placeholder:text-white/40 focus:border-[var(--hcc-gold)]"
              />
              <textarea
                rows={8}
                value={pasteText}
                onChange={(e) => setPasteText(e.target.value)}
                placeholder="Dán nội dung văn bản / quy định / ghi chú…"
                className="w-full resize-y rounded-2xl border border-white/15 bg-white/5 px-4 py-3 text-sm text-white outline-none placeholder:text-white/40 focus:border-[var(--hcc-gold)]"
              />
              <button
                type="button"
                disabled={!pasteText.trim() || uploading}
                onClick={handlePasteText}
                className="btn-gold inline-flex cursor-pointer items-center gap-2 rounded-2xl px-5 py-3 text-sm font-semibold disabled:opacity-40"
              >
                <Type className="h-4 w-4" />
                {uploading ? 'Đang số hóa…' : 'Số hóa text'}
              </button>
            </div>
          )}

          {ingestTab === 'url' && (
            <div className="space-y-3">
              <p className="m-0 text-xs text-white/50">
                Dán link Google Drive (file hoặc thư mục PDF) — file gốc ở lại Drive, hệ thống chỉ đọc để
                đưa vào chat. Có thể dán nhiều link, mỗi dòng một cái. Trang .gov.vn vẫn dùng được.
              </p>
              <textarea
                rows={4}
                value={webUrl}
                onChange={(e) => setWebUrl(e.target.value)}
                placeholder="https://drive.google.com/file/d/xxxxx/view?usp=sharing"
                className="w-full resize-y rounded-2xl border border-white/15 bg-white/5 px-4 py-3 text-sm text-white outline-none placeholder:text-white/40 focus:border-[var(--hcc-gold)]"
              />
              <button
                type="button"
                disabled={!webUrl.trim() || uploading}
                onClick={handleWebUrl}
                className="btn-gold inline-flex cursor-pointer items-center gap-2 rounded-2xl px-5 py-3 text-sm font-semibold disabled:opacity-40"
              >
                <Globe className="h-4 w-4" />
                {uploading ? 'Đang lấy & số hóa…' : 'Số hóa từ link Drive / web'}
              </button>
            </div>
          )}
        </section>

        {isSuper ? (
        <section className="glass-panel mb-6 rounded-3xl p-5 sm:p-8">
          <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="m-0 mb-1 flex items-center gap-2 text-lg font-semibold text-white">
                <Cloud className="h-5 w-5 text-[var(--hcc-gold-bright)]" />
                Google Drive & n8n
              </h2>
              <p className="m-0 text-sm text-white/70">
                Đồng bộ PDF cá nhân / team; webhook tự động khi có file mới.
              </p>
            </div>
            <div className="flex flex-wrap gap-2 text-xs">
              <span
                className={`rounded-full px-3 py-1 ${
                  drive.configured
                    ? 'bg-emerald-400/20 text-emerald-200'
                    : 'bg-white/10 text-white/50'
                }`}
              >
                Drive: {drive.configured ? 'ON' : 'OFF'}
              </span>
              <span
                className={`rounded-full px-3 py-1 ${
                  drive.n8n ? 'bg-emerald-400/20 text-emerald-200' : 'bg-white/10 text-white/50'
                }`}
              >
                n8n: {drive.n8n ? 'ON' : 'OFF'}
              </span>
            </div>
          </div>

          {!drive.configured ? (
            <p className="m-0 rounded-2xl border border-white/10 bg-white/5 p-4 text-sm text-white/70">
              Điền <code className="text-[var(--hcc-gold-bright)]">GOOGLE_SERVICE_ACCOUNT_JSON</code>,{' '}
              <code className="text-[var(--hcc-gold-bright)]">GOOGLE_DRIVE_FOLDER_ID</code> trong{' '}
              <code>.env</code>. Xem <code className="text-white/90">docs/n8n/README.md</code>
            </p>
          ) : (
            <>
              <p className="m-0 mb-4 text-xs text-white/50">
                Folder: <code className="text-white/80">{drive.folderId}</code>
              </p>
              <div className="flex flex-wrap gap-3">
                <button
                  type="button"
                  disabled={syncing}
                  onClick={handleListDrive}
                  className="inline-flex cursor-pointer items-center gap-2 rounded-2xl border border-white/20 bg-white/10 px-4 py-2.5 text-sm text-white hover:bg-white/15 disabled:opacity-40"
                >
                  <FileText className="h-4 w-4" />
                  Liệt kê PDF
                </button>
                <button
                  type="button"
                  disabled={syncing}
                  onClick={handleSyncDrive}
                  className="btn-gold inline-flex cursor-pointer items-center gap-2 rounded-2xl px-4 py-2.5 text-sm font-semibold disabled:opacity-40"
                >
                  <FolderSync className="h-4 w-4" />
                  {syncing ? 'Đang đồng bộ…' : 'Đồng bộ folder (≤20)'}
                </button>
              </div>

              {driveFiles.length > 0 && (
                <ul className="mt-4 max-h-56 space-y-2 overflow-y-auto p-0">
                  {driveFiles.map((f) => (
                    <li
                      key={f.id}
                      className="flex list-none items-center justify-between gap-2 rounded-2xl border border-white/10 bg-white/5 px-3 py-2 text-sm"
                    >
                      <span className="truncate text-white/90">{f.name}</span>
                      <button
                        type="button"
                        disabled={syncing}
                        onClick={() => handleIngestDriveFile(f.id, f.name)}
                        className="shrink-0 cursor-pointer rounded-xl px-3 py-1 text-xs text-[var(--hcc-gold-bright)] hover:bg-white/10 disabled:opacity-40"
                      >
                        Số hóa
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </>
          )}

          <div className="mt-5 flex gap-3 rounded-2xl border border-white/10 bg-white/5 p-4 text-sm text-white/70">
            <Webhook className="mt-0.5 h-5 w-5 shrink-0 text-[var(--hcc-gold-bright)]" />
            <div>
              <p className="m-0 font-medium text-white">Webhook n8n</p>
              <p className="m-0 mt-1 text-xs text-white/50">
                <code className="text-[var(--hcc-gold-bright)]">POST /api/webhooks/n8n</code> ·{' '}
                <code>X-N8N-Secret</code>
              </p>
            </div>
          </div>
        </section>
        ) : null}

        {(uploading || syncing || progress.percent > 0) && (
          <div className="glass-progress mb-4 overflow-hidden rounded-2xl p-4">
            <div className="mb-2 flex items-center justify-between text-xs text-white/70">
              <span>{progress.message || 'Đang xử lý…'}</span>
              <span className="tabular-nums">{Math.round(progress.percent)}%</span>
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-white/10">
              <div
                className="h-full rounded-full bg-gradient-to-r from-[var(--hcc-red)] to-[var(--hcc-gold-bright)] transition-[width] duration-300"
                style={{ width: `${Math.min(100, progress.percent)}%` }}
              />
            </div>
          </div>
        )}

        {error && (
          <p role="alert" className="mb-4 text-sm text-rose-300">
            {error}
          </p>
        )}

        {result && (
          <div className="mb-4 rounded-2xl border border-emerald-400/30 bg-emerald-400/10 p-4 text-sm text-emerald-100">
            <p className="m-0 font-medium">Số hóa thành công: {result.fileName}</p>
            <p className="m-0 mt-1 text-emerald-100/80">
              {result.metadata?.loai_van_ban} {result.metadata?.so_hieu} · {result.chunks} chunks ·
              upsert {result.upserted}
            </p>
          </div>
        )}
      </div>
    </div>
  )
}
