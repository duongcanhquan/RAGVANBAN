import { Link } from 'react-router-dom'
import DocStatusBadge from '../../components/DocStatusBadge'
import { libraryDocHref, trangThaiFromExpired } from '../../lib/docStatus'
import { sourceLabel } from './adminDocUtils'

export default function AdminDocDetailPanel({
  detailDoc,
  docs,
  editSoHieu,
  setEditSoHieu,
  editHetHieuLuc,
  setEditHetHieuLuc,
  editReplacementDocId,
  setEditReplacementDocId,
  editReplacementUrl,
  setEditReplacementUrl,
  editVanBanThayThe,
  setEditVanBanThayThe,
  scheduleCatalogPatch,
  saveValidityFields,
  openDocDetail,
  reindexIds,
  uploading,
}) {
  if (!detailDoc) return null

  return (
    <div className="mt-3 shrink-0 rounded-2xl border border-white/10 bg-black/20 p-3 text-xs text-white/70">
      <p className="m-0 flex flex-wrap items-center gap-2 text-sm font-medium text-white">
        <span>{detailDoc.display_name || detailDoc.file_name}</span>
        <DocStatusBadge status={editHetHieuLuc ? 'Hết hiệu lực' : detailDoc.trang_thai} />
      </p>
      {detailDoc.mo_ta ? (
        <p className="m-0 mt-1 text-[11px] text-white/60">{detailDoc.mo_ta}</p>
      ) : null}
      {!Number(detailDoc.chunk_count || 0) ? (
        <div className="mt-2 flex flex-wrap items-center gap-2 rounded-xl border border-amber-400/30 bg-amber-500/10 px-2.5 py-2 text-[11px] text-amber-50">
          <span>Chưa có chunks/vector — chat không tìm được nội dung file này.</span>
          {typeof reindexIds === 'function' ? (
            <button
              type="button"
              disabled={uploading}
              onClick={() => reindexIds([detailDoc.id])}
              className="rounded-full bg-white/15 px-2.5 py-1 font-semibold disabled:opacity-40"
            >
              Số hóa lại ngay
            </button>
          ) : null}
        </div>
      ) : null}
      <dl className="m-0 mt-2 grid grid-cols-[7rem_1fr] gap-x-2 gap-y-1">
        <dt className="text-white/40">Số hiệu</dt>
        <dd className="m-0">
          <input
            value={editSoHieu}
            onChange={(e) => setEditSoHieu(e.target.value)}
            onBlur={() =>
              scheduleCatalogPatch(detailDoc.id, {
                soHieu: editSoHieu,
                trangThai: trangThaiFromExpired(editHetHieuLuc),
              })
            }
            className="w-full rounded-lg border border-white/15 bg-black/20 px-2 py-1 text-xs"
          />
        </dd>
        <dt className="text-white/40">Loại</dt>
        <dd className="m-0">{detailDoc.loai_van_ban || '—'}</dd>
        <dt className="text-white/40">Hiệu lực</dt>
        <dd className="m-0">
          <label className="inline-flex cursor-pointer items-center gap-2">
            <input
              type="checkbox"
              checked={editHetHieuLuc}
              onChange={(e) => {
                const expired = e.target.checked
                setEditHetHieuLuc(expired)
                if (!expired) {
                  setEditReplacementDocId('')
                  setEditReplacementUrl('')
                  setEditVanBanThayThe('')
                }
                scheduleCatalogPatch(detailDoc.id, {
                  trangThai: trangThaiFromExpired(expired),
                  soHieu: editSoHieu,
                  replacementDocId: expired ? editReplacementDocId || null : null,
                  replacementUrl: expired ? editReplacementUrl : '',
                  vanBanThayThe: expired ? editVanBanThayThe : '',
                })
              }}
              className="h-4 w-4"
            />
            <span>Hết hiệu lực</span>
          </label>
          {!editHetHieuLuc ? (
            <p className="m-0 mt-1 text-[11px] text-white/45">Mặc định coi văn bản còn hiệu lực.</p>
          ) : null}
        </dd>
        {editHetHieuLuc ? (
          <>
            <dt className="text-white/40">VB thay thế</dt>
            <dd className="m-0">
              <select
                value={editReplacementDocId}
                onChange={(e) => {
                  const id = e.target.value
                  setEditReplacementDocId(id)
                  const rep = docs.find((d) => d.id === id)
                  if (rep) {
                    setEditReplacementUrl(rep.storage_url || rep.drive_web_view_link || '')
                    if (rep.so_hieu) setEditVanBanThayThe(rep.so_hieu)
                  }
                  scheduleCatalogPatch(detailDoc.id, {
                    trangThai: trangThaiFromExpired(true),
                    soHieu: editSoHieu,
                    replacementDocId: id || null,
                    replacementUrl: rep?.storage_url || rep?.drive_web_view_link || editReplacementUrl,
                    vanBanThayThe: rep?.so_hieu || editVanBanThayThe,
                  })
                }}
                className="w-full rounded-lg border border-white/15 bg-black/20 px-2 py-1 text-xs"
              >
                <option value="">— Chọn văn bản trong hệ thống —</option>
                {docs
                  .filter((d) => d.id !== detailDoc.id)
                  .map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.display_name || d.file_name}
                      {d.so_hieu ? ` (${d.so_hieu})` : ''}
                    </option>
                  ))}
              </select>
              {editReplacementDocId ? (
                <div className="mt-1 flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      const rep = docs.find((d) => d.id === editReplacementDocId)
                      if (rep) openDocDetail(rep)
                    }}
                    className="text-[var(--hcc-gold-bright)] underline"
                  >
                    Xem trong quản trị
                  </button>
                  <Link
                    to={libraryDocHref(editReplacementDocId)}
                    className="text-[var(--hcc-gold-bright)] underline"
                  >
                    Mở trong thư viện
                  </Link>
                </div>
              ) : null}
            </dd>
            <dt className="text-white/40">Số hiệu VB thay thế</dt>
            <dd className="m-0">
              <input
                value={editVanBanThayThe}
                onChange={(e) => setEditVanBanThayThe(e.target.value)}
                onBlur={saveValidityFields}
                placeholder="VD: 01/2024/NĐ-CP"
                className="w-full rounded-lg border border-white/15 bg-black/20 px-2 py-1 text-xs"
              />
            </dd>
            <dt className="text-white/40">Link VB thay thế</dt>
            <dd className="m-0">
              <input
                value={editReplacementUrl}
                onChange={(e) => setEditReplacementUrl(e.target.value)}
                onBlur={saveValidityFields}
                placeholder="https://..."
                className="w-full rounded-lg border border-white/15 bg-black/20 px-2 py-1 text-xs"
              />
              {editReplacementUrl ? (
                <a
                  href={editReplacementUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="mt-1 inline-block text-[var(--hcc-gold-bright)] underline"
                >
                  Mở VB thay thế
                </a>
              ) : null}
            </dd>
          </>
        ) : null}
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
  )
}
