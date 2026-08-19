import { useCallback, useEffect, useMemo, useState } from 'react'
import { ChevronDown, ChevronRight, ExternalLink, FileText, FolderTree, GripVertical, Search } from 'lucide-react'
import { apiUrl } from '../lib/apiBase'

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

function DocRow({ doc }) {
  return (
    <li className="flex flex-col gap-2 border-t border-[var(--hcc-line)]/70 px-3 py-2.5 sm:flex-row sm:items-start sm:justify-between">
      <div className="min-w-0">
        <p className="m-0 flex items-start gap-1.5 text-sm text-[var(--hcc-ink)]">
          <FileText className="mt-0.5 h-4 w-4 shrink-0 text-[var(--hcc-red)]" />
          <span className="break-words">{doc.label}</span>
        </p>
        <p className="m-0 mt-0.5 pl-5 text-[11px] text-[var(--hcc-muted)]">
          {doc.mo_ta ? `${doc.mo_ta} · ` : ''}
          {doc.folder_path || 'Chưa gắn mục'}
          {doc.trang_thai ? ` · ${doc.trang_thai}` : ''}
          {doc.chunk_count != null ? ` · ${doc.chunk_count} chunks` : ''}
        </p>
      </div>
      <div className="flex shrink-0 flex-wrap items-center gap-2 pl-5 sm:pl-0">
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

function CategoryNode({ node, depth, open, toggle, siblingsIds, parentId, onReorder, allowReorder }) {
  const isOpen = open[node.id]
  const hasKids = (node.children || []).length > 0 || (node.documents || []).length > 0
  const pad = Math.min(depth, 5) * 12
  const [over, setOver] = useState('')

  return (
    <li className={depth === 0 ? 'glass-panel overflow-hidden rounded-2xl' : ''}>
      <div
        onDragOver={(e) => {
          if (!allowReorder) return
          e.preventDefault()
          const rect = e.currentTarget.getBoundingClientRect()
          setOver(e.clientX > rect.right - 96 ? 'after' : 'before')
        }}
        onDragLeave={() => setOver('')}
        onDrop={async (e) => {
          if (!allowReorder) return
          e.preventDefault()
          e.stopPropagation()
          const fromId = e.dataTransfer.getData('text/plain')
          if (!fromId || fromId === node.id) return
          if (!Array.isArray(siblingsIds) || siblingsIds.length < 2) return

          const rect = e.currentTarget.getBoundingClientRect()
          const asAfter = e.clientX > rect.right - 96

          const nextWithout = siblingsIds.filter((id) => id !== fromId)
          const targetIdx = nextWithout.indexOf(node.id)
          if (targetIdx < 0) return
          const insertAt = asAfter ? Math.min(nextWithout.length, targetIdx + 1) : targetIdx
          nextWithout.splice(insertAt, 0, fromId)

          try {
            await onReorder?.({ parentId, ids: nextWithout })
          } finally {
            setOver('')
          }
        }}
        className={`flex w-full items-center gap-1.5 py-2.5 pr-2 text-left ${
          depth === 0
            ? 'px-3 font-semibold text-[var(--hcc-ink)] hover:bg-[var(--hcc-red-soft)]/40'
            : 'border-t border-[var(--hcc-line)]/60 text-sm text-[var(--hcc-ink)] hover:bg-[var(--hcc-canvas)]'
        }`}
        style={{
          paddingLeft: depth === 0 ? undefined : `${12 + pad}px`,
          background:
            over === 'before' ? 'rgba(255,255,255,0.06)' : over === 'after' ? 'rgba(245,158,11,0.12)' : undefined,
        }}
      >
        {allowReorder ? (
          <GripVertical
            className="h-4 w-4 shrink-0 cursor-grab text-[var(--hcc-muted)]"
            title="Kéo thả đổi thứ tự"
            draggable
            onDragStart={(e) => {
              e.dataTransfer.setData('text/plain', node.id)
              e.dataTransfer.effectAllowed = 'move'
            }}
          />
        ) : (
          <span className="w-4 shrink-0" />
        )}

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
              parentId={node.id}
              siblingsIds={(node.children || []).map((c) => c.id)}
              allowReorder={allowReorder}
              onReorder={onReorder}
            />
          ))}
          {(node.documents || []).map((doc) => (
            <DocRow key={doc.id} doc={doc} />
          ))}
        </ul>
      )}
    </li>
  )
}

/**
 * Thư viện công khai — chỉ xem. Thêm / sửa / xóa chuyên mục ở /quantri/chuyen-muc.
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
  const [reorderBusy, setReorderBusy] = useState(false)

  const allowReorder = !q.trim()

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const res = await fetch(apiUrl('/api/library/tree'))
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

  async function reorderCategories(parentId, ids) {
    if (!ids?.length) return
    setReorderBusy(true)
    try {
      const items = ids.map((id, sortOrder) => ({ id, parentId, sortOrder }))
      const res = await fetch(apiUrl('/api/library/categories/reorder'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ items }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok || data.ok === false) throw new Error(data.error || 'Không đổi được thứ tự')
      await load()
    } finally {
      setReorderBusy(false)
    }
  }

  useEffect(() => {
    load()
  }, [load])

  const filtered = useMemo(() => filterTree(tree, q.trim().toLowerCase()), [tree, q])

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
      {error && (
        <p role="alert" className="text-sm text-[var(--color-destructive)]">
          {error}
        </p>
      )}
      {!loading && !filtered.length && (
        <p className="glass-panel rounded-2xl p-4 text-sm text-[var(--hcc-muted)]">
          Chưa có chuyên mục. Quản trị thêm mục tại /quantri → Cài đặt.
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
            parentId={null}
            siblingsIds={filtered.map((n) => n.id)}
            allowReorder={allowReorder && !reorderBusy}
            onReorder={(payload) => reorderCategories(payload.parentId, payload.ids)}
          />
        ))}
      </ul>
    </div>
  )
}
