import { useCallback, useEffect, useMemo, useState } from 'react'
import { useOutletContext } from 'react-router-dom'
import { FolderPlus, GripVertical, Pencil, Trash2 } from 'lucide-react'
import { adminFetch } from '../../lib/adminApi'

const KIND_LABEL = {
  chuyen_muc: 'Chuyên mục',
  chuyen_mon: 'Chuyên môn',
  folder: 'Thư mục',
}

function annotateTree(nodes, me) {
  const isSuper = me?.role === 'super_admin'
  const allowed = new Set(me?.allowedCategoryIds || [])
  const prune = (n) => {
    const children = (n.children || []).map(prune).filter(Boolean)
    const canManage = isSuper || allowed.has(n.id)
    if (canManage || children.length) {
      return { ...n, canManage, children }
    }
    return null
  }
  return (nodes || []).map(prune).filter(Boolean)
}

function wouldCycle(items, id, newParentId) {
  if (!newParentId) return false
  if (id === newParentId) return true
  const byId = new Map(items.map((c) => [c.id, c]))
  let cur = byId.get(newParentId)
  const guard = new Set()
  while (cur && !guard.has(cur.id)) {
    if (cur.id === id) return true
    guard.add(cur.id)
    cur = cur.parent_id ? byId.get(cur.parent_id) : null
  }
  return false
}

function buildMovePayload(items, fromId, toId, asChild) {
  const from = items.find((c) => c.id === fromId)
  const to = items.find((c) => c.id === toId)
  if (!from || !to || fromId === toId) return null
  const newParent = asChild ? to.id : to.parent_id || null
  if (wouldCycle(items, fromId, newParent)) return null

  const oldParent = from.parent_id || null
  const next = items.map((c) => (c.id === fromId ? { ...c, parent_id: newParent } : c))
  const siblings = next
    .filter((c) => (c.parent_id || null) === (newParent || null) && c.id !== fromId)
    .sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0) || String(a.name).localeCompare(b.name, 'vi'))
  const insertAt = asChild ? siblings.length : Math.max(0, siblings.findIndex((c) => c.id === toId))
  const moved = next.find((c) => c.id === fromId)
  siblings.splice(insertAt, 0, moved)

  const payload = siblings.map((c, i) => ({
    id: c.id,
    parentId: newParent,
    sortOrder: i,
  }))

  if (String(oldParent || '') !== String(newParent || '')) {
    next
      .filter((c) => (c.parent_id || null) === oldParent && c.id !== fromId)
      .sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0))
      .forEach((c, i) => payload.push({ id: c.id, parentId: oldParent, sortOrder: i }))
  }
  return payload
}

function CategoryRow({ node, depth, onCreate, onUpdate, onDelete, onMove }) {
  const [editing, setEditing] = useState(false)
  const [adding, setAdding] = useState(false)
  const [name, setName] = useState(node.name || '')
  const [kind, setKind] = useState(node.kind || 'folder')
  const [childName, setChildName] = useState('')
  const [childKind, setChildKind] = useState(depth === 0 ? 'chuyen_mon' : 'folder')
  const [busy, setBusy] = useState(false)
  const [over, setOver] = useState('')

  const pad = Math.min(depth, 6) * 14

  async function saveEdit() {
    const next = name.trim()
    if (!next) return
    setBusy(true)
    try {
      await onUpdate(node.id, { name: next, kind })
      setEditing(false)
    } finally {
      setBusy(false)
    }
  }

  async function saveChild() {
    const next = childName.trim()
    if (!next) return
    setBusy(true)
    try {
      const ok = await onCreate(node.id, next, childKind)
      if (ok) {
        setChildName('')
        setAdding(false)
      }
    } finally {
      setBusy(false)
    }
  }

  return (
    <li className="m-0 list-none">
      <div
        draggable={node.canManage}
        onDragStart={(e) => {
          e.dataTransfer.setData('text/plain', node.id)
          e.dataTransfer.effectAllowed = 'move'
        }}
        onDragOver={(e) => {
          if (!node.canManage) return
          e.preventDefault()
          e.dataTransfer.dropEffect = 'move'
          const rect = e.currentTarget.getBoundingClientRect()
          setOver(e.shiftKey || e.clientX > rect.right - 96 ? 'child' : 'before')
        }}
        onDragLeave={() => setOver('')}
        onDrop={(e) => {
          e.preventDefault()
          e.stopPropagation()
          const fromId = e.dataTransfer.getData('text/plain')
          const rect = e.currentTarget.getBoundingClientRect()
          const asChild = e.shiftKey || e.clientX > rect.right - 96
          onMove?.(fromId, node.id, asChild)
          setOver('')
        }}
        className={`flex flex-wrap items-center gap-2 border-b border-white/5 py-2.5 ${
          over === 'child' ? 'bg-amber-400/15' : over === 'before' ? 'bg-white/10' : ''
        }`}
        style={{ paddingLeft: `${pad}px` }}
      >
        {node.canManage ? (
          <GripVertical className="h-4 w-4 shrink-0 cursor-grab text-white/35" title="Kéo thả đổi vị trí" />
        ) : (
          <span className="w-4" />
        )}
        <div className="min-w-0 flex-1">
          {editing && node.canManage ? (
            <div className="flex flex-wrap gap-2">
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="min-w-[10rem] flex-1 rounded-xl border border-white/15 bg-black/20 px-3 py-1.5 text-sm"
              />
              <select
                value={kind}
                onChange={(e) => setKind(e.target.value)}
                className="rounded-xl border border-white/15 bg-black/20 px-2 py-1.5 text-xs"
              >
                <option value="chuyen_muc">Chuyên mục</option>
                <option value="chuyen_mon">Chuyên môn</option>
                <option value="folder">Thư mục</option>
              </select>
              <button
                type="button"
                disabled={busy}
                onClick={saveEdit}
                className="rounded-full bg-[var(--hcc-red)] px-3 py-1 text-xs font-medium"
              >
                Lưu
              </button>
              <button
                type="button"
                onClick={() => {
                  setEditing(false)
                  setName(node.name || '')
                  setKind(node.kind || 'folder')
                }}
                className="rounded-full bg-white/10 px-3 py-1 text-xs"
              >
                Hủy
              </button>
            </div>
          ) : (
            <p className="m-0 text-sm">
              <span className={node.canManage ? 'font-medium' : 'text-white/55'}>{node.name}</span>
              <span className="ml-2 rounded-md bg-white/10 px-1.5 py-0.5 text-[10px] text-white/60">
                {KIND_LABEL[node.kind] || node.kind}
              </span>
              {over === 'child' ? (
                <span className="ml-2 text-[10px] text-amber-200">Thả để đưa vào trong</span>
              ) : null}
            </p>
          )}
        </div>
        {node.canManage && !editing ? (
          <div className="flex gap-1">
            <button
              type="button"
              title="Sửa tên / loại"
              onClick={() => setEditing(true)}
              className="inline-flex items-center gap-1 rounded-full bg-white/10 px-2.5 py-1 text-[11px]"
            >
              <Pencil className="h-3 w-3" />
              Sửa
            </button>
            <button
              type="button"
              title="Thêm mục con"
              onClick={() => setAdding((v) => !v)}
              className="inline-flex items-center gap-1 rounded-full bg-white/10 px-2.5 py-1 text-[11px]"
            >
              <FolderPlus className="h-3 w-3" />
              Thêm
            </button>
            <button
              type="button"
              title="Xóa"
              onClick={() => onDelete(node)}
              className="inline-flex items-center gap-1 rounded-full bg-red-500/20 px-2.5 py-1 text-[11px] text-red-100"
            >
              <Trash2 className="h-3 w-3" />
              Xóa
            </button>
          </div>
        ) : null}
      </div>

      {adding && node.canManage ? (
        <div
          className="flex flex-wrap items-center gap-2 border-b border-white/5 bg-white/5 py-2"
          style={{ paddingLeft: `${pad + 14}px` }}
        >
          <input
            value={childName}
            onChange={(e) => setChildName(e.target.value)}
            placeholder="Tên mục con…"
            className="min-w-[10rem] flex-1 rounded-xl border border-white/15 bg-black/20 px-3 py-1.5 text-sm"
          />
          <select
            value={childKind}
            onChange={(e) => setChildKind(e.target.value)}
            className="rounded-xl border border-white/15 bg-black/20 px-2 py-1.5 text-xs"
          >
            <option value="chuyen_mon">Chuyên môn</option>
            <option value="folder">Thư mục</option>
            <option value="chuyen_muc">Chuyên mục</option>
          </select>
          <button
            type="button"
            disabled={busy || !childName.trim()}
            onClick={saveChild}
            className="rounded-full bg-[var(--hcc-red)] px-3 py-1 text-xs font-medium disabled:opacity-40"
          >
            Tạo
          </button>
        </div>
      ) : null}

      {(node.children || []).length ? (
        <ul className="m-0 list-none p-0">
          {node.children.map((child) => (
            <CategoryRow
              key={child.id}
              node={child}
              depth={depth + 1}
              onCreate={onCreate}
              onUpdate={onUpdate}
              onDelete={onDelete}
              onMove={onMove}
            />
          ))}
        </ul>
      ) : null}
    </li>
  )
}

export default function CategoryTreeEditor() {
  const { me } = useOutletContext()
  const [tree, setTree] = useState([])
  const [items, setItems] = useState([])
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [rootName, setRootName] = useState('')
  const isSuper = me?.role === 'super_admin'

  const load = useCallback(async () => {
    const res = await adminFetch('/api/quantri/categories')
    const data = await res.json().catch(() => ({}))
    if (!res.ok) throw new Error(data.error || 'Không tải được chuyên mục')
    setTree(data.tree || [])
    setItems(data.items || [])
  }, [])

  useEffect(() => {
    load().catch((e) => setError(e.message))
  }, [load])

  const visible = useMemo(() => annotateTree(tree, me), [tree, me])

  async function createCategory(parentId, name, kind) {
    setError('')
    const res = await adminFetch('/api/library/categories', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, parentId: parentId || null, kind }),
    })
    const data = await res.json().catch(() => ({}))
    if (!res.ok || !data.ok) {
      setError(data.error || 'Không tạo được')
      return false
    }
    await load()
    return true
  }

  async function updateCategory(id, patch) {
    setError('')
    const res = await adminFetch(`/api/library/categories/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    })
    const data = await res.json().catch(() => ({}))
    if (!res.ok || !data.ok) {
      setError(data.error || 'Không sửa được')
      throw new Error(data.error || 'Không sửa được')
    }
    await load()
  }

  async function deleteCategory(node) {
    if (
      !window.confirm(
        `Xóa «${node.name}» và mọi mục con? Tài liệu trong các mục này sẽ về «Chưa gắn chuyên mục».`
      )
    ) {
      return
    }
    setError('')
    const res = await adminFetch(`/api/library/categories/${encodeURIComponent(node.id)}`, {
      method: 'DELETE',
    })
    const data = await res.json().catch(() => ({}))
    if (!res.ok || data.ok === false) {
      setError(data.error || 'Không xóa được')
      return
    }
    await load()
  }

  async function moveNode(fromId, toId, asChild) {
    const payload = buildMovePayload(items, fromId, toId, asChild)
    if (!payload?.length) return
    setError('')
    const res = await adminFetch('/api/library/categories/reorder', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ items: payload }),
    })
    const data = await res.json().catch(() => ({}))
    if (!res.ok || data.ok === false) {
      setError(data.error || 'Không đổi vị trí được')
      return
    }
    await load()
  }

  async function createRoot(e) {
    e.preventDefault()
    const name = rootName.trim()
    if (!name) return
    setBusy(true)
    try {
      const ok = await createCategory(null, name, 'chuyen_muc')
      if (ok) setRootName('')
    } finally {
      setBusy(false)
    }
  }

  return (
    <section>
      <h2 className="m-0 text-lg font-semibold">Chuyên mục</h2>
      <p className="m-0 mt-1 mb-4 text-sm text-white/65">
        Thêm · sửa · xóa. Kéo icon nắm bên trái để đổi vị trí; giữ Shift (hoặc thả về phía phải) để đưa vào
        trong mục đích.
      </p>
      {error ? <p className="mb-4 text-sm text-red-200">{error}</p> : null}

      {isSuper ? (
        <form
          onSubmit={createRoot}
          className="mb-4 flex flex-col gap-2 rounded-3xl border border-white/10 bg-white/5 p-4 sm:flex-row sm:items-center"
        >
          <input
            value={rootName}
            onChange={(e) => setRootName(e.target.value)}
            placeholder="Tên chuyên mục gốc…"
            className="min-w-0 flex-1 rounded-xl border border-white/15 bg-black/20 px-3 py-2 text-sm"
          />
          <button
            type="submit"
            disabled={busy || !rootName.trim()}
            className="inline-flex items-center justify-center gap-1.5 rounded-xl bg-[var(--hcc-red)] px-4 py-2 text-sm font-semibold disabled:opacity-40"
          >
            <FolderPlus className="h-4 w-4" />
            Thêm gốc
          </button>
        </form>
      ) : (
        <p className="mb-4 rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-xs text-white/60">
          Bạn thao tác trên cây được giao. Không tạo được chuyên mục gốc.
        </p>
      )}

      {!visible.length ? (
        <p className="rounded-2xl border border-white/10 bg-white/5 p-4 text-sm text-white/60">
          Chưa có chuyên mục để quản lý.
        </p>
      ) : (
        <ul className="m-0 list-none overflow-hidden rounded-3xl border border-white/10 bg-white/5 px-4 py-1">
          {visible.map((node) => (
            <CategoryRow
              key={node.id}
              node={node}
              depth={0}
              onCreate={createCategory}
              onUpdate={updateCategory}
              onDelete={deleteCategory}
              onMove={moveNode}
            />
          ))}
        </ul>
      )}
    </section>
  )
}
