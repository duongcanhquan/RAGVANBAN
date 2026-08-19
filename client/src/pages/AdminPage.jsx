import { useCallback, useEffect, useRef, useState } from 'react'
import { useOutletContext } from 'react-router-dom'
import { Globe, Pencil, Sparkles, Trash2, Type, UploadCloud } from 'lucide-react'
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

export default function AdminPage() {
  const { me } = useOutletContext() || {}
  const isSuper = me?.role === 'super_admin'
  const [stats, setStats] = useState({ totalQuestions: 0, totalDocuments: 0 })
  const [ingestTab, setIngestTab] = useState('file')
  const [dragOver, setDragOver] = useState(false)
  const [files, setFiles] = useState([])
  const [pasteTitle, setPasteTitle] = useState('')
  const [pasteText, setPasteText] = useState('')
  const [webUrl, setWebUrl] = useState('')
  const [uploading, setUploading] = useState(false)
  const [progress, setProgress] = useState({ percent: 0, message: '' })
  const [result, setResult] = useState(null)
  const [error, setError] = useState('')
  const [categoryId, setCategoryId] = useState('')
  const [categoryOptions, setCategoryOptions] = useState([])
  const [docs, setDocs] = useState([])
  const [selected, setSelected] = useState(() => new Set())
  const [editingId, setEditingId] = useState('')
  const [editName, setEditName] = useState('')
  const [bulkCategoryId, setBulkCategoryId] = useState('')
  const inputRef = useRef(null)

  const loadStats = useCallback(async () => {
    try {
      const res = await adminFetch('/api/admin/stats')
      if (!res.ok) return
      setStats(await res.json())
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

  const loadDocs = useCallback(async () => {
    try {
      const res = await adminFetch('/api/library/documents')
      const data = await res.json().catch(() => ({}))
      if (!res.ok) return
      setDocs(data.items || [])
    } catch (e) {
      console.warn(e)
    }
  }, [])

  useEffect(() => {
    loadStats()
    loadCategories()
    loadDocs()
  }, [loadStats, loadCategories, loadDocs])

  function acceptFiles(list) {
    const next = [...list].filter((f) => ALLOWED_RE.test(f.name))
    if (!next.length) {
      setError('Hỗ trợ: PDF, DOC/DOCX, PPT/PPTX, ảnh (OCR), TXT/MD')
      return
    }
    setError('')
    setResult(null)
    setFiles((prev) => [...prev, ...next])
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

  async function ingestFile(file, index, total) {
    const form = new FormData()
    form.append('file', file)
    if (categoryId) form.append('categoryId', categoryId)
    const res = await adminFetch('/api/upload', {
      method: 'POST',
      body: form,
      headers: { Accept: 'text/event-stream' },
    })
    if (!res.ok) throw new Error(errorFromResponseBody(await res.text(), res.status))
    let last = null
    await readSse(res, {
      onProgress: (data) =>
        setProgress({
          percent: Math.round(((index + (data.percent || 0) / 100) / total) * 100),
          message: `${index + 1}/${total} · ${data.message || file.name}`,
        }),
      onDone: (data) => {
        last = data
      },
    })
    return last
  }

  async function handleUpload() {
    if (!files.length || uploading) return
    if (!isSuper && !categoryId) {
      setError('Chọn ngành / hạng mục / chủ đề trước khi upload')
      return
    }
    setUploading(true)
    setError('')
    setResult(null)
    try {
      let last = null
      const queue = [...files]
      for (let i = 0; i < queue.length; i += 1) {
        last = await ingestFile(queue[i], i, queue.length)
        setFiles((prev) => prev.filter((f) => f !== queue[i]))
      }
      setResult(last)
      setProgress({ percent: 100, message: 'Hoàn tất' })
      setFiles([])
      loadStats()
      loadDocs()
    } catch (e) {
      setError(e.message || 'Upload thất bại — các file đã số hóa được bỏ khỏi danh sách, thử lại phần còn lại')
      setProgress({ percent: 0, message: '' })
      loadStats()
      loadDocs()
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
        headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream' },
        body: JSON.stringify({
          text: pasteText,
          title: pasteTitle || 'van-ban-dan',
          categoryId: categoryId || undefined,
        }),
      })
      if (!res.ok) throw new Error(errorFromResponseBody(await res.text(), res.status))
      await readSse(res, {
        onProgress: (data) =>
          setProgress({ percent: data.percent || 0, message: data.message || '' }),
        onDone: (data) => {
          setResult(data)
          setProgress({ percent: 100, message: 'Hoàn tất' })
          setPasteText('')
          loadStats()
          loadDocs()
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
        headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream' },
        body: JSON.stringify({
          url: webUrl.trim(),
          categoryId: categoryId || undefined,
        }),
      })
      if (!res.ok) throw new Error(errorFromResponseBody(await res.text(), res.status))
      await readSse(res, {
        onProgress: (data) =>
          setProgress({ percent: data.percent || 0, message: data.message || '' }),
        onDone: (data) => {
          setResult(data)
          setProgress({ percent: 100, message: 'Hoàn tất' })
          setWebUrl('')
          loadStats()
          loadDocs()
        },
      })
    } catch (e) {
      setError(e.message)
      setProgress({ percent: 0, message: '' })
    } finally {
      setUploading(false)
    }
  }

  const allSelected = docs.length > 0 && selected.size === docs.length
  const selectedIds = [...selected]

  function toggleAll() {
    if (allSelected) setSelected(new Set())
    else setSelected(new Set(docs.map((d) => d.id)))
  }

  function toggleOne(id) {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  async function deleteIds(ids) {
    if (!ids.length) return
    if (!window.confirm(`Xóa ${ids.length} tài liệu khỏi thư viện và vector?`)) return
    setError('')
    const res = await adminFetch('/api/library/documents/bulk-delete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids }),
    })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) {
      setError(data.error || 'Không xóa được')
      return
    }
    const failed = (data.results || []).filter((r) => r.ok === false)
    if (failed.length) {
      setError(`Xóa ${failed.length}/${ids.length} tài liệu thất bại: ${failed[0].error || ''}`)
    }
    setSelected(new Set())
    loadDocs()
    loadStats()
  }

  async function applyBulkCategory() {
    if (!selectedIds.length || !bulkCategoryId) return
    setError('')
    const res = await adminFetch('/api/library/documents/bulk-category', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids: selectedIds, categoryId: bulkCategoryId }),
    })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) {
      setError(data.error || 'Không chuyển chuyên mục')
      return
    }
    const failed = (data.results || []).filter((r) => r.ok === false)
    if (failed.length) setError(`Không chuyển ${failed.length} tài liệu: ${failed[0].error || ''}`)
    else setSelected(new Set())
    loadDocs()
  }

  async function saveEdit(doc) {
    const name = editName.trim()
    if (!name) return
    const res = await adminFetch(`/api/library/documents/${encodeURIComponent(doc.id)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ file_name: name }),
    })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) {
      setError(data.error || 'Không sửa được')
      return
    }
    setEditingId('')
    loadDocs()
  }

  async function changeDocCategory(doc, nextId) {
    const res = await adminFetch(`/api/library/documents/${encodeURIComponent(doc.id)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ categoryId: nextId || null }),
    })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) setError(data.error || 'Không đổi chuyên mục')
    else loadDocs()
  }

  return (
    <div className="admin-shell relative min-h-[calc(100dvh-var(--nav-h)-var(--bottom-nav-h))] overflow-hidden text-slate-100">
      <div className="pointer-events-none absolute inset-0 admin-aurora" aria-hidden="true" />

      <div className="relative z-10 mx-auto flex w-full max-w-6xl flex-col px-4 py-6 sm:px-6 xl:max-w-[1400px]">
        <p className="m-0 mb-4 rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-xs text-white/75">
          Câu hỏi đã phục vụ:{' '}
          <span className="font-semibold tabular-nums text-white">{stats.totalQuestions || 0}</span>
          <span className="mx-2 text-white/25">·</span>
          Tài liệu đã số hóa:{' '}
          <span className="font-semibold tabular-nums text-white">{stats.totalDocuments || 0}</span>
        </p>

        <section className="glass-panel mb-6 rounded-3xl p-5 sm:p-8">
          <h2 className="m-0 mb-1 text-lg font-semibold text-white">Tài liệu</h2>
          <p className="m-0 mb-4 text-sm text-white/70">
            Upload nhiều file, dán text, hoặc link Drive. Super-admin có thể không chọn chuyên mục (tự gợi ý).
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
                  ingestTab === id ? 'btn-gold' : 'text-white/70 hover:bg-white/10 hover:text-white'
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
          </label>

          {ingestTab === 'file' && (
            <>
              <div
                onDragOver={(e) => {
                  e.preventDefault()
                  setDragOver(true)
                }}
                onDragLeave={() => setDragOver(false)}
                onDrop={(e) => {
                  e.preventDefault()
                  setDragOver(false)
                  acceptFiles(e.dataTransfer.files)
                }}
                onClick={() => inputRef.current?.click()}
                className={`group cursor-pointer rounded-3xl border border-dashed px-4 py-10 text-center transition duration-300 ${
                  dragOver
                    ? 'border-[var(--hcc-gold)]/80 bg-white/15'
                    : 'border-white/20 bg-white/5 hover:border-white/40 hover:bg-white/10'
                }`}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') inputRef.current?.click()
                }}
              >
                <UploadCloud className="mx-auto mb-3 h-11 w-11 text-white/70" />
                <p className="m-0 text-base font-medium text-white">
                  {files.length ? `${files.length} file đã chọn` : 'Kéo thả hoặc chọn nhiều file'}
                </p>
                <p className="m-0 mt-1 text-sm text-white/50">PDF, Word, PPTX, ảnh…</p>
                <input
                  ref={inputRef}
                  type="file"
                  multiple
                  accept=".pdf,.doc,.docx,.ppt,.pptx,.png,.jpg,.jpeg,.webp,.gif,.bmp,.tif,.tiff,.txt,.md,.csv,application/pdf,image/*"
                  className="hidden"
                  onChange={(e) => {
                    acceptFiles(e.target.files)
                    e.target.value = ''
                  }}
                />
              </div>
              {files.length ? (
                <ul className="mt-3 max-h-36 space-y-1 overflow-y-auto p-0 text-xs text-white/70">
                  {files.map((f, i) => (
                    <li key={`${f.name}-${i}`} className="flex list-none justify-between gap-2">
                      <span className="truncate">{f.name}</span>
                      <button
                        type="button"
                        className="shrink-0 text-white/45 hover:text-white"
                        onClick={() => setFiles((prev) => prev.filter((_, idx) => idx !== i))}
                      >
                        Bỏ
                      </button>
                    </li>
                  ))}
                </ul>
              ) : null}
              <div className="mt-5 flex flex-wrap items-center gap-3">
                <button
                  type="button"
                  disabled={!files.length || uploading}
                  onClick={handleUpload}
                  className="btn-gold inline-flex cursor-pointer items-center gap-2 rounded-2xl px-5 py-3 text-sm font-semibold disabled:opacity-40"
                >
                  <Sparkles className="h-4 w-4" />
                  {uploading ? 'Đang số hóa…' : `Tải lên & số hóa (${files.length || 0})`}
                </button>
                {files.length ? (
                  <button
                    type="button"
                    className="cursor-pointer text-sm text-white/70"
                    onClick={() => setFiles([])}
                  >
                    Xóa danh sách chọn
                  </button>
                ) : null}
              </div>
            </>
          )}

          {ingestTab === 'text' && (
            <div className="space-y-3">
              <input
                value={pasteTitle}
                onChange={(e) => setPasteTitle(e.target.value)}
                placeholder="Tiêu đề (tuỳ chọn)"
                className="w-full rounded-2xl border border-white/15 bg-white/5 px-4 py-3 text-sm text-white outline-none placeholder:text-white/40"
              />
              <textarea
                rows={8}
                value={pasteText}
                onChange={(e) => setPasteText(e.target.value)}
                placeholder="Dán nội dung văn bản…"
                className="w-full resize-y rounded-2xl border border-white/15 bg-white/5 px-4 py-3 text-sm text-white outline-none placeholder:text-white/40"
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
                Dán link Google Drive — hệ thống đọc rồi vector hóa, file gốc giữ trên Drive.
              </p>
              <textarea
                rows={4}
                value={webUrl}
                onChange={(e) => setWebUrl(e.target.value)}
                placeholder="https://drive.google.com/file/d/xxxxx/view"
                className="w-full resize-y rounded-2xl border border-white/15 bg-white/5 px-4 py-3 text-sm text-white outline-none placeholder:text-white/40"
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

        {(uploading || progress.percent > 0) && (
          <div className="glass-progress mb-4 overflow-hidden rounded-2xl p-4">
            <div className="mb-2 flex items-center justify-between text-xs text-white/70">
              <span>{progress.message || 'Đang xử lý…'}</span>
              <span className="tabular-nums">{Math.round(progress.percent)}%</span>
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-white/10">
              <div
                className="h-full rounded-full bg-gradient-to-r from-[var(--hcc-red)] to-[var(--hcc-gold-bright)]"
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
              {result.metadata?.loai_van_ban} {result.metadata?.so_hieu} · {result.chunks} chunks
            </p>
          </div>
        )}

        <section className="glass-panel rounded-3xl p-5 sm:p-6">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <h2 className="m-0 text-base font-semibold">Danh sách tài liệu</h2>
            <label className="inline-flex items-center gap-2 text-xs text-white/70">
              <input type="checkbox" checked={allSelected} onChange={toggleAll} />
              Chọn tất cả ({docs.length})
            </label>
          </div>

          {selectedIds.length ? (
            <div className="mb-3 flex flex-wrap items-center gap-2 rounded-2xl border border-white/10 bg-white/5 p-3">
              <span className="text-xs text-white/70">{selectedIds.length} đã chọn</span>
              <select
                value={bulkCategoryId}
                onChange={(e) => setBulkCategoryId(e.target.value)}
                className="rounded-xl border border-white/15 bg-black/20 px-2 py-1.5 text-xs"
              >
                <option value="">— Chuyển chuyên mục —</option>
                {categoryOptions.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.label}
                  </option>
                ))}
              </select>
              <button
                type="button"
                disabled={!bulkCategoryId}
                onClick={applyBulkCategory}
                className="rounded-full bg-white/10 px-3 py-1 text-xs disabled:opacity-40"
              >
                Áp dụng
              </button>
              <button
                type="button"
                onClick={() => deleteIds(selectedIds)}
                className="rounded-full bg-red-500/20 px-3 py-1 text-xs text-red-100"
              >
                Xóa đã chọn
              </button>
            </div>
          ) : null}

          <ul className="m-0 max-h-[28rem] list-none space-y-2 overflow-y-auto p-0">
            {docs.map((doc) => (
              <li
                key={doc.id}
                className="flex flex-wrap items-center gap-2 rounded-2xl border border-white/10 bg-white/5 px-3 py-2"
              >
                <input
                  type="checkbox"
                  checked={selected.has(doc.id)}
                  onChange={() => toggleOne(doc.id)}
                />
                <div className="min-w-0 flex-1">
                  {editingId === doc.id ? (
                    <div className="flex gap-2">
                      <input
                        value={editName}
                        onChange={(e) => setEditName(e.target.value)}
                        className="min-w-0 flex-1 rounded-lg border border-white/15 bg-black/20 px-2 py-1 text-sm"
                      />
                      <button type="button" className="text-xs text-[var(--hcc-gold-bright)]" onClick={() => saveEdit(doc)}>
                        Lưu
                      </button>
                    </div>
                  ) : (
                    <p className="m-0 truncate text-sm">{doc.file_name}</p>
                  )}
                  <p className="m-0 text-[11px] text-white/45">
                    {doc.so_hieu || 'Chưa số hiệu'} · {doc.chunk_count || 0} chunks
                  </p>
                </div>
                <select
                  value={doc.category_id || ''}
                  onChange={(e) => changeDocCategory(doc, e.target.value)}
                  className="max-w-[12rem] rounded-lg border border-white/15 bg-black/20 px-2 py-1 text-[11px]"
                >
                  {isSuper ? <option value="">Chưa gắn</option> : null}
                  {categoryOptions.map((o) => (
                    <option key={o.id} value={o.id}>
                      {o.label}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  title="Sửa tên"
                  onClick={() => {
                    setEditingId(doc.id)
                    setEditName(doc.file_name || '')
                  }}
                  className="rounded-full bg-white/10 p-1.5"
                >
                  <Pencil className="h-3.5 w-3.5" />
                </button>
                <button
                  type="button"
                  title="Xóa"
                  onClick={() => deleteIds([doc.id])}
                  className="rounded-full bg-red-500/20 p-1.5 text-red-100"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </li>
            ))}
          </ul>
          {!docs.length ? (
            <p className="m-0 text-sm text-white/50">Chưa có tài liệu.</p>
          ) : null}
        </section>
      </div>
    </div>
  )
}
