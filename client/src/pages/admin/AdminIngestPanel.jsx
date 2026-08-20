import { Cloud, Globe, Plus, Sparkles, Type, UploadCloud } from 'lucide-react'
import { DigitizingWait } from '../../components/WaitMotion'
import { formatBytes } from '../../lib/uploadLimits'

export default function AdminIngestPanel(props) {
  const {
    isSuper, ingestTab, setIngestTab, categoryId, setCategoryId, categoryOptions, uploadR2Hint,
    httpUploadMaxBytes, dragOver, setDragOver, acceptFiles, files, setFiles, inputRef,
    pasteText, setPasteText, pasteTitle, setPasteTitle, driveLinks, setDriveLinks, driveHint, setDriveHint,
    webLinks, setWebLinks, docTitle, setDocTitle, docDescription, setDocDescription,
    uploading, progress, error, result, handleUpload, handlePasteText, handleDriveIngest, handleWebIngest,
  } = props
  return (
          <section className="glass-panel rounded-3xl p-4 sm:p-5">
            <h2 className="m-0 mb-1 text-base font-semibold text-white">Tải tài liệu</h2>
            <p className="m-0 mb-3 text-xs text-white/65">
              File trên {formatBytes(httpUploadMaxBytes)}: đưa Drive rồi dán link. File trùng nội dung
              không lưu thêm R2.
            </p>

            <div
              className="mb-3 grid grid-cols-2 gap-1 rounded-2xl border border-white/15 bg-white/5 p-0.5 sm:grid-cols-4"
              role="tablist"
              aria-label="Cách tải tài liệu"
            >
              {[
                { id: 'file', label: 'File', Icon: UploadCloud },
                { id: 'text', label: 'Text', Icon: Type },
                { id: 'drive', label: 'Google Drive', Icon: Cloud },
                { id: 'web', label: 'Link Website', Icon: Globe },
              ].map(({ id, label, Icon }) => (
                <button
                  key={id}
                  type="button"
                  role="tab"
                  id={`ingest-tab-${id}`}
                  aria-selected={ingestTab === id}
                  aria-controls={`ingest-panel-${id}`}
                  onClick={() => setIngestTab(id)}
                  className={`inline-flex min-h-11 w-full cursor-pointer items-center justify-center gap-1.5 rounded-xl px-2 text-xs font-semibold transition ${
                    ingestTab === id ? 'btn-gold' : 'text-white/70 hover:bg-white/10 hover:text-white'
                  }`}
                >
                  <Icon className="h-3.5 w-3.5" aria-hidden="true" />
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
                className="min-h-11 w-full rounded-xl border border-white/20 bg-white/10 px-3 py-2 text-base text-white outline-none focus:border-[var(--hcc-gold)] sm:text-sm"
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
              <div id="ingest-panel-file" role="tabpanel" aria-labelledby="ingest-tab-file">
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
              </div>
            )}

            {ingestTab === 'text' && (
              <div id="ingest-panel-text" role="tabpanel" aria-labelledby="ingest-tab-text">
              <textarea
                rows={5}
                value={pasteText}
                onChange={(e) => setPasteText(e.target.value)}
                placeholder="Dán nội dung văn bản…"
                className="mb-3 w-full resize-y rounded-xl border border-white/15 bg-white/5 px-3 py-2 text-sm text-white outline-none placeholder:text-white/40"
              />
              </div>
            )}

            {ingestTab === 'drive' && (
              <div id="ingest-panel-drive" role="tabpanel" aria-labelledby="ingest-tab-drive">
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
                    Dán link file hoặc thư mục Google Drive (đã bật «ai có link»). Có thể thêm nhiều
                    link rồi số hóa một lúc — file gốc giữ trên Drive.
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
                    Thêm link Drive
                  </button>
                </div>
              </div>
              </div>
            )}

            {ingestTab === 'web' && (
              <div id="ingest-panel-web" role="tabpanel" aria-labelledby="ingest-tab-web">
              <div className="mb-3 space-y-2">
                <p className="m-0 text-sm text-white/65">
                  Dán link HTTPS trang uy tín (.gov.vn, thuvienphapluat.vn…). Server tự tải HTML, trích
                  chữ, rồi số hóa vector giống File/Drive (OpenAI embed → Pinecone). Không cần API bên thứ
                  ba. Có thể thêm nhiều trang.
                </p>
                <div className="space-y-2">
                  {webLinks.map((link, i) => (
                    <div key={i} className="flex gap-2">
                      <input
                        value={link}
                        onChange={(e) =>
                          setWebLinks((prev) => prev.map((x, idx) => (idx === i ? e.target.value : x)))
                        }
                        placeholder="https://thuvienphapluat.vn/… hoặc trang hướng dẫn nhà trường"
                        className="min-w-0 flex-1 rounded-2xl border border-white/15 bg-white/5 px-4 py-2.5 text-sm text-white outline-none placeholder:text-white/40"
                      />
                      {webLinks.length > 1 ? (
                        <button
                          type="button"
                          onClick={() => setWebLinks((prev) => prev.filter((_, idx) => idx !== i))}
                          className="shrink-0 rounded-xl bg-white/10 px-3 text-xs text-white/70"
                        >
                          Bỏ
                        </button>
                      ) : null}
                    </div>
                  ))}
                  <button
                    type="button"
                    onClick={() => setWebLinks((prev) => [...prev, ''])}
                    className="inline-flex min-h-9 items-center gap-1 rounded-full bg-white/10 px-3 py-1.5 text-xs text-white/80"
                  >
                    <Plus className="h-3.5 w-3.5" />
                    Thêm link website
                  </button>
                </div>
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
                  <Sparkles className={`h-4 w-4 ${uploading ? 'wait-spark' : ''}`} />
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

            {ingestTab === 'drive' && (
              <button
                type="button"
                disabled={!driveLinks.some((s) => s.trim()) || uploading}
                onClick={handleDriveIngest}
                className="btn-gold inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-xl px-4 py-2 text-sm font-semibold disabled:opacity-40"
              >
                <Cloud className="h-4 w-4" />
                {uploading ? 'Đang lấy & số hóa…' : 'Số hóa từ Google Drive'}
              </button>
            )}

            {ingestTab === 'web' && (
              <button
                type="button"
                disabled={!webLinks.some((s) => s.trim()) || uploading}
                onClick={handleWebIngest}
                className="btn-gold inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-xl px-4 py-2 text-sm font-semibold disabled:opacity-40"
              >
                <Globe className="h-4 w-4" />
                {uploading ? 'Đang tải & số hóa…' : 'Số hóa từ website'}
              </button>
            )}

            {uploading && (
              <DigitizingWait
                percent={progress.percent}
                message={progress.message}
                active={uploading}
              />
            )}

            {error ? (
              <p role="alert" className="mb-0 mt-3 text-sm text-rose-300">
                {error}
              </p>
            ) : null}

            {result ? (
              <div
                className={`mt-3 rounded-2xl border p-4 text-sm ${
                  result.duplicate || result.failed || (Number(result.skipped) > 0 && !result.processed)
                    ? 'border-amber-400/30 bg-amber-400/10 text-amber-50'
                    : 'border-emerald-400/30 bg-emerald-400/10 text-emerald-100'
                }`}
              >
                <p className="m-0 font-medium">
                  {result.duplicate || (Number(result.skipped) > 0 && !result.processed)
                    ? result.message ||
                      (result.skipped
                        ? `Không có file mới — ${result.skipped} file đã có trong kho`
                        : result.message || 'File trùng — không lưu thêm vector')
                    : result.failed && !result.processed
                      ? `Không ghi được danh mục: ${result.displayName || result.fileName || 'Google Drive'}`
                      : `Số hóa thành công: ${result.displayName || result.fileName || 'Google Drive'}`}
                  {result.count > 1 ? ` · ${result.count} link` : ''}
                </p>
                {result.duplicate || (Number(result.skipped) > 0 && !result.processed) ? (
                  <p className="m-0 mt-1 text-xs text-amber-50/80">
                    Hệ thống chỉ số hóa file Drive chưa có trong kho. Dùng «Số hóa lại» nếu cần OCR/vector lại file cũ.
                  </p>
                ) : result.skipped || result.processed ? (
                  <p className="m-0 mt-1 text-xs text-emerald-100/75">
                    File mới xử lý {result.processed || 0}
                    {result.skipped ? ` · đã có trong kho ${result.skipped}` : ''}
                    {result.pending > result.processed
                      ? ` · còn ${result.pending - (result.processed || 0)} file mới (lần sau dán lại link)`
                      : ''}
                    {result.failed ? ` · lỗi ${result.failed}` : ''}
                  </p>
                ) : null}
                {result.moTa ? (
                  <p className="m-0 mt-1 text-emerald-100/80">{result.moTa}</p>
                ) : null}
                <p className="m-0 mt-1 text-emerald-100/80">
                  {[result.metadata?.loai_van_ban, result.metadata?.so_hieu]
                    .filter(Boolean)
                    .join(' ')}
                  {result.chunks != null && result.chunks !== '' ? ` · ${result.chunks} chunks` : ''}
                </p>
                {result.ingested !== false &&
                result.chunks != null &&
                Number(result.chunks) === 0 &&
                !result.duplicate &&
                !result.skipped ? (
                  <p className="m-0 mt-1 text-xs text-amber-100/90">
                    File vào danh mục nhưng 0 chunks — mở danh mục → «Số hóa lại», hoặc kiểm tra OCR/định dạng.
                  </p>
                ) : null}
                {Array.isArray(result.files) && result.files.length > 0 ? (
                  <ul className="m-0 mt-2 list-none space-y-1 p-0 text-xs">
                    {result.files.map((f) => (
                      <li key={f.id || f.fileName} className="text-emerald-50/90">
                        {f.driveWebViewLink || f.storageUrl ? (
                          <a
                            href={f.driveWebViewLink || f.storageUrl}
                            target="_blank"
                            rel="noreferrer"
                            className="text-[var(--hcc-gold-bright)] underline"
                          >
                            {f.displayName || f.fileName || 'Mở file Drive'}
                          </a>
                        ) : (
                          <span>{f.displayName || f.fileName}</span>
                        )}
                        {f.chunks ? ` · ${f.chunks} chunks` : ''}
                        {f.error ? ` · ${f.error}` : ''}
                      </li>
                    ))}
                  </ul>
                ) : null}
                {result.storageUrl || result.publicUrl || result.driveWebViewLink || result.downloadUrl ? (
                  <a
                    href={
                      result.storageUrl ||
                      result.publicUrl ||
                      result.driveWebViewLink ||
                      result.downloadUrl
                    }
                    target="_blank"
                    rel="noreferrer"
                    className="mt-1 inline-block text-[var(--hcc-gold-bright)] underline"
                  >
                    {result.source === 'google_drive' ? 'Mở bản gốc trên Drive' : 'Mở bản gốc'}
                  </a>
                ) : (
                  <p className="m-0 mt-1 text-[11px] text-amber-100/80">
                    {result.source === 'google_drive'
                      ? 'Chưa có link tải về — Share file/thư mục Viewer cho service account, hoặc bật “Anyone with the link”.'
                      : 'Chưa có link tải về — cấu hình R2 hoặc dùng Google Drive để có bản gốc.'}
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
  )
}
