import { useEffect, useMemo, useRef, useState } from 'react'
import { Check, ChevronDown, FolderTree, X } from 'lucide-react'
import { apiUrl } from '../lib/apiBase'

function walkCheck(nodes, depth, selected, toggle, disabled) {
  return (nodes || []).map((n) => {
    const on = selected.has(n.id)
    const kids = n.children || []
    return (
      <li key={n.id}>
        <label
          className="flex min-h-11 cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-sm text-white/85 hover:bg-white/10"
          style={{ paddingLeft: 8 + Math.min(depth, 5) * 14 }}
        >
          <input
            type="checkbox"
            className="h-4 w-4 accent-[var(--hcc-gold-bright)]"
            checked={on}
            disabled={disabled}
            onChange={() => !disabled && toggle(n.id)}
          />
          <span className="min-w-0 flex-1 truncate">{n.name || n.label}</span>
          {on ? <Check className="h-3.5 w-3.5 shrink-0 text-[var(--hcc-gold-bright)]" /> : null}
        </label>
        {kids.length ? (
          <ul className="m-0 list-none p-0">{walkCheck(kids, depth + 1, selected, toggle, disabled)}</ul>
        ) : null}
      </li>
    )
  })
}

/**
 * Phạm vi Tra cứu / Tư vấn: không chọn = cả kho; chọn mục cha gồm mục con (server mở rộng).
 */
export default function CategoryScopePicker({ selectedIds, onChange, disabled = false }) {
  const [open, setOpen] = useState(false)
  const [tree, setTree] = useState([])
  const [items, setItems] = useState([])
  const boxRef = useRef(null)
  const selected = useMemo(() => new Set(selectedIds || []), [selectedIds])

  useEffect(() => {
    fetch(apiUrl('/api/library/categories'))
      .then((r) => r.json())
      .then((d) => {
        setTree(d.tree || [])
        setItems(d.items || [])
      })
      .catch(() => {})
  }, [])

  useEffect(() => {
    if (disabled) setOpen(false)
  }, [disabled])

  useEffect(() => {
    if (!open) return
    function onDoc(e) {
      if (!boxRef.current?.contains(e.target)) setOpen(false)
    }
    document.addEventListener('pointerdown', onDoc)
    return () => document.removeEventListener('pointerdown', onDoc)
  }, [open])

  const byId = useMemo(() => new Map(items.map((c) => [c.id, c])), [items])
  const chips = (selectedIds || []).map((id) => byId.get(id)?.name || id)

  function toggle(id) {
    const next = new Set(selected)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    onChange([...next])
  }

  function clear() {
    onChange([])
  }

  const menu = (
    <>
      <p className="m-0 px-2 pb-1 text-[11px] text-white/45">
        Chọn mục cha thì hệ thống tìm cả mục con. Không chọn = cả kho.
      </p>
      {tree.length ? (
        <ul className="m-0 list-none p-0">{walkCheck(tree, 0, selected, toggle, disabled)}</ul>
      ) : (
        <p className="m-0 px-2 py-2 text-xs text-white/50">Chưa có cây danh mục.</p>
      )}
    </>
  )

  return (
    <div ref={boxRef} className="relative mx-auto w-full max-w-none px-3 pb-0 pt-1.5 sm:px-4 xl:px-6">
      <div className="flex min-h-11 flex-wrap items-center gap-1.5">
        <span className="inline-flex items-center gap-1 text-[11px] font-medium uppercase tracking-wide text-white/45">
          <FolderTree className="h-3 w-3" />
          Phạm vi
        </span>
        <button
          type="button"
          disabled={disabled}
          onClick={clear}
          className={`min-h-11 rounded-full border px-3 text-[11px] font-semibold transition disabled:opacity-40 sm:min-h-8 sm:py-0.5 ${
            selected.size === 0
              ? 'border-[var(--hcc-gold-bright)]/50 bg-[var(--hcc-gold-bright)]/15 text-[var(--hcc-gold-bright)]'
              : 'border-white/15 text-white/55 hover:bg-white/10 hover:text-white'
          }`}
        >
          Cả kho
        </button>
        {chips.map((name, i) => (
          <button
            key={selectedIds[i]}
            type="button"
            disabled={disabled}
            onClick={() => toggle(selectedIds[i])}
            className="inline-flex min-h-11 max-w-[10rem] items-center gap-1 rounded-full border border-white/20 bg-white/10 px-3 text-[11px] text-white/90 disabled:opacity-40 sm:min-h-8"
            title="Bỏ mục này"
          >
            <span className="truncate">{name}</span>
            <X className="h-3 w-3 shrink-0 opacity-70" />
          </button>
        ))}
        <button
          type="button"
          disabled={disabled}
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          className="inline-flex min-h-11 items-center gap-1 rounded-full border border-white/15 px-3 text-[11px] font-medium text-white/70 hover:bg-white/10 hover:text-white disabled:opacity-40 sm:min-h-8"
        >
          Chọn mục
          <ChevronDown className={`h-3 w-3 transition ${open ? 'rotate-180' : ''}`} />
        </button>
      </div>
      {open ? (
        <>
          <div className="fixed inset-0 z-[45] bg-black/40 xl:hidden" onClick={() => setOpen(false)} />
          <div className="fixed inset-x-0 bottom-[var(--bottom-nav-h)] z-50 max-h-[70dvh] overflow-y-auto rounded-t-3xl border border-white/15 bg-[#1a1c24] p-3 shadow-xl xl:absolute xl:bottom-full xl:left-4 xl:right-4 xl:mb-1 xl:max-h-64 xl:rounded-2xl xl:bg-[#1a1c24]/95 xl:backdrop-blur-xl 2xl:left-6 2xl:right-6">
            <div className="mx-auto mb-2 h-1 w-10 rounded-full bg-white/25 xl:hidden" aria-hidden="true" />
            {menu}
          </div>
        </>
      ) : null}
    </div>
  )
}
