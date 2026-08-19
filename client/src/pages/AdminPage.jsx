import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useLocation, useOutletContext } from 'react-router-dom'
import { adminFetch } from '../lib/adminApi'
import { apiUrl } from '../lib/apiBase'
import { isExpired, trangThaiFromExpired } from '../lib/docStatus'
import { DIRECT_UPLOAD_MAX_BYTES, formatBytes, splitUploadFiles } from '../lib/uploadLimits'
import AdminIngestPanel from './admin/AdminIngestPanel'
import AdminDocCatalog from './admin/AdminDocCatalog'
import {
  ALLOWED_RE,
  buildGroups,
  catalogItemFromResult,
  docSort,
  errorFromResponseBody,
  itemsPayload,
  readSse,
  r2PrefixFromLabel,
} from './admin/adminDocUtils'

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
  const [webLinks, setWebLinks] = useState([''])
  const [uploading, setUploading] = useState(false)
  const [progress, setProgress] = useState({ percent: 0, message: '' })
  const [result, setResult] = useState(null)
  const [error, setError] = useState('')
  const [categoryId, setCategoryId] = useState('')
  const [categoryOptions, setCategoryOptions] = useState([])
  const [docs, setDocs] = useState([])
  const [docsLoading, setDocsLoading] = useState(true)
  const [selected, setSelected] = useState(() => new Set())
  const [editingId, setEditingId] = useState('')
  const [editName, setEditName] = useState('')
  const [editSoHieu, setEditSoHieu] = useState('')
  const [editHetHieuLuc, setEditHetHieuLuc] = useState(false)
  const [editReplacementDocId, setEditReplacementDocId] = useState('')
  const [editReplacementUrl, setEditReplacementUrl] = useState('')
  const [editVanBanThayThe, setEditVanBanThayThe] = useState('')
  const [bulkCategoryId, setBulkCategoryId] = useState('')
  const [detailId, setDetailId] = useState('')
  const [dropHint, setDropHint] = useState('')
  const [uploadMaxBytes, setUploadMaxBytes] = useState(40 * 1024 * 1024)
  const [httpUploadMaxBytes, setHttpUploadMaxBytes] = useState(DIRECT_UPLOAD_MAX_BYTES)
  const [driveHint, setDriveHint] = useState(null)
  const inputRef = useRef(null)
  const ingestLock = useRef(false)
  const catalogPatchTimer = useRef(null)

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
    setDocsLoading(true)
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
    } finally {
      setDocsLoading(false)
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
      setIngestTab('drive')
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

  async function showIngested(result) {
    const item = catalogItemFromResult(result, categoryId)
    const items = await loadDocs()
    loadStats()
    if (item?.id && !items.some((d) => d.id === item.id)) {
      setDocs((prev) => [item, ...prev.filter((d) => d.id !== item.id)])
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
    if (!files.length || uploading || ingestLock.current) return
    if (!isSuper && !categoryId) {
      setError('Chọn ngành / hạng mục / chủ đề trước khi upload')
      return
    }
    setUploading(true)
    ingestLock.current = true
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
      setProgress({ percent: 0, message: '' })
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
      ingestLock.current = false
      setUploading(false)
    }
  }

  async function handlePasteText() {
    if (!pasteText.trim() || uploading || ingestLock.current) return
    if (!isSuper && !categoryId) {
      setError('Chọn ngành / hạng mục / chủ đề trước khi nạp')
      return
    }
    setUploading(true)
    ingestLock.current = true
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
          setProgress({ percent: 0, message: '' })
          setPasteText('')
          showIngested(data)
        },
      })
    } catch (e) {
      setError(e.message)
      setProgress({ percent: 0, message: '' })
    } finally {
      ingestLock.current = false
      setUploading(false)
    }
  }

  function finishLinkIngest(data, resetLinks) {
    const nested = (data?.items || []).flatMap((it) => it.results || [])
    const listed = data?.files || data?.items || []
    const persisted = listed.filter((it) => it.id)
    const failedItems = listed.filter((it) => it.error || it.ok === false)
    const firstFile =
      persisted[0] ||
      nested.find((it) => it.id) ||
      data?.items?.find((it) => it.type !== 'folder' && it.id)
    const skippedOnly = Number(data?.skipped || 0) > 0 && !persisted.length && !failedItems.length
    if (!firstFile?.id && !skippedOnly) {
      const detail =
        failedItems[0]?.error ||
        nested.find((it) => it.error)?.error ||
        data?.error ||
        'Số hóa xong nhưng chưa ghi được vào danh mục tài liệu. Kiểm tra Supabase rồi thử lại.'
      throw new Error(detail)
    }
    setResult(data)
    setProgress({ percent: 0, message: '' })
    resetLinks()
    setDriveHint(null)
    if (firstFile?.id) showIngested(firstFile)
    else {
      loadStats()
      loadDocs()
    }
  }

  async function handleDriveIngest() {
    const links = driveLinks.map((s) => s.trim()).filter(Boolean)
    if (!links.length || uploading || ingestLock.current) return
    if (!isSuper && !categoryId) {
      setError('Chọn ngành / hạng mục / chủ đề trước khi nạp')
      return
    }
    setUploading(true)
    ingestLock.current = true
    setError('')
    setResult(null)
    setProgress({ percent: 1, message: 'Đang đọc Google Drive…' })
    try {
      const res = await adminFetch('/api/upload/drive', {
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
        onDone: (data) => finishLinkIngest(data, () => setDriveLinks([''])),
      })
    } catch (e) {
      setError(e.message)
      setProgress({ percent: 0, message: '' })
      loadDocs()
      loadStats()
    } finally {
      ingestLock.current = false
      setUploading(false)
    }
  }

  async function handleWebIngest() {
    const links = webLinks.map((s) => s.trim()).filter(Boolean)
    if (!links.length || uploading || ingestLock.current) return
    if (!isSuper && !categoryId) {
      setError('Chọn ngành / hạng mục / chủ đề trước khi nạp')
      return
    }
    setUploading(true)
    ingestLock.current = true
    setError('')
    setResult(null)
    setProgress({ percent: 1, message: 'Đang tải trang web…' })
    try {
      const res = await adminFetch('/api/upload/web', {
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
        onDone: (data) => finishLinkIngest(data, () => setWebLinks([''])),
      })
    } catch (e) {
      setError(e.message)
      setProgress({ percent: 0, message: '' })
      loadDocs()
      loadStats()
    } finally {
      ingestLock.current = false
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
    if (!ids.length || uploading || ingestLock.current) return
    if (!window.confirm(`Số hóa lại ${ids.length} tài liệu từ file gốc (R2/Drive)? Vector cũ sẽ bị thay.`)) return
    setError('')
    setUploading(true)
    ingestLock.current = true
    const failed = []
    try {
      for (const id of ids) {
        const res = await adminFetch(`/api/library/documents/${id}/reindex`, { method: 'POST' })
        const data = await res.json().catch(() => ({}))
        if (!res.ok || data.ok === false) failed.push({ id, error: data.error || 'Lỗi' })
      }
      if (failed.length) setError(`Số hóa lại lỗi ${failed.length}/${ids.length}: ${failed[0].error}`)
    } finally {
      ingestLock.current = false
      setUploading(false)
      loadDocs()
      loadStats()
    }
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
      trangThai: trangThaiFromExpired(editHetHieuLuc),
      replacementDocId: editReplacementDocId || null,
      replacementUrl: editReplacementUrl,
      vanBanThayThe: editVanBanThayThe,
    })
    setEditingId('')
  }

  function openDocDetail(doc) {
    setDetailId(doc.id)
    setEditSoHieu(doc.so_hieu || '')
    setEditHetHieuLuc(isExpired(doc.trang_thai))
    setEditReplacementDocId(doc.replacement_doc_id || '')
    setEditReplacementUrl(doc.replacement_url || '')
    setEditVanBanThayThe((doc.van_ban_thay_the || []).join(', '))
  }

  async function saveValidityFields() {
    if (!detailDoc) return
    scheduleCatalogPatch(detailDoc.id, {
      trangThai: trangThaiFromExpired(editHetHieuLuc),
      soHieu: editSoHieu,
      replacementDocId: editReplacementDocId || null,
      replacementUrl: editReplacementUrl,
      vanBanThayThe: editVanBanThayThe,
    })
  }

  function scheduleCatalogPatch(id, body, delay = 450) {
    clearTimeout(catalogPatchTimer.current)
    catalogPatchTimer.current = setTimeout(() => {
      patchCatalog(id, body)
    }, delay)
  }

  useEffect(() => () => clearTimeout(catalogPatchTimer.current), [])

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
          <AdminIngestPanel
            isSuper={isSuper}
            ingestTab={ingestTab}
            setIngestTab={setIngestTab}
            categoryId={categoryId}
            setCategoryId={setCategoryId}
            categoryOptions={categoryOptions}
            uploadR2Hint={uploadR2Hint}
            httpUploadMaxBytes={httpUploadMaxBytes}
            dragOver={dragOver}
            setDragOver={setDragOver}
            acceptFiles={acceptFiles}
            files={files}
            setFiles={setFiles}
            inputRef={inputRef}
            pasteText={pasteText}
            setPasteText={setPasteText}
            pasteTitle={pasteTitle}
            setPasteTitle={setPasteTitle}
            driveLinks={driveLinks}
            setDriveLinks={setDriveLinks}
            driveHint={driveHint}
            setDriveHint={setDriveHint}
            webLinks={webLinks}
            setWebLinks={setWebLinks}
            docTitle={docTitle}
            setDocTitle={setDocTitle}
            docDescription={docDescription}
            setDocDescription={setDocDescription}
            uploading={uploading}
            progress={progress}
            error={error}
            result={result}
            handleUpload={handleUpload}
            handlePasteText={handlePasteText}
            handleDriveIngest={handleDriveIngest}
            handleWebIngest={handleWebIngest}
          />
          <AdminDocCatalog
            groups={groups}
            docs={docs}
            docsLoading={docsLoading}
            isSuper={isSuper}
            allSelected={allSelected}
            toggleAll={toggleAll}
            selected={selected}
            selectedIds={selectedIds}
            bulkCategoryId={bulkCategoryId}
            setBulkCategoryId={setBulkCategoryId}
            categoryOptions={categoryOptions}
            applyBulkCategory={applyBulkCategory}
            reindexIds={reindexIds}
            deleteIds={deleteIds}
            uploading={uploading}
            dropHint={dropHint}
            setDropHint={setDropHint}
            applyDrop={applyDrop}
            detailId={detailId}
            openDocDetail={openDocDetail}
            editingId={editingId}
            setEditingId={setEditingId}
            editName={editName}
            setEditName={setEditName}
            editSoHieu={editSoHieu}
            setEditSoHieu={setEditSoHieu}
            editHetHieuLuc={editHetHieuLuc}
            setEditHetHieuLuc={setEditHetHieuLuc}
            saveEdit={saveEdit}
            changeDocCategory={changeDocCategory}
            toggleOne={toggleOne}
            detailDoc={detailDoc}
            editReplacementDocId={editReplacementDocId}
            setEditReplacementDocId={setEditReplacementDocId}
            editReplacementUrl={editReplacementUrl}
            setEditReplacementUrl={setEditReplacementUrl}
            editVanBanThayThe={editVanBanThayThe}
            setEditVanBanThayThe={setEditVanBanThayThe}
            scheduleCatalogPatch={scheduleCatalogPatch}
            saveValidityFields={saveValidityFields}
          />
        </div>
      </div>
    </div>
  )
}
