import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  ChevronDown,
  ChevronRight,
  ExternalLink,
  FileText,
  FolderTree,
  History,
  Lightbulb,
  Play,
  Scale,
  Sparkles,
  Zap,
} from 'lucide-react'
import { fetchServerHistory, loadLocalHistory } from '../lib/chatHistory'
import { MODES } from '../lib/modes'

/**
 * Panel phải (desktop) — thao tác nhanh · cây VB · tình huống · lịch sử.
 */
export default function WorkbenchPanel({
  mode,
  onModeChange,
  onAsk,
  onRestore,
  sessionId,
  streaming,
}) {
  const [tab, setTab] = useState('quick')
  const [tree, setTree] = useState([])
  const [scenarios, setScenarios] = useState([])
  const [history, setHistory] = useState([])
  const [openNodes, setOpenNodes] = useState({})
  const [loading, setLoading] = useState(false)

  const loadSideData = useCallback(async () => {
    setLoading(true)
    try {
      const [libRes, scRes] = await Promise.all([
        fetch('/api/library/tree'),
        fetch('/api/scenarios?limit=30'),
      ])
      if (libRes.ok) {
        const d = await libRes.json()
        setTree(d.tree || [])
        const init = {}
        for (const n of d.tree || []) init[n.id] = true
        setOpenNodes((prev) => ({ ...init, ...prev }))
      }
      if (scRes.ok) {
        const d = await scRes.json()
        setScenarios(d.items || [])
      }
      const local = loadLocalHistory(sessionId)
      const server = await fetchServerHistory(sessionId)
      const map = new Map()
      for (const s of server) {
        map.set(s.id, {
          id: s.id,
          question: s.question,
          answer: s.answer,
          sources: s.citations_used || [],
          created_at: s.created_at,
        })
      }
      for (const l of local) {
        if (!map.has(l.id)) map.set(l.id, l)
      }
      setHistory(
        [...map.values()]
          .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)))
          .slice(0, 25)
      )
    } finally {
      setLoading(false)
    }
  }, [sessionId])

  useEffect(() => {
    loadSideData()
  }, [loadSideData])

  function toggle(id) {
    setOpenNodes((p) => ({ ...p, [id]: !p[id] }))
  }

  const tabs = [
    { id: 'quick', label: 'Nhanh', Icon: Zap },
    { id: 'docs', label: 'Văn bản', Icon: FolderTree },
    { id: 'cases', label: 'Mẫu', Icon: Lightbulb },
    { id: 'hist', label: 'Gần đây', Icon: History },
  ]

  return (
    <aside className="flex h-full min-h-0 w-full flex-col border-l border-[var(--hcc-line)] bg-white/90 backdrop-blur-xl">
      <div className="border-b border-[var(--hcc-line)] px-4 py-3">
        <p className="m-0 text-xs font-semibold uppercase tracking-[0.16em] text-[var(--hcc-red)]">
          Bàn làm việc
        </p>
        <p className="m-0 mt-0.5 text-sm text-[var(--hcc-muted)]">
          Thao tác nhanh cho chuyên viên
        </p>
      </div>

      <div className="flex gap-0.5 border-b border-[var(--hcc-line)] bg-[var(--hcc-canvas)]/80 p-1.5">
        {tabs.map(({ id, label, Icon }) => (
          <button
            key={id}
            type="button"
            onClick={() => setTab(id)}
            className={`flex flex-1 cursor-pointer flex-col items-center gap-0.5 rounded-xl px-1 py-2 text-[10px] font-semibold transition ${
              tab === id
                ? 'bg-white text-[var(--hcc-red)] shadow-sm'
                : 'text-[var(--hcc-muted)] hover:bg-white/60'
            }`}
          >
            <Icon className="h-4 w-4" />
            {label}
          </button>
        ))}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-3">
        {tab === 'quick' && (
          <div className="space-y-4">
            <div>
              <p className="m-0 mb-2 text-[11px] font-semibold uppercase tracking-wider text-[var(--hcc-muted)]">
                Chế độ xử lý
              </p>
              <div className="grid grid-cols-2 gap-2">
                {Object.values(MODES).map((m) => (
                  <button
                    key={m.id}
                    type="button"
                    disabled={streaming}
                    onClick={() => onModeChange?.(m.id)}
                    className={`cursor-pointer rounded-2xl border px-3 py-3 text-left transition ${
                      mode === m.id
                        ? m.id === 'advise'
                          ? 'border-[var(--hcc-gold)] bg-[linear-gradient(135deg,#fff9e6,#fff)]'
                          : 'border-[var(--hcc-red)] bg-[var(--hcc-red-soft)]'
                        : 'border-[var(--hcc-line)] bg-white hover:border-[var(--hcc-red)]/40'
                    } disabled:opacity-50`}
                  >
                    <span className="flex items-center gap-1.5 text-sm font-semibold text-[var(--hcc-ink)]">
                      {m.id === 'advise' ? (
                        <Sparkles className="h-4 w-4 text-[var(--hcc-gold)]" />
                      ) : (
                        <Scale className="h-4 w-4 text-[var(--hcc-red)]" />
                      )}
                      {m.label}
                    </span>
                    <span className="mt-1 block text-[11px] leading-snug text-[var(--hcc-muted)]">
                      {m.short}
                    </span>
                  </button>
                ))}
              </div>
            </div>

            <div>
              <p className="m-0 mb-2 text-[11px] font-semibold uppercase tracking-wider text-[var(--hcc-muted)]">
                Câu hỏi mẫu
              </p>
              <ul className="m-0 flex list-none flex-col gap-1.5 p-0">
                {(MODES[mode]?.examples || []).map((ex) => (
                  <li key={ex}>
                    <button
                      type="button"
                      disabled={streaming}
                      onClick={() => onAsk?.(ex)}
                      className="w-full cursor-pointer rounded-xl border border-[var(--hcc-line)] bg-white px-3 py-2.5 text-left text-xs leading-snug text-[var(--hcc-ink)] transition hover:border-[var(--hcc-red)] hover:bg-[var(--hcc-red-soft)]/40 disabled:opacity-50"
                    >
                      {ex}
                    </button>
                  </li>
                ))}
              </ul>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <Link
                to="/thu-vien"
                className="rounded-2xl border border-[var(--hcc-line)] bg-white px-3 py-3 text-center text-xs font-medium text-[var(--hcc-ink)] hover:border-[var(--hcc-red)]"
              >
                <FolderTree className="mx-auto mb-1 h-4 w-4 text-[var(--hcc-red)]" />
                Thư viện đầy đủ
              </Link>
              <Link
                to="/tinh-huong"
                className="rounded-2xl border border-[var(--hcc-line)] bg-white px-3 py-3 text-center text-xs font-medium text-[var(--hcc-ink)] hover:border-[var(--hcc-red)]"
              >
                <Lightbulb className="mx-auto mb-1 h-4 w-4 text-[var(--hcc-gold)]" />
                Kho tình huống
              </Link>
              <Link
                to="/admin"
                className="col-span-2 rounded-2xl border border-[var(--hcc-gold)]/40 bg-[linear-gradient(135deg,#fff9e6,#fff)] px-3 py-3 text-center text-xs font-semibold text-[var(--hcc-ink)]"
              >
                Nạp VB / PDF / Website → Quản trị
              </Link>
            </div>
          </div>
        )}

        {tab === 'docs' && (
          <div>
            <div className="mb-2 flex items-center justify-between">
              <p className="m-0 text-[11px] font-semibold uppercase tracking-wider text-[var(--hcc-muted)]">
                Cây văn bản
              </p>
              <button
                type="button"
                onClick={loadSideData}
                className="cursor-pointer text-[11px] text-[var(--hcc-red)]"
              >
                Làm mới
              </button>
            </div>
            {loading && !tree.length && (
              <p className="text-xs text-[var(--hcc-muted)]">Đang tải…</p>
            )}
            {!loading && !tree.length && (
              <p className="rounded-xl border border-dashed border-[var(--hcc-line)] p-3 text-xs text-[var(--hcc-muted)]">
                Chưa có văn bản. Vào Quản trị để nạp dữ liệu.
              </p>
            )}
            <ul className="m-0 flex list-none flex-col gap-1.5 p-0">
              {tree.map((loai) => (
                <CategoryBranch
                  key={loai.id}
                  node={loai}
                  depth={0}
                  openNodes={openNodes}
                  toggle={toggle}
                  streaming={streaming}
                  onAsk={onAsk}
                />
              ))}
            </ul>
          </div>
        )}

        {tab === 'cases' && (
          <div className="space-y-2">
            <p className="m-0 mb-2 text-[11px] font-semibold uppercase tracking-wider text-[var(--hcc-muted)]">
              Tình huống mẫu
            </p>
            {!scenarios.length && (
              <p className="text-xs text-[var(--hcc-muted)]">Chưa có mẫu — thêm ở Kho tình huống.</p>
            )}
            {scenarios.map((s) => (
              <article
                key={s.id}
                className="rounded-2xl border border-[var(--hcc-line)] bg-white p-3"
              >
                <h3 className="m-0 text-sm font-semibold text-[var(--hcc-ink)]">{s.title}</h3>
                <p className="m-0 mt-1 line-clamp-2 text-[11px] text-[var(--hcc-muted)]">
                  {s.situation}
                </p>
                <button
                  type="button"
                  disabled={streaming}
                  onClick={() => {
                    onModeChange?.('advise')
                    onAsk?.(s.suggested_question || s.title)
                  }}
                  className="mt-2 inline-flex cursor-pointer items-center gap-1 rounded-xl bg-[var(--hcc-red)] px-2.5 py-1.5 text-[11px] font-semibold text-white disabled:opacity-40"
                >
                  <Play className="h-3 w-3" />
                  Dùng để hỏi
                </button>
              </article>
            ))}
          </div>
        )}

        {tab === 'hist' && (
          <div className="space-y-2">
            <p className="m-0 mb-2 text-[11px] font-semibold uppercase tracking-wider text-[var(--hcc-muted)]">
              Tra cứu gần đây
            </p>
            {!history.length && (
              <p className="text-xs text-[var(--hcc-muted)]">Chưa có lịch sử trên phiên này.</p>
            )}
            {history.map((h) => (
              <button
                key={h.id}
                type="button"
                onClick={() => onRestore?.(h)}
                className="w-full cursor-pointer rounded-xl border border-[var(--hcc-line)] bg-white px-3 py-2.5 text-left transition hover:border-[var(--hcc-red)]"
              >
                <p className="m-0 line-clamp-2 text-xs font-medium text-[var(--hcc-ink)]">
                  {h.question}
                </p>
                <p className="m-0 mt-1 text-[10px] text-[var(--hcc-muted)]">
                  {h.created_at ? new Date(h.created_at).toLocaleString('vi-VN') : ''}
                </p>
              </button>
            ))}
          </div>
        )}
      </div>
    </aside>
  )
}

function CategoryBranch({ node, depth, openNodes, toggle, streaming, onAsk }) {
  const isOpen = openNodes[node.id]
  const pad = Math.min(depth, 4) * 8
  return (
    <li
      className={
        depth === 0
          ? 'overflow-hidden rounded-xl border border-[var(--hcc-line)] bg-white'
          : 'border-t border-[var(--hcc-line)]/70'
      }
    >
      <button
        type="button"
        onClick={() => toggle(node.id)}
        className={`flex w-full cursor-pointer items-center gap-1.5 py-2 text-left hover:bg-[var(--hcc-red-soft)]/30 ${
          depth === 0
            ? 'px-2.5 text-xs font-semibold text-[var(--hcc-ink)]'
            : 'pr-2 text-[11px] font-medium text-[var(--hcc-muted)]'
        }`}
        style={depth > 0 ? { paddingLeft: `${10 + pad}px` } : undefined}
      >
        {isOpen ? (
          <ChevronDown className="h-3.5 w-3.5 shrink-0 text-[var(--hcc-red)]" />
        ) : (
          <ChevronRight className="h-3.5 w-3.5 shrink-0" />
        )}
        <span className="min-w-0 flex-1 break-words">{node.label}</span>
        <span className="tabular-nums">{node.docCount ?? 0}</span>
      </button>
      {isOpen && (
        <>
          {(node.children || []).map((child) => (
            <ul key={child.id} className="m-0 list-none p-0">
              <CategoryBranch
                node={child}
                depth={depth + 1}
                openNodes={openNodes}
                toggle={toggle}
                streaming={streaming}
                onAsk={onAsk}
              />
            </ul>
          ))}
          {(node.documents || []).slice(0, 40).map((doc) => (
            <div
              key={doc.id}
              className="flex items-start gap-2 border-t border-[var(--hcc-line)]/50 bg-[var(--hcc-canvas)] px-3 py-2"
              style={{ paddingLeft: `${14 + pad}px` }}
            >
              <FileText className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[var(--hcc-red)]" />
              <div className="min-w-0 flex-1">
                <p className="m-0 break-words text-[11px] leading-snug text-[var(--hcc-ink)]">
                  {doc.label}
                </p>
                <div className="mt-1 flex flex-wrap gap-1">
                  {doc.storage_url && (
                    <a
                      href={doc.storage_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex cursor-pointer items-center gap-0.5 rounded-md bg-[var(--hcc-red)] px-1.5 py-0.5 text-[10px] font-medium text-white"
                    >
                      Đọc <ExternalLink className="h-2.5 w-2.5" />
                    </a>
                  )}
                  <button
                    type="button"
                    disabled={streaming}
                    onClick={() =>
                      onAsk?.(
                        `Tóm tắt nội dung và quy định chính của văn bản: ${doc.label}`
                      )
                    }
                    className="cursor-pointer rounded-md border border-[var(--hcc-line)] bg-white px-1.5 py-0.5 text-[10px] text-[var(--hcc-muted)] hover:text-[var(--hcc-red)] disabled:opacity-40"
                  >
                    Hỏi về VB này
                  </button>
                </div>
              </div>
            </div>
          ))}
        </>
      )}
    </li>
  )
}
