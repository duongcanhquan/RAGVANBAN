import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  ChevronDown,
  ChevronRight,
  ExternalLink,
  FileText,
  FolderPlus,
  FolderTree,
  Search,
} from 'lucide-react'

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

function flattenCategoryOptions(nodes, prefix = '') {
  const out = []
  for (const n of nodes || []) {
    if (n.id === 'uncategorized') continue
    const path = prefix ? `${prefix} / ${n.label || n.name}` : n.label || n.name
    out.push({ id: n.id, label: path, kind: n.kind })
    out.push(...flattenCategoryOptions(n.children || [], path))
  }
  return out
}

function DocRow({ doc, categoryOptions, onMove }) {
  const [moving, setMoving] = useState(false)
  return (
    <li className="flex flex-col gap-2 border-t border-[var(--hcc-line)]/70 px-3 py-2.5 sm:flex-row sm:items-start sm:justify-between">
      <div className="min-w-0">
        <p className="m-0 flex items-start gap-1.5 text-sm text-[var(--hcc-ink)]">
          <FileText className="mt-0.5 h-4 w-4 shrink-0 text-[var(--hcc-red)]" />
          <span className="break-words">{doc.label}</span>
        </p>
        <p className="m-0 mt-0.5 pl-5 text-[11px] text-[var(--hcc-muted)]">
          {doc.folder_path || 'Chưa gắn mục'}
          {doc.trang_thai ? ` · ${doc.trang_thai}` : ''}
          {doc.chunk_count != null ? ` · ${doc.chunk_count} chunks` : ''}
        </p>
      </div>
      <div className="flex shrink-0 flex-wrap items-center gap-2 pl-5 sm:pl-0">
        <select
          className="max-w-[12rem] rounded-lg border border-[var(--hcc-line)] bg-white px-2 py-1 text-[11px] outline-none focus:border-[var(--hcc-red)]"
          value={doc.category_id || ''}
          disabled={moving}
          onChange={async (e) => {
            const categoryId = e.target.value || null
            setMoving(true)
            try {
              await onMove?.(doc.id, categoryId)
            } finally {
              setMoving(false)
            }
          }}
        >
          <option value="">— Chưa gắn —</option>
          {categoryOptions.map((o) => (
            <option key={o.id} value={o.id}>
              {o.label}
            </option>
          ))}
        </select>
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

function CategoryNode({
  node,
  depth,
  open,
  toggle,
  categoryOptions,
  onMove,
  onCreateChild,
}) {
  const isOpen = open[node.id]
  const hasKids = (node.children || []).length > 0 || (node.documents || []).length > 0
  const [adding, setAdding] = useState(false)
  const [newName, setNewName] = useState('')
  const [newKind, setNewKind] = useState(depth === 0 ? 'chuyen_mon' : 'folder')
  const pad = Math.min(depth, 5) * 12

  return (
    <li className={depth === 0 ? 'overflow-hidden rounded-2xl border border-[var(--hcc-line)] bg-white' : ''}>
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
        {node.id !== 'uncategorized' && (
          <button
            type="button"
            title="Thêm thư mục con"
            onClick={() => setAdding((v) => !v)}
            className="inline-flex cursor-pointer items-center gap-1 rounded-lg px-2 py-1 text-[11px] text-[var(--hcc-red)] hover:bg-[var(--hcc-red-soft)]/50"
          >
            <FolderPlus className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">Sub</span>
          </button>
        )}
      </div>

      {adding && (
        <div
          className="flex flex-wrap items-center gap-2 border-t border-[var(--hcc-line)]/50 bg-[var(--hcc-canvas)] px-3 py-2"
          style={{ paddingLeft: `${20 + pad}px` }}
        >
          <input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="Tên thư mục / chuyên môn…"
            className="min-w-[10rem] flex-1 rounded-lg border border-[var(--hcc-line)] bg-white px-2 py-1.5 text-xs outline-none focus:border-[var(--hcc-red)]"
          />
          <select
            value={newKind}
            onChange={(e) => setNewKind(e.target.value)}
            className="rounded-lg border border-[var(--hcc-line)] bg-white px-2 py-1.5 text-xs"
          >
            <option value="chuyen_mon">Chuyên môn</option>
            <option value="folder">Thư mục con</option>
            <option value="chuyen_muc">Chuyên mục</option>
          </select>
          <button
            type="button"
            disabled={!newName.trim()}
            onClick={async () => {
              const ok = await onCreateChild?.(node.id, newName.trim(), newKind)
              if (ok) {
                setNewName('')
                setAdding(false)
              }
            }}
            className="cursor-pointer rounded-lg bg-[var(--hcc-red)] px-3 py-1.5 text-xs font-medium text-white disabled:opacity-40"
          >
            Tạo
          </button>
        </div>
      )}

      {isOpen && (
        <ul className="m-0 list-none p-0">
          {(node.children || []).map((child) => (
            <CategoryNode
              key={child.id}
              node={child}
              depth={depth + 1}
              open={open}
              toggle={toggle}
              categoryOptions={categoryOptions}
              onMove={onMove}
              onCreateChild={onCreateChild}
            />
          ))}
          {(node.documents || []).map((doc) => (
            <DocRow
              key={doc.id}
              doc={doc}
              categoryOptions={categoryOptions}
              onMove={onMove}
            />
          ))}
        </ul>
      )}
    </li>
  )
}

/**
 * Thư viện theo chuyên mục → chuyên môn → sub-folder.
 */
export default function LibraryPage() {
  const [tree, setTree] = useState([])
  const [total, setTotal] = useState(0)
  const [source, setSource] = useState('')
  const [taxonomySource, setTaxonomySource] = useState('')
  const [q, setQ] = useState('')
  const [open, setOpen] = useState({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [rootName, setRootName] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const res = await fetch('/api/library/tree')
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Không tải được thư viện')
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

  const filtered = useMemo(() => filterTree(tree, q.trim().toLowerCase()), [tree, q])
  const categoryOptions = useMemo(() => flattenCategoryOptions(tree), [tree])

  function toggle(id) {
    setOpen((prev) => ({ ...prev, [id]: !prev[id] }))
  }

  async function moveDoc(docId, categoryId) {
    try {
      const res = await fetch(`/api/library/documents/${encodeURIComponent(docId)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ categoryId }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || 'Không chuyển được mục')
      await load()
    } catch (e) {
      setError(e.message)
    }
  }

  async function createChild(parentId, name, kind) {
    try {
      const res = await fetch('/api/library/categories', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, parentId: parentId || null, kind }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok || !data.ok) throw new Error(data.error || 'Không tạo được mục')
      if (parentId) setOpen((prev) => ({ ...prev, [parentId]: true }))
      await load()
      return true
    } catch (e) {
      setError(e.message)
      return false
    }
  }

  async function createRoot() {
    const name = rootName.trim()
    if (!name) return
    const ok = await createChild(null, name, 'chuyen_muc')
    if (ok) setRootName('')
  }

  return (
    <div className="safe-x mx-auto min-h-[calc(100dvh-var(--nav-h)-var(--bottom-nav-h))] w-full max-w-6xl py-4 xl:px-6">
      <header className="mb-4">
        <p className="m-0 mb-1 flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.18em] text-[var(--hcc-red)]">
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

      <div className="mb-4 flex flex-col gap-2 sm:flex-row">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--hcc-muted)]" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Lọc theo chuyên mục, số hiệu, tên file…"
            className="w-full rounded-2xl border border-[var(--hcc-line)] bg-white py-3 pl-10 pr-3 text-sm outline-none focus:border-[var(--hcc-red)]"
          />
        </div>
        <div className="flex gap-2">
          <input
            value={rootName}
            onChange={(e) => setRootName(e.target.value)}
            placeholder="Thêm chuyên mục gốc…"
            className="min-w-0 flex-1 rounded-2xl border border-[var(--hcc-line)] bg-white px-3 py-3 text-sm outline-none focus:border-[var(--hcc-red)] sm:w-52 sm:flex-none"
          />
          <button
            type="button"
            disabled={!rootName.trim()}
            onClick={createRoot}
            className="inline-flex cursor-pointer items-center gap-1.5 rounded-2xl bg-[var(--hcc-red)] px-4 py-3 text-sm font-medium text-white disabled:opacity-40"
          >
            <FolderPlus className="h-4 w-4" />
            Thêm
          </button>
        </div>
      </div>

      {loading && <p className="text-sm text-[var(--hcc-muted)]">Đang tải cây…</p>}
      {error && (
        <p role="alert" className="text-sm text-[var(--color-destructive)]">
          {error}
        </p>
      )}
      {!loading && !filtered.length && (
        <p className="rounded-2xl border border-[var(--hcc-line)] bg-white p-4 text-sm text-[var(--hcc-muted)]">
          Chưa có chuyên mục. Thêm chuyên mục gốc hoặc upload tài liệu ở Quản trị.
        </p>
      )}

      <ul className="m-0 flex list-none flex-col gap-2 p-0">
        {filtered.map((node) => (
          <CategoryNode
            key={node.id}
            node={node}
            depth={0}
            open={open}
            toggle={toggle}
            categoryOptions={categoryOptions}
            onMove={moveDoc}
            onCreateChild={createChild}
          />
        ))}
      </ul>
    </div>
  )
}
