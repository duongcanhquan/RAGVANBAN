import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useLocation, useOutletContext } from 'react-router-dom'
import { Globe, GripVertical, Pencil, Plus, RefreshCw, Sparkles, Trash2, Type, UploadCloud } from 'lucide-react'
import { adminFetch } from '../lib/adminApi'
import { apiUrl } from '../lib/apiBase'
import { DIRECT_UPLOAD_MAX_BYTES, formatBytes, splitUploadFiles } from '../lib/uploadLimits'

const ALLOWED_RE =
  /\.(pdf|docx?|docm|pptx?|pptm|xlsx?|xlsm|rtf|od[tsp]|png|jpe?g|webp|gif|bmp|tiff?|txt|md|csv)$/i

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

function slugSegment(name) {
  const raw = String(name || '').trim()
  if (!raw) return ''
  return (
    raw
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/đ/g, 'd')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 60) || 'muc'
  )
}

function r2PrefixFromLabel(label) {
  const parts = String(label || '')
    .split('/')
    .map((s) => slugSegment(s.trim()))
    .filter(Boolean)
  return ['van-ban', ...(parts.length ? parts : ['chua-gan'])].join('/')
}

function docSort(a, b) {
  const sa = a.sort_order ?? a.metadata?.sort_order
  const sb = b.sort_order ?? b.metadata?.sort_order
  const hasA = sa != null && Number.isFinite(Number(sa))
  const hasB = sb != null && Number.isFinite(Number(sb))
  if (hasA && hasB && Number(sa) !== Number(sb)) return Number(sa) - Number(sb)
  if (hasA !== hasB) return hasA ? -1 : 1
  return new Date(b.created_at || 0) - new Date(a.created_at || 0)
}

function sourceLabel(doc) {
  const s = doc.source || doc.metadata?.source || ''
  if (s === 'google_drive' || s === 'drive') return 'Google Drive'
  if (s === 'r2' || s === 'upload') return 'Upload / R2'
  if (s === 'paste' || s === 'text') return 'Dán text'
  if (s === 'web' || s === 'web_official') return 'Website'
  return s || '—'
}

function buildGroups(docs, categoryOptions) {
  const by = new Map()
  for (const o of categoryOptions) by.set(o.id, [])
  const extras = new Map()
  const uncat = []
  for (const d of docs) {
    const cid = d.category_id || ''
    if (!cid) uncat.push(d)
    else if (by.has(cid)) by.get(cid).push(d)
    else {
      if (!extras.has(cid)) extras.set(cid, [])
      extras.get(cid).push(d)
    }
  }
  const groups = [
    {
      id: '',
      label: 'Chưa gắn chuyên mục',
      r2: 'van-ban/chua-gan',
      items: uncat.sort(docSort),
    },
  ]
  for (const o of categoryOptions) {
    groups.push({
      id: o.id,
      label: o.label,
      r2: r2PrefixFromLabel(o.label),
      items: (by.get(o.id) || []).sort(docSort),
    })
  }
  for (const [id, items] of extras) {
    groups.push({
      id,
      label: items[0]?.folder_path || items[0]?.chuyen_mon || 'Chuyên mục khác',
      r2: r2PrefixFromLabel(items[0]?.folder_path || ''),
      items: items.sort(docSort),
    })
  }
  return groups
}

function itemsPayload(docs, categoryId) {
  return docs
    .filter((d) => (d.category_id || '') === (categoryId || ''))
    .sort(docSort)
    .map((d, i) => ({ id: d.id, categoryId: categoryId || null, sortOrder: i }))
}

export default function AdminPage() {
  const { me, refreshMe } = useOutletContext() || {}
  const location = useLocation()
  const onDocumentsTab = location.pathname === '/quantri' || location.pathname === '/quantri/'
  const isSuper = me?.role === 'super_admin'
  const [stats, setStats] = useState({ totalQuestions: 0, totalDocuments: 0 })
  const [ingestTab, setIngestTab] = useState('file')
  const [dragOver, setDragOver] = useState(false)
  const [files, setFiles] = useState([])
  const [pasteTitle, setPasteTitle] = useState('')
  const [pasteText, setPasteText] = useState('')
  const [docTitle, setDocTitle] = useState('')
  const [docDescription, setDocDescription] = useState('')
  const [driveLinks, setDriveLinks] = useState([''])
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
  const [editSoHieu, setEditSoHieu] = useState('')
  const [editTrangThai, setEditTrangThai] = useState('Còn hiệu lực')
  const [bulkCategoryId, setBulkCategoryId] = useState('')
  const [detailId, setDetailId] = useState('')
  const [dropHint, setDropHint] = useState('')
  const [uploadMaxBytes, setUploadMaxBytes] = useState(40 * 1024 * 1024)
  const [httpUploadMaxBytes, setHttpUploadMaxBytes] = useState(DIRECT_UPLOAD_MAX_BYTES)
  const [driveHint, setDriveHint] = useState(null)
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
      if (!res.ok || data.ok === false) {
        setError(data.error || 'Không tải được danh mục tài liệu')
        return []
      }
      const items = data.items || []
      setDocs(items)
      return items
    } catch (e) {
      console.warn(e)
      setError(e.message || 'Không tải được danh mục tài liệu')
      return []
    }
  }, [])

  const loadUploadLimits = useCallback(async () => {
    try {
      const res = await fetch(apiUrl('/api/settings/rag'))
      const data = await res.json().catch(() => ({}))
      const n = Number(data.uploadMaxBytes)
      if (Number.isFinite(n) && n > 0) setUploadMaxBytes(n)
      const http = Number(data.httpUploadMaxBytes)
      if (Number.isFinite(http) && http > 0) setHttpUploadMaxBytes(http)
    } catch {
      /* giữ mức đang có */
    }
  }, [])

  useEffect(() => {
    if (!onDocumentsTab) return
    loadUploadLimits()
    refreshMe?.().catch(() => {})
  }, [onDocumentsTab, loadUploadLimits, refreshMe])

  useEffect(() => {
    if (!onDocumentsTab) return
    loadStats()
    loadCategories()
    loadDocs()
  }, [onDocumentsTab, loadStats, loadCategories, loadDocs])

  const groups = useMemo(() => buildGroups(docs, categoryOptions), [docs, categoryOptions])
  const detailDoc = docs.find((d) => d.id === detailId) || null
  const uploadR2Hint = r2PrefixFromLabel(
    categoryOptions.find((o) => o.id === categoryId)?.label || ''
  )

  function acceptFiles(list) {
    const next = [...list].filter((f) => ALLOWED_RE.test(f.name))
    if (!next.length) {
      setError('Chỉ nhận PDF, Word, PowerPoint, Excel, OpenDocument, RTF, ảnh, TXT/MD.')
      return
    }
    const { direct, useDrive, tooLarge } = splitUploadFiles(next, {
      uploadMaxBytes,
      httpUploadMaxBytes,
    })
    if (useDrive.length) {
      setDriveHint({
        names: useDrive.map((f) => `${f.name} (${formatBytes(f.size)})`),
        limit: formatBytes(httpUploadMaxBytes),
        keptSmall: direct.length > 0,
      })
      setIngestTab('url')
    }
    if (direct.length) {
      setFiles((prev) => {
        const merged = [...prev, ...direct]
        if (merged.length === 1) {
          setDocTitle((cur) => cur.trim() || merged[0].name.replace(/\.[^.]+$/, ''))
        }
        return merged
      })
    }
    setError(
      tooLarge.length
        ? `Không nhận ${tooLarge.map((f) => `«${f.name}» (${formatBytes(f.size)})`).join(', ')} — lớn hơn mức cho phép (${formatBytes(uploadMaxBytes)}).`
        : ''
    )
    setResult(null)
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

  function catalogItemFromResult(result) {
    if (!result?.id) return null
    return {
      id: result.id,
      file_name: result.fileName,
      display_name: result.displayName || result.fileName,
      mo_ta: result.moTa || result.metadata?.mo_ta || '',
      so_hieu: result.metadata?.so_hieu || '',
      loai_van_ban: result.metadata?.loai_van_ban || '',
      trang_thai: result.metadata?.trang_thai || '',
      chunk_count: result.chunks || 0,
      storage_url: result.storageUrl || result.publicUrl || '',
      storage_path: result.storagePath || '',
      drive_web_view_link: result.driveWebViewLink || '',
      category_id: result.categoryId || categoryId || '',
      folder_path: result.folderPath || '',
      source: result.source || result.kind || 'upload',
      created_at: new Date().toISOString(),
    }
  }

  async function showIngested(result) {
    const item = catalogItemFromResult(result)
    const items = await loadDocs()
    loadStats()
    if (item?.id && !items.some((d) => d.id === item.id)) {
      throw new Error(
        'Hệ thống không ghi được tài liệu vào danh mục (Supabase). Không tính số hóa thành công — kiểm tra R2/Storage và bảng documents.'
      )
    }
    if (item) setDetailId(item.id)
  }

  async function ingestFile(file, index, total) {
    const form = new FormData()
    form.append('file', file)
    if (categoryId) form.append('categoryId', categoryId)
    const title =
      files.length === 1 ? docTitle.trim() : String(file.name || '').replace(/\.[^.]+$/, '')
    if (title) form.append('displayName', title)
    if (docDescription.trim()) form.append('description', docDescription.trim())
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
    if (!last?.id) {
      throw new Error(
        last?.error ||
          'Số hóa xong nhưng chưa ghi được vào danh mục tài liệu. Kiểm tra Supabase / bộ não rồi thử lại.'
      )
    }
    if (!last.storagePath && !last.storageUrl && !last.publicUrl) {
      throw new Error(
        'Chưa lưu được bản gốc file (R2 hoặc Supabase Storage). Không tính số hóa thành công.'
      )
    }
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
        showIngested(last)
        setFiles((prev) => prev.filter((f) => f !== queue[i]))
      }
      setResult(last)
      setProgress({ percent: 100, message: 'Hoàn tất' })
      setFiles([])
      if (queue.length === 1) {
        setDocTitle('')
        setDocDescription('')
      }
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
          title: pasteTitle || docTitle || 'van-ban-dan',
          description: docDescription.trim() || undefined,
          categoryId: categoryId || undefined,
        }),
      })
      if (!res.ok) throw new Error(errorFromResponseBody(await res.text(), res.status))
      await readSse(res, {
        onProgress: (data) =>
          setProgress({ percent: data.percent || 0, message: data.message || '' }),
        onDone: (data) => {
          if (!data?.id) {
            throw new Error(
              data?.error ||
                'Số hóa xong nhưng chưa ghi được vào danh mục tài liệu. Kiểm tra Supabase rồi thử lại.'
            )
          }
          setResult(data)
          setProgress({ percent: 100, message: 'Hoàn tất' })
          setPasteText('')
          showIngested(data)
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
    const links = driveLinks.map((s) => s.trim()).filter(Boolean)
    if (!links.length || uploading) return
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
          url: links.join('\n'),
          categoryId: categoryId || undefined,
          title: docTitle.trim() || undefined,
          description: docDescription.trim() || undefined,
        }),
      })
      if (!res.ok) throw new Error(errorFromResponseBody(await res.text(), res.status))
      await readSse(res, {
        onProgress: (data) =>
          setProgress({ percent: data.percent || 0, message: data.message || '' }),
        onDone: (data) => {
          const nested = (data?.items || []).flatMap((it) => it.results || [])
          const first =
            data?.id
              ? data
              : data?.items?.find((it) => it.id) || nested.find((it) => it.ok && it.id)
          const hadWork = Boolean(first?.id || data?.items?.length || data?.processed)
          if (!hadWork) {
            throw new Error(
              data?.error ||
                'Số hóa xong nhưng chưa ghi được vào danh mục tài liệu. Kiểm tra Supabase rồi thử lại.'
            )
          }
          setResult(data)
          setProgress({ percent: 100, message: 'Hoàn tất' })
          setDriveLinks([''])
          setDriveHint(null)
          if (first?.id) showIngested(first)
          else {
            loadStats()
            loadDocs()
          }
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
    if (ids.includes(detailId)) setDetailId('')
    loadDocs()
    loadStats()
  }

  async function reindexIds(ids) {
    if (!ids.length) return
    if (!window.confirm(`Số hóa lại ${ids.length} tài liệu từ file gốc (R2/Drive)? Vector cũ sẽ bị thay.`)) return
    setError('')
    setUploading(true)
    const failed = []
    for (const id of ids) {
      const res = await adminFetch(`/api/library/documents/${id}/reindex`, { method: 'POST' })
      const data = await res.json().catch(() => ({}))
      if (!res.ok || data.ok === false) failed.push({ id, error: data.error || 'Lỗi' })
    }
    if (failed.length) setError(`Số hóa lại lỗi ${failed.length}/${ids.length}: ${failed[0].error}`)
    setUploading(false)
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
    await patchCatalog(doc.id, {
      display_name: name,
      soHieu: editSoHieu,
      trangThai: editTrangThai,
    })
    setEditingId('')
  }

  async function patchCatalog(id, body) {
    const res = await adminFetch(`/api/library/documents/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) {
      setError(data.error || 'Không sửa được')
      return false
    }
    if (data.pinecone?.needReingest) {
      setError('Đã lưu catalog. Vector chưa cập nhật — bấm Số hóa lại cho tài liệu này.')
    }
    loadDocs()
    return true
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

  async function persistReorder(payload) {
    const res = await adminFetch('/api/library/documents/reorder', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ items: payload }),
    })
    const data = await res.json().catch(() => ({}))
    if (!res.ok || data.ok === false) {
      setError(data.error || data.results?.find((r) => r.ok === false)?.error || 'Không đổi vị trí')
      loadDocs()
      return
    }
    loadDocs()
  }

  function applyDrop(fromId, toCategoryId, beforeId) {
    const from = docs.find((d) => d.id === fromId)
    if (!from || fromId === beforeId) return
    const fromCat = from.category_id || ''
    const toCat = toCategoryId || ''
    let next = docs.map((d) =>
      d.id === fromId ? { ...d, category_id: toCat || null } : d
    )
    const group = next.filter((d) => (d.category_id || '') === toCat).sort(docSort)
    const moving = group.find((d) => d.id === fromId)
    const rest = group.filter((d) => d.id !== fromId)
    let insertAt = rest.length
    if (beforeId) {
      const idx = rest.findIndex((d) => d.id === beforeId)
      if (idx >= 0) insertAt = idx
    }
    rest.splice(insertAt, 0, moving)
    const orderMap = new Map(rest.map((d, i) => [d.id, i]))
    next = next.map((d) =>
      orderMap.has(d.id)
        ? {
            ...d,
            sort_order: orderMap.get(d.id),
            metadata: { ...(d.metadata || {}), sort_order: orderMap.get(d.id) },
          }
        : d
    )
    setDocs(next)
    const payload = [
      ...itemsPayload(next, toCat),
      ...(fromCat !== toCat ? itemsPayload(next, fromCat) : []),
    ]
    persistReorder(payload)
  }

  return (
    <div className="admin-shell relative text-slate-100">
      <div className="pointer-events-none absolute inset-0 admin-aurora" aria-hidden="true" />

      <div className="relative z-10 mx-auto w-full max-w-[1600px] px-4 py-4 sm:px-6">
        <p className="m-0 mb-3 rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-xs text-white/75">
          Câu hỏi đã phục vụ:{' '}
          <span className="font-semibold tabular-nums text-white">{stats.totalQuestions || 0}</span>
          <span className="mx-2 text-white/25">·</span>
          Tài liệu đã số hóa:{' '}
          <span className="font-semibold tabular-nums text-white">{stats.totalDocuments || 0}</span>
        </p>

        <div className="grid items-start gap-4 lg:grid-cols-[minmax(18rem,38%)_minmax(0,1fr)]">
          <section className="glass-panel rounded-3xl p-4 sm:p-5">
            <h2 className="m-0 mb-1 text-base font-semibold text-white">Tải tài liệu</h2>
            <p className="m-0 mb-3 text-xs text-white/65">
              File trên {formatBytes(httpUploadMaxBytes)}: đưa Drive rồi dán link.
            </p>

            <div className="mb-3 flex flex-wrap gap-1 rounded-full border border-white/15 bg-white/5 p-0.5">
              {[
                { id: 'file', label: 'File', Icon: UploadCloud },
                { id: 'text', label: 'Dán text', Icon: Type },
                { id: 'url', label: 'Link / Drive', Icon: Globe },
              ].map(({ id, label, Icon }) => (
                <button
                  key={id}
                  type="button"
                  onClick={() => setIngestTab(id)}
                  className={`inline-flex min-h-9 cursor-pointer items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-semibold transition ${
                    ingestTab === id ? 'btn-gold' : 'text-white/70 hover:bg-white/10 hover:text-white'
                  }`}
                >
                  <Icon className="h-3.5 w-3.5" />
                  {label}
                </button>
              ))}
            </div>

            <label className="mb-3 block">
              <span className="mb-1 block text-xs font-medium text-white/70">
                Ngành / hạng mục / chủ đề {isSuper ? '(tuỳ chọn)' : '(bắt buộc)'}
              </span>
              <select
                value={categoryId}
                onChange={(e) => setCategoryId(e.target.value)}
                className="w-full rounded-xl border border-white/20 bg-white/10 px-3 py-2 text-sm text-white outline-none focus:border-[var(--hcc-gold)]"
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
              <span className="mt-1 block font-mono text-[11px] text-white/40">
                R2: {uploadR2Hint}/
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
                  onDrop={(e) => {
                    e.preventDefault()
                    setDragOver(false)
                    if (e.dataTransfer.files?.length) acceptFiles(e.dataTransfer.files)
                  }}
                  onClick={() => inputRef.current?.click()}
                  className={`mb-3 flex min-h-11 cursor-pointer items-center gap-3 rounded-xl border border-dashed px-3 py-2.5 text-left transition ${
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
                  <UploadCloud className="h-5 w-5 shrink-0 text-white/70" />
                  <div className="min-w-0 flex-1">
                    <p className="m-0 text-sm font-medium text-white">
                      {files.length ? `${files.length} file đã chọn` : 'Kéo thả hoặc chọn file'}
                    </p>
                    <p className="m-0 text-[11px] text-white/50">
                      PDF, Word, PPT, Excel, ảnh · tối đa {formatBytes(httpUploadMaxBytes)} / lần
                    </p>
                  </div>
                  <input
                    ref={inputRef}
                    type="file"
                    multiple
                    accept=".pdf,.doc,.docx,.docm,.ppt,.pptx,.pptm,.xls,.xlsx,.xlsm,.rtf,.odt,.odp,.ods,.png,.jpg,.jpeg,.webp,.gif,.bmp,.tif,.tiff,.txt,.md,.csv,application/pdf,application/msword,application/vnd.ms-powerpoint,application/vnd.ms-excel,image/*"
                    className="hidden"
                    onChange={(e) => {
                      acceptFiles(e.target.files)
                      e.target.value = ''
                    }}
                  />
                </div>
                {files.length ? (
                  <ul className="mb-3 max-h-24 space-y-1 overflow-y-auto p-0 text-xs text-white/70">
                    {files.map((f, i) => (
                      <li key={`${f.name}-${i}`} className="flex list-none justify-between gap-2">
                        <span className="truncate">{f.name}</span>
                        <button
                          type="button"
                          className="min-h-8 shrink-0 text-white/45 hover:text-white"
                          onClick={() => setFiles((prev) => prev.filter((_, idx) => idx !== i))}
                        >
                          Bỏ
                        </button>
                      </li>
                    ))}
                  </ul>
                ) : null}
              </>
            )}

            {ingestTab === 'text' && (
              <textarea
                rows={5}
                value={pasteText}
                onChange={(e) => setPasteText(e.target.value)}
                placeholder="Dán nội dung văn bản…"
                className="mb-3 w-full resize-y rounded-xl border border-white/15 bg-white/5 px-3 py-2 text-sm text-white outline-none placeholder:text-white/40"
              />
            )}

            {ingestTab === 'url' && (
              <div className="mb-3 space-y-2">
                {driveHint ? (
                  <div className="rounded-2xl border border-amber-400/30 bg-amber-500/10 px-3 py-3 text-sm text-amber-50">
                    <p className="m-0 font-medium">
                      File lớn hơn {driveHint.limit} — dùng Google Drive
                    </p>
                    <ul className="mt-2 mb-2 list-disc space-y-0.5 pl-4 text-xs text-amber-50/90">
                      {driveHint.names.map((n, i) => (
                        <li key={`${n}-${i}`}>{n}</li>
                      ))}
                    </ul>
                    <ol className="m-0 list-decimal space-y-1 pl-4 text-xs leading-relaxed text-white/80">
                      <li>
                        Mở{' '}
                        <a
                          href="https://drive.google.com"
                          target="_blank"
                          rel="noreferrer"
                          className="underline text-[var(--hcc-gold-bright)]"
                        >
                          Google Drive
                        </a>
                        , bấm Mới → Tải tệp lên.
                      </li>
                      <li>Chuột phải file → Chia sẻ → «Bất kỳ ai có đường liên kết».</li>
                      <li>Copy link, dán vào ô bên dưới, bấm Số hóa.</li>
                    </ol>
                    {driveHint.keptSmall ? (
                      <p className="m-0 mt-2 text-xs text-white/70">
                        File nhỏ hơn {driveHint.limit} vẫn nằm ở tab File — tải như bình thường.
                      </p>
                    ) : null}
                    <button
                      type="button"
                      className="mt-2 text-[11px] text-white/50 underline"
                      onClick={() => setDriveHint(null)}
                    >
                      Đóng hướng dẫn
                    </button>
                  </div>
                ) : (
                  <p className="m-0 text-sm text-white/65">
                    File tải tay lưu bản gốc trên Cloudflare R2. Link Drive thì file ở lại Drive — bấm
                    Thêm link để gán nhiều link rồi số hóa một lúc.
                  </p>
                )}
                <div className="space-y-2">
                  {driveLinks.map((link, i) => (
                    <div key={i} className="flex gap-2">
                      <input
                        value={link}
                        onChange={(e) =>
                          setDriveLinks((prev) => prev.map((x, idx) => (idx === i ? e.target.value : x)))
                        }
                        placeholder="https://drive.google.com/file/d/… hoặc /folders/…"
                        className="min-w-0 flex-1 rounded-2xl border border-white/15 bg-white/5 px-4 py-2.5 text-sm text-white outline-none placeholder:text-white/40"
                      />
                      {driveLinks.length > 1 ? (
                        <button
                          type="button"
                          onClick={() => setDriveLinks((prev) => prev.filter((_, idx) => idx !== i))}
                          className="shrink-0 rounded-xl bg-white/10 px-3 text-xs text-white/70"
                        >
                          Bỏ
                        </button>
                      ) : null}
                    </div>
                  ))}
                  <button
                    type="button"
                    onClick={() => setDriveLinks((prev) => [...prev, ''])}
                    className="inline-flex min-h-9 items-center gap-1 rounded-full bg-white/10 px-3 py-1.5 text-xs text-white/80"
                  >
                    <Plus className="h-3.5 w-3.5" />
                    Thêm link
                  </button>
                </div>
              </div>
            )}

            <label className="mb-2 block">
              <span className="mb-1 block text-xs font-medium text-white/70">Tên tài liệu</span>
              <input
                value={ingestTab === 'text' ? pasteTitle : docTitle}
                onChange={(e) =>
                  ingestTab === 'text' ? setPasteTitle(e.target.value) : setDocTitle(e.target.value)
                }
                placeholder={
                  ingestTab === 'file'
                    ? files.length === 1
                      ? 'Tên hiện trên danh mục (mặc định = tên file)'
                      : 'Một file: điền tên. Nhiều file: mỗi file dùng tên file'
                    : 'Tên hiện trên danh mục'
                }
                className="w-full rounded-xl border border-white/15 bg-white/5 px-3 py-2 text-sm text-white outline-none placeholder:text-white/40"
              />
            </label>
            <label className="mb-3 block">
              <span className="mb-1 block text-xs font-medium text-white/70">Mô tả (hiện trên danh mục)</span>
              <textarea
                rows={2}
                value={docDescription}
                onChange={(e) => setDocDescription(e.target.value)}
                placeholder="Ví dụ: Quy định thời gian làm việc, áp dụng từ năm học 2025–2026"
                className="w-full resize-y rounded-xl border border-white/15 bg-white/5 px-3 py-2 text-sm text-white outline-none placeholder:text-white/40"
              />
            </label>

            {ingestTab === 'file' && (
              <div className="flex flex-wrap items-center gap-3">
                <button
                  type="button"
                  disabled={!files.length || uploading}
                  onClick={handleUpload}
                  className="btn-gold inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-xl px-4 py-2 text-sm font-semibold disabled:opacity-40"
                >
                  <Sparkles className="h-4 w-4" />
                  {uploading ? 'Đang số hóa…' : `Tải lên & số hóa (${files.length || 0})`}
                </button>
                {files.length ? (
                  <button
                    type="button"
                    className="min-h-11 cursor-pointer text-sm text-white/70"
                    onClick={() => setFiles([])}
                  >
                    Xóa danh sách chọn
                  </button>
                ) : null}
              </div>
            )}

            {ingestTab === 'text' && (
              <button
                type="button"
                disabled={!pasteText.trim() || uploading}
                onClick={handlePasteText}
                className="btn-gold inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-xl px-4 py-2 text-sm font-semibold disabled:opacity-40"
              >
                <Type className="h-4 w-4" />
                {uploading ? 'Đang số hóa…' : 'Số hóa text'}
              </button>
            )}

            {ingestTab === 'url' && (
              <button
                type="button"
                disabled={!driveLinks.some((s) => s.trim()) || uploading}
                onClick={handleWebUrl}
                className="btn-gold inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-xl px-4 py-2 text-sm font-semibold disabled:opacity-40"
              >
                <Globe className="h-4 w-4" />
                {uploading ? 'Đang lấy & số hóa…' : 'Số hóa từ link Drive'}
              </button>
            )}

            {(uploading || progress.percent > 0) && (
              <div className="glass-progress mt-4 overflow-hidden rounded-2xl p-4">
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

            {error ? (
              <p role="alert" className="mb-0 mt-3 text-sm text-rose-300">
                {error}
              </p>
            ) : null}

            {result ? (
              <div className="mt-3 rounded-2xl border border-emerald-400/30 bg-emerald-400/10 p-4 text-sm text-emerald-100">
                <p className="m-0 font-medium">
                  Số hóa thành công: {result.displayName || result.fileName}
                  {result.count > 1 ? ` · ${result.count} link` : ''}
                </p>
                {result.skipped || result.processed ? (
                  <p className="m-0 mt-1 text-xs text-emerald-100/75">
                    File mới xử lý {result.processed || 0}
                    {result.skipped ? ` · đã có trong kho ${result.skipped}` : ''}
                  </p>
                ) : null}
                {result.moTa ? (
                  <p className="m-0 mt-1 text-emerald-100/80">{result.moTa}</p>
                ) : null}
                <p className="m-0 mt-1 text-emerald-100/80">
                  {result.metadata?.loai_van_ban} {result.metadata?.so_hieu} · {result.chunks} chunks
                </p>
                {result.storageUrl || result.publicUrl || result.driveWebViewLink ? (
                  <a
                    href={result.storageUrl || result.publicUrl || result.driveWebViewLink}
                    target="_blank"
                    rel="noreferrer"
                    className="mt-1 inline-block text-[var(--hcc-gold-bright)] underline"
                  >
                    Mở bản gốc
                  </a>
                ) : (
                  <p className="m-0 mt-1 text-[11px] text-amber-100/80">
                    Chưa có link tải về — cấu hình R2 hoặc dùng Google Drive để có bản gốc.
                  </p>
                )}
                {result.storagePath ? (
                  <p className="m-0 mt-1 break-all font-mono text-[11px] text-emerald-100/60">
                    {result.storagePath}
                  </p>
                ) : null}
              </div>
            ) : null}
          </section>

          <section className="glass-panel flex min-h-0 flex-col rounded-3xl p-4 sm:p-5">
            <div className="mb-3 flex shrink-0 flex-wrap items-center justify-between gap-2">
              <div>
                <h2 className="m-0 text-base font-semibold">Danh mục tài liệu</h2>
                <p className="m-0 text-[11px] text-white/45">
                  Kéo tay cầm để đổi vị trí; thả vào nhóm khác để chuyển chuyên mục (R2 cũng chuyển thư mục).
                </p>
              </div>
              <label className="inline-flex items-center gap-2 text-xs text-white/70">
                <input type="checkbox" checked={allSelected} onChange={toggleAll} />
                Chọn tất cả ({docs.length})
              </label>
            </div>

            {selectedIds.length ? (
              <div className="mb-3 flex shrink-0 flex-wrap items-center gap-2 rounded-2xl border border-white/10 bg-white/5 p-3">
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
                  disabled={uploading}
                  onClick={() => reindexIds(selectedIds)}
                  className="rounded-full bg-white/10 px-3 py-1 text-xs disabled:opacity-40"
                >
                  Số hóa lại đã chọn
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

            <div className="min-h-0 flex-1 space-y-3 overflow-y-auto pr-1">
              {groups.map((group) => {
                if (!group.items.length && !group.id && !isSuper) return null
                return (
                  <div
                    key={group.id || 'uncat'}
                    onDragOver={(e) => {
                      e.preventDefault()
                      setDropHint(`group:${group.id}`)
                    }}
                    onDragLeave={() => setDropHint('')}
                    onDrop={(e) => {
                      e.preventDefault()
                      const fromId = e.dataTransfer.getData('text/plain')
                      setDropHint('')
                      if (fromId) applyDrop(fromId, group.id, null)
                    }}
                    className={`rounded-2xl border px-2 py-2 ${
                      dropHint === `group:${group.id}`
                        ? 'border-[var(--hcc-gold)]/60 bg-white/10'
                        : 'border-white/10 bg-white/[0.03]'
                    }`}
                  >
                    <div className="mb-1 flex items-baseline justify-between gap-2 px-1">
                      <p className="m-0 text-xs font-semibold text-white/85">{group.label}</p>
                      <p className="m-0 truncate font-mono text-[10px] text-white/35">{group.r2}/</p>
                    </div>
                    {group.items.length ? (
                      <ul className="m-0 list-none space-y-1.5 p-0">
                        {group.items.map((doc) => (
                          <li
                            key={doc.id}
                            draggable={editingId !== doc.id}
                            onDragStart={(e) => {
                              e.dataTransfer.setData('text/plain', doc.id)
                              e.dataTransfer.effectAllowed = 'move'
                            }}
                            onDragOver={(e) => {
                              e.preventDefault()
                              e.stopPropagation()
                              setDropHint(`doc:${doc.id}`)
                            }}
                            onDrop={(e) => {
                              e.preventDefault()
                              e.stopPropagation()
                              const fromId = e.dataTransfer.getData('text/plain')
                              setDropHint('')
                              if (fromId) applyDrop(fromId, group.id, doc.id)
                            }}
                            onClick={() => {
                              setDetailId(doc.id)
                              setEditSoHieu(doc.so_hieu || '')
                              setEditTrangThai(doc.trang_thai || 'Còn hiệu lực')
                            }}
                            className={`flex cursor-pointer flex-wrap items-center gap-2 rounded-xl border px-2 py-2 ${
                              detailId === doc.id
                                ? 'border-[var(--hcc-gold)]/40 bg-white/10'
                                : dropHint === `doc:${doc.id}`
                                  ? 'border-white/30 bg-white/10'
                                  : 'border-white/10 bg-white/5'
                            }`}
                          >
                            <GripVertical
                              className="h-4 w-4 shrink-0 cursor-grab text-white/35"
                              title="Kéo đổi vị trí"
                            />
                            <input
                              type="checkbox"
                              checked={selected.has(doc.id)}
                              onClick={(e) => e.stopPropagation()}
                              onChange={() => toggleOne(doc.id)}
                            />
                            <div className="min-w-0 flex-1">
                              {editingId === doc.id ? (
                                <div className="flex gap-2" onClick={(e) => e.stopPropagation()}>
                                  <input
                                    value={editName}
                                    onChange={(e) => setEditName(e.target.value)}
                                    className="min-w-0 flex-1 rounded-lg border border-white/15 bg-black/20 px-2 py-1 text-sm"
                                  />
                                  <button
                                    type="button"
                                    className="text-xs text-[var(--hcc-gold-bright)]"
                                    onClick={() => saveEdit(doc)}
                                  >
                                    Lưu
                                  </button>
                                </div>
                              ) : (
                                <p className="m-0 truncate text-sm">
                                  {doc.display_name || doc.file_name}
                                </p>
                              )}
                              <p className="m-0 truncate text-[11px] text-white/45">
                                {doc.mo_ta ? `${doc.mo_ta} · ` : ''}
                                {doc.so_hieu || 'Chưa số hiệu'} · {sourceLabel(doc)} ·{' '}
                                {doc.chunk_count || 0} chunks
                                {doc.storage_url || doc.drive_web_view_link ? '' : ' · chưa có link'}
                              </p>
                            </div>
                            <select
                              value={doc.category_id || ''}
                              onClick={(e) => e.stopPropagation()}
                              onChange={(e) => changeDocCategory(doc, e.target.value)}
                              className="max-w-[11rem] rounded-lg border border-white/15 bg-black/20 px-2 py-1 text-[11px]"
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
                              onClick={(e) => {
                                e.stopPropagation()
                                setEditingId(doc.id)
                                setEditName(doc.display_name || doc.file_name || '')
                                setEditSoHieu(doc.so_hieu || '')
                                setEditTrangThai(doc.trang_thai || 'Còn hiệu lực')
                              }}
                              className="rounded-full bg-white/10 p-1.5"
                            >
                              <Pencil className="h-3.5 w-3.5" />
                            </button>
                            <button
                              type="button"
                              title="Số hóa lại"
                              disabled={uploading}
                              onClick={(e) => {
                                e.stopPropagation()
                                reindexIds([doc.id])
                              }}
                              className="rounded-full bg-white/10 p-1.5"
                            >
                              <RefreshCw className="h-3.5 w-3.5" />
                            </button>
                            <button
                              type="button"
                              title="Xóa"
                              onClick={(e) => {
                                e.stopPropagation()
                                deleteIds([doc.id])
                              }}
                              className="rounded-full bg-red-500/20 p-1.5 text-red-100"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p className="m-0 px-1 py-2 text-[11px] text-white/35">Thả tài liệu vào đây</p>
                    )}
                  </div>
                )
              })}
              {!docs.length ? (
                <p className="m-0 text-sm text-white/50">Chưa có tài liệu.</p>
              ) : null}
            </div>

            {detailDoc ? (
              <div className="mt-3 shrink-0 rounded-2xl border border-white/10 bg-black/20 p-3 text-xs text-white/70">
                <p className="m-0 text-sm font-medium text-white">
                  {detailDoc.display_name || detailDoc.file_name}
                </p>
                {detailDoc.mo_ta ? (
                  <p className="m-0 mt-1 text-[11px] text-white/60">{detailDoc.mo_ta}</p>
                ) : null}
                <dl className="m-0 mt-2 grid grid-cols-[7rem_1fr] gap-x-2 gap-y-1">
                  <dt className="text-white/40">Số hiệu</dt>
                  <dd className="m-0">
                    <input
                      value={editSoHieu}
                      onChange={(e) => setEditSoHieu(e.target.value)}
                      onBlur={() =>
                        patchCatalog(detailDoc.id, {
                          soHieu: editSoHieu,
                          trangThai: editTrangThai,
                        })
                      }
                      className="w-full rounded-lg border border-white/15 bg-black/20 px-2 py-1 text-xs"
                    />
                  </dd>
                  <dt className="text-white/40">Loại</dt>
                  <dd className="m-0">{detailDoc.loai_van_ban || '—'}</dd>
                  <dt className="text-white/40">Trạng thái</dt>
                  <dd className="m-0">
                    <select
                      value={editTrangThai || 'Còn hiệu lực'}
                      onChange={(e) => {
                        const v = e.target.value
                        setEditTrangThai(v)
                        patchCatalog(detailDoc.id, { trangThai: v, soHieu: editSoHieu })
                      }}
                      className="w-full rounded-lg border border-white/15 bg-black/20 px-2 py-1 text-xs"
                    >
                      <option>Còn hiệu lực</option>
                      <option>Hết hiệu lực</option>
                      <option>Bị thay thế một phần</option>
                    </select>
                  </dd>
                  <dt className="text-white/40">Nguồn</dt>
                  <dd className="m-0">{sourceLabel(detailDoc)}</dd>
                  <dt className="text-white/40">Chuyên mục</dt>
                  <dd className="m-0">{detailDoc.folder_path || 'Chưa gắn'}</dd>
                  <dt className="text-white/40">R2 / kho</dt>
                  <dd className="m-0 break-all font-mono text-[11px] text-white/55">
                    {detailDoc.storage_path || 'Không lưu R2 (Drive / text)'}
                  </dd>
                </dl>
                {detailDoc.storage_url || detailDoc.drive_web_view_link ? (
                  <a
                    href={detailDoc.storage_url || detailDoc.drive_web_view_link}
                    target="_blank"
                    rel="noreferrer"
                    className="mt-2 inline-block text-[var(--hcc-gold-bright)] underline"
                  >
                    Mở bản gốc
                  </a>
                ) : (
                  <p className="m-0 mt-2 text-[11px] text-amber-100/70">Chưa có link bản gốc</p>
                )}
              </div>
            ) : null}
          </section>
        </div>
      </div>
    </div>
  )
}
