/** Mặc định hệ thống coi văn bản còn hiệu lực; chỉ đánh dấu khi hết. */
export const TRANG_THAI_ACTIVE = 'Còn hiệu lực'
export const TRANG_THAI_EXPIRED = 'Hết hiệu lực'

export function isExpired(status) {
  return status === TRANG_THAI_EXPIRED
}

export function trangThaiFromExpired(expired) {
  return expired ? TRANG_THAI_EXPIRED : TRANG_THAI_ACTIVE
}

export function libraryDocHref(docId) {
  if (!docId) return null
  return `/thu-vien?doc=${encodeURIComponent(docId)}`
}

export const STATUS_BADGE_CLASS = {
  [TRANG_THAI_EXPIRED]: 'border border-rose-400/35 bg-rose-500/15 text-rose-100',
}
