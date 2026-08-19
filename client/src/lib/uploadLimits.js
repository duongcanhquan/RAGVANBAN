/**
 * Phân loại file trước khi upload — khớp server/src/services/ragConfig.js
 */
export const DIRECT_UPLOAD_MAX_BYTES = 4_500_000

export function splitUploadFiles(files, limits = {}) {
  const list = [...(files || [])]
  const cap = Number(limits.uploadMaxBytes) || 40 * 1024 * 1024
  const httpMax = Number(limits.httpUploadMaxBytes) || Math.min(cap, DIRECT_UPLOAD_MAX_BYTES)
  const direct = []
  const useDrive = []
  const tooLarge = []
  for (const f of list) {
    const size = Number(f?.size) || 0
    if (size > cap) tooLarge.push(f)
    else if (size > httpMax) useDrive.push(f)
    else direct.push(f)
  }
  return { direct, useDrive, tooLarge }
}

export function formatBytes(n) {
  const x = Number(n) || 0
  if (x < 1024) return `${Math.round(x)} byte`
  if (x < 1_000_000) return `${Math.max(1, Math.round(x / 1024))} KB`
  const si = x / 1_000_000
  if (si < 10) {
    const t = Math.round(si * 10) / 10
    return `${Number.isInteger(t) ? String(t) : t.toFixed(1)} MB`
  }
  return `${Math.round(x / (1024 * 1024))} MB`
}
