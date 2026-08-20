import { GripVertical, Pencil, RefreshCw, Trash2 } from 'lucide-react'
import DocStatusBadge from '../../components/DocStatusBadge'
import { isExpired } from '../../lib/docStatus'
import { sourceLabel } from './adminDocUtils'
import AdminDocDetailPanel from './AdminDocDetailPanel'

export default function AdminDocCatalog({
  groups,
  docs,
  docsLoading,
  isSuper,
  allSelected,
  toggleAll,
  selected,
  selectedIds,
  bulkCategoryId,
  setBulkCategoryId,
  categoryOptions,
  applyBulkCategory,
  reindexIds,
  deleteIds,
  uploading,
  dropHint,
  setDropHint,
  applyDrop,
  detailId,
  openDocDetail,
  editingId,
  setEditingId,
  editName,
  setEditName,
  editSoHieu,
  setEditSoHieu,
  editHetHieuLuc,
  setEditHetHieuLuc,
  saveEdit,
  changeDocCategory,
  toggleOne,
  detailDoc,
  editReplacementDocId,
  setEditReplacementDocId,
  editReplacementUrl,
  setEditReplacementUrl,
  editVanBanThayThe,
  setEditVanBanThayThe,
  scheduleCatalogPatch,
  saveValidityFields,
}) {
  return (
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
        <div className="mb-3 flex shrink-0 flex-col gap-2 rounded-2xl border border-white/10 bg-white/5 p-3 sm:flex-row sm:flex-wrap sm:items-center">
          <span className="text-xs text-white/70">{selectedIds.length} đã chọn</span>
          <select
            value={bulkCategoryId}
            onChange={(e) => setBulkCategoryId(e.target.value)}
            className="min-h-11 w-full rounded-xl border border-white/15 bg-black/20 px-2 py-1.5 text-base sm:w-auto sm:min-w-[12rem] sm:text-xs"
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
            className="min-h-11 rounded-full bg-white/10 px-3 text-xs disabled:opacity-40"
          >
            Áp dụng
          </button>
          <button
            type="button"
            disabled={uploading}
            onClick={() => reindexIds(selectedIds)}
            className="min-h-11 rounded-full bg-white/10 px-3 text-xs disabled:opacity-40"
          >
            Số hóa lại đã chọn
          </button>
          <button
            type="button"
            onClick={() => deleteIds(selectedIds)}
            className="min-h-11 rounded-full bg-red-500/20 px-3 text-xs text-red-100"
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
                      onClick={() => openDocDetail(doc)}
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
                        className="h-4 w-4 shrink-0"
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
                          <p className="m-0 flex min-w-0 items-center gap-1.5 truncate text-sm">
                            <span className="min-w-0 truncate">{doc.display_name || doc.file_name}</span>
                            <DocStatusBadge status={doc.trang_thai} />
                          </p>
                        )}
                        <p className="m-0 truncate text-[11px] text-white/45">
                          {doc.mo_ta ? `${doc.mo_ta} · ` : ''}
                          {doc.so_hieu || 'Chưa số hiệu'} · {sourceLabel(doc)} · {doc.chunk_count || 0}{' '}
                          chunks
                          {doc.storage_url || doc.drive_web_view_link ? '' : ' · chưa có link'}
                        </p>
                        {!Number(doc.chunk_count || 0) ? (
                          <p className="m-0 mt-0.5 text-[11px] text-amber-200/90">
                            Chưa có vector — bấm «Số hóa lại» hoặc tải lại file/link Drive.
                          </p>
                        ) : null}
                      </div>
                      <select
                        value={doc.category_id || ''}
                        onClick={(e) => e.stopPropagation()}
                        onChange={(e) => changeDocCategory(doc, e.target.value)}
                        className="max-w-full min-h-11 w-full rounded-lg border border-white/15 bg-black/20 px-2 py-1 text-base sm:max-w-[11rem] sm:min-h-8 sm:w-auto sm:text-[11px]"
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
                        aria-label={`Sửa tên ${doc.display_name || doc.file_name}`}
                        onClick={(e) => {
                          e.stopPropagation()
                          setEditingId(doc.id)
                          setEditName(doc.display_name || doc.file_name || '')
                          setEditSoHieu(doc.so_hieu || '')
                          setEditHetHieuLuc(isExpired(doc.trang_thai))
                        }}
                        className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-full bg-white/10"
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </button>
                      <button
                        type="button"
                        title={!Number(doc.chunk_count || 0) ? 'Số hóa lại (chưa có vector)' : 'Số hóa lại'}
                        aria-label={`Số hóa lại ${doc.display_name || doc.file_name}`}
                        disabled={uploading}
                        onClick={(e) => {
                          e.stopPropagation()
                          reindexIds([doc.id])
                        }}
                        className={`inline-flex min-h-11 min-w-11 items-center justify-center rounded-full ${
                          !Number(doc.chunk_count || 0)
                            ? 'bg-amber-500/25 text-amber-50 ring-1 ring-amber-400/40'
                            : 'bg-white/10'
                        }`}
                      >
                        <RefreshCw className="h-3.5 w-3.5" />
                      </button>
                      <button
                        type="button"
                        title="Xóa"
                        aria-label={`Xóa ${doc.display_name || doc.file_name}`}
                        onClick={(e) => {
                          e.stopPropagation()
                          deleteIds([doc.id])
                        }}
                        className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-full bg-red-500/20 text-red-100"
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
        {docsLoading ? (
          <p className="m-0 text-sm text-white/50">Đang tải danh mục…</p>
        ) : !docs.length ? (
          <p className="m-0 text-sm text-white/50">Chưa có tài liệu.</p>
        ) : null}
      </div>

      <AdminDocDetailPanel
        detailDoc={detailDoc}
        docs={docs}
        editSoHieu={editSoHieu}
        setEditSoHieu={setEditSoHieu}
        editHetHieuLuc={editHetHieuLuc}
        setEditHetHieuLuc={setEditHetHieuLuc}
        editReplacementDocId={editReplacementDocId}
        setEditReplacementDocId={setEditReplacementDocId}
        editReplacementUrl={editReplacementUrl}
        setEditReplacementUrl={setEditReplacementUrl}
        editVanBanThayThe={editVanBanThayThe}
        setEditVanBanThayThe={setEditVanBanThayThe}
        scheduleCatalogPatch={scheduleCatalogPatch}
        saveValidityFields={saveValidityFields}
        openDocDetail={openDocDetail}
        reindexIds={reindexIds}
        uploading={uploading}
      />
    </section>
  )
}
