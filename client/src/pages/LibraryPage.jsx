import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { ChevronDown, ChevronRight, ExternalLink, FileText, FolderTree, Search } from 'lucide-react'
import DocStatusBadge from '../components/DocStatusBadge'
import { apiUrl } from '../lib/apiBase'
import { cachedJson } from '../lib/apiCache'
import { isExpired, libraryDocHref } from '../lib/docStatus'

const KIND_LABEL = {
  chuyen_muc: 'Chuyên mục',
  chuyen_mon: 'Chuyên môn',
  folder: 'Thư mục',
}

function filterTree(nodes, needle) {
  if (!needle) return nodes
  return (nodes || [])
    .map((n) => {
      const childCats = filterTree(n.children || [], needle)
      const docs = (n.documents || []).filter((d) =>
        [d.label, d.file_name, d.so_hieu, d.folder_path, d.chuyen_mon]
          .filter(Boolean)
          .join(' ')
          .toLowerCase()
          .includes(needle)
      )
      const selfHit = [n.label, n.name, n.kind].join(' ').toLowerCase().includes(needle)
      if (!selfHit && !childCats.length && !docs.length) return null
      return { ...n, children: childCats, documents: docs }
    })
    .filter(Boolean)
}

function findDocPath(nodes, docId, path = []) {
  for (const n of nodes || []) {
    const here = [...path, n.id]
    if ((n.documents || []).some((d) => d.id === docId)) return here
    const child = findDocPath(n.children, docId, here)
    if (child) return child
  }
  return null
}

function DocRow({ doc, highlight }) {
  const repHref = doc.replacement_doc_id
    ? libraryDocHref(doc.replacement_doc_id)
    : doc.replacement_url || null
  const repExternal = !doc.replacement_doc_id && doc.replacement_url

  return (
    <li
      id={`library-doc-${doc.id}`}
      className={`flex flex-col gap-2 border-t border-[var(--hcc-line)]/70 px-3 py-2.5 sm:flex-row sm:items-start sm:justify-between ${
        highlight ? 'bg-[var(--hcc-gold)]/10 ring-1 ring-[var(--hcc-gold)]/35' : ''
      }`}
    >
      <div className="min-w-0">
        <p className="m-0 flex items-start gap-1.5 text-sm text-[var(--hcc-ink)]">
          <FileText className="mt-0.5 h-4 w-4 shrink-0 text-[var(--hcc-red)]" />
          <span className="break-words">{doc.label}</span>
          <DocStatusBadge status={doc.trang_thai} className="mt-0.5" />
        </p>
        <p className="m-0 mt-0.5 pl-5 text-[11px] text-[var(--hcc-muted)]">
          {doc.mo_ta ? `${doc.mo_ta} · ` : ''}
          {doc.folder_path || 'Chưa gắn mục'}
          {doc.chunk_count != null ? ` · ${doc.chunk_count} chunks` : ''}
          {doc.replacement_label ? ` · Thay bằng: ${doc.replacement_label}` : ''}
        </p>
      </div>
      <div className="flex shrink-0 flex-wrap items-center gap-2 pl-5 sm:pl-0">
        {isExpired(doc.trang_thai) && repHref ? (
          repExternal ? (
            <a
              href={repHref}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex cursor-pointer items-center gap-1 rounded-xl border border-[var(--hcc-gold)]/40 px-2.5 py-1.5 text-xs font-medium text-[var(--hcc-gold-bright)]"
            >
              VB thay thế
              <ExternalLink className="h-3 w-3" />
            </a>
          ) : (
            <Link
              to={repHref}
              className="inline-flex cursor-pointer items-center gap-1 rounded-xl border border-[var(--hcc-gold)]/40 px-2.5 py-1.5 text-xs font-medium text-[var(--hcc-gold-bright)]"
            >
              VB thay thế
            </Link>
          )
        ) : null}
        {doc.storage_url ? (
          <a
            href={doc.storage_url}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex cursor-pointer items-center gap-1 rounded-xl bg-[var(--hcc-red)] px-2.5 py-1.5 text-xs font-medium text-white"
          >
            Đọc
            <ExternalLink className="h-3 w-3" />
          </a>
        ) : (
          <span className="text-[11px] text-[var(--hcc-muted)]">Chưa có link</span>
        )}
      </div>
    </li>
  )
}

function CategoryNode({ node, depth, open, toggle, highlightDocId }) {
  const isOpen = open[node.id]
  const hasKids = (node.children || []).length > 0 || (node.documents || []).length > 0
  const pad = Math.min(depth, 5) * 12

  return (
    <li className={depth === 0 ? 'glass-panel overflow-hidden rounded-2xl' : ''}>
      <div
        className={`flex w-full items-center gap-1.5 py-2.5 pr-2 text-left ${
          depth === 0
            ? 'px-3 font-semibold text-[var(--hcc-ink)] hover:bg-[var(--hcc-red-soft)]/40'
            : 'border-t border-[var(--hcc-line)]/60 text-sm text-[var(--hcc-ink)] hover:bg-[var(--hcc-canvas)]'
        }`}
        style={{ paddingLeft: depth === 0 ? undefined : `${12 + pad}px` }}
      >
        <button
          type="button"
          onClick={() => toggle(node.id)}
          className="inline-flex min-w-0 flex-1 cursor-pointer items-center gap-1.5 bg-transparent text-left"
        >
          {hasKids || node.id !== 'uncategorized' ? (
            isOpen ? (
              <ChevronDown className="h-4 w-4 shrink-0 text-[var(--hcc-red)]" />
            ) : (
              <ChevronRight className="h-4 w-4 shrink-0 text-[var(--hcc-muted)]" />
            )
          ) : (
            <span className="w-4" />
          )}
          <span className="min-w-0 break-words">{node.label || node.name}</span>
          {node.kind && KIND_LABEL[node.kind] && (
            <span className="shrink-0 rounded-md bg-[var(--hcc-canvas)] px-1.5 py-0.5 text-[10px] font-medium text-[var(--hcc-muted)]">
              {KIND_LABEL[node.kind]}
            </span>
          )}
          <span className="ml-auto shrink-0 tabular-nums text-[11px] text-[var(--hcc-muted)]">
            {node.docCount ?? 0}
          </span>
        </button>
      </div>

      {isOpen && (
        <ul className="m-0 list-none p-0">
          {(node.children || []).map((child) => (
            <CategoryNode
              key={child.id}
              node={child}
              depth={depth + 1}
              open={open}
              toggle={toggle}
              highlightDocId={highlightDocId}
            />
          ))}
          {(node.documents || []).map((doc) => (
            <DocRow key={doc.id} doc={doc} highlight={doc.id === highlightDocId} />
          ))}
        </ul>
      )}
    </li>
  )
}

/**
 * Thư viện công khai — chỉ xem. Thêm / sửa / xóa chuyên mục ở /quantri.
 */
export default function LibraryPage() {
  const [searchParams] = useSearchParams()
  const focusDocId = searchParams.get('doc') || ''
  const [tree, setTree] = useState([])
  const [total, setTotal] = useState(0)
  const [source, setSource] = useState('')
  const [taxonomySource, setTaxonomySource] = useState('')
  const [q, setQ] = useState('')
  const [open, setOpen] = useState({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [serverHits, setServerHits] = useState([])
  const [searching, setSearching] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const data = await cachedJson(apiUrl('/api/library/tree'))
      setTree(data.tree || [])
      setTotal(data.total || 0)
      setSource(data.source || '')
      setTaxonomySource(data.taxonomySource || '')
      const init = {}
      for (const n of data.tree || []) init[n.id] = true
      setOpen((prev) => ({ ...init, ...prev }))
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    load()
  }, [load])

  useEffect(() => {
    if (!focusDocId || !tree.length) return
    const path = findDocPath(tree, focusDocId)
    if (!path?.length) return
    setOpen((prev) => {
      const next = { ...prev }
      for (const id of path) next[id] = true
      return next
    })
    const t = window.setTimeout(() => {
      document.getElementById(`library-doc-${focusDocId}`)?.scrollIntoView({
        block: 'center',
        behavior: 'smooth',
      })
    }, 120)
    return () => window.clearTimeout(t)
  }, [tree, focusDocId])

  useEffect(() => {
    const needle = q.trim()
    if (needle.length < 2) {
      setServerHits([])
      setSearching(false)
      return undefined
    }
    setSearching(true)
    const t = window.setTimeout(async () => {
      try {
        const res = await fetch(apiUrl(`/api/library/search?q=${encodeURIComponent(needle)}`))
        const data = await res.json()
        if (!res.ok) throw new Error(data.error || 'Không tìm được')
        setServerHits(data.items || [])
      } catch {
        setServerHits([])
      } finally {
        setSearching(false)
      }
    }, 320)
    return () => window.clearTimeout(t)
  }, [q])

  const useServerSearch = q.trim().length >= 2
  const filtered = useMemo(
    () => (useServerSearch ? [] : filterTree(tree, q.trim().toLowerCase())),
    [tree, q, useServerSearch]
  )

  function toggle(id) {
    setOpen((prev) => ({ ...prev, [id]: !prev[id] }))
  }

  return (
    <div className="safe-x mx-auto h-full min-h-0 w-full max-w-6xl overflow-y-auto py-4 xl:px-6">
      <header className="mb-4">
        <p className="m-0 mb-1 flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.18em] text-[var(--hcc-gold-bright)]">
          <FolderTree className="h-3.5 w-3.5" />
          Thư viện
        </p>
        <h1 className="m-0 text-xl font-semibold text-[var(--hcc-ink)] sm:text-2xl">
          Chuyên mục · Chuyên môn · Thư mục
        </h1>
        <p className="m-0 mt-1 text-sm text-[var(--hcc-muted)]">
          {total} tài liệu · nguồn {source || '—'} · cây mục {taxonomySource || '—'}
        </p>
      </header>

      <div className="relative mb-4">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--hcc-muted)]" />
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Lọc theo chuyên mục, số hiệu, tên file…"
          className="field-glass w-full rounded-2xl border py-3 pl-10 pr-3 text-base sm:text-sm"
        />
      </div>

      {loading && <p className="text-sm text-[var(--hcc-muted)]">Đang tải cây…</p>}
      {searching && useServerSearch && (
        <p className="text-sm text-[var(--hcc-muted)]">Đang tìm trên server…</p>
      )}
      {error && (
        <p role="alert" className="text-sm text-[var(--color-destructive)]">
          {error}
        </p>
      )}
      {!loading && useServerSearch && !searching && !serverHits.length && (
        <p className="glass-panel rounded-2xl p-4 text-sm text-[var(--hcc-muted)]">
          Không tìm thấy tài liệu phù hợp.
        </p>
      )}
      {!loading && !useServerSearch && !filtered.length && (
        <p className="glass-panel rounded-2xl p-4 text-sm text-[var(--hcc-muted)]">
          Chưa có chuyên mục. Quản trị thêm mục tại /quantri.
        </p>
      )}

      {useServerSearch && serverHits.length > 0 ? (
        <ul className="m-0 flex list-none flex-col gap-2 p-0">
          {serverHits.map((doc) => (
            <li key={doc.id} className="glass-panel overflow-hidden rounded-2xl">
              <DocRow doc={doc} highlight={doc.id === focusDocId} />
            </li>
          ))}
        </ul>
      ) : (
      <ul className="m-0 flex list-none flex-col gap-2 p-0">
        {filtered.map((node) => (
          <CategoryNode
            key={node.id}
            node={node}
            depth={0}
            open={open}
            toggle={toggle}
            highlightDocId={focusDocId}
          />
        ))}
      </ul>
      )}
    </div>
  )
}
