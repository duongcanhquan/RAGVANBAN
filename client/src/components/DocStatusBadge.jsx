import { isExpired, STATUS_BADGE_CLASS, TRANG_THAI_EXPIRED } from '../lib/docStatus'

export default function DocStatusBadge({ status, className = '' }) {
  if (!isExpired(status)) return null
  const cls = STATUS_BADGE_CLASS[TRANG_THAI_EXPIRED]
  return (
    <span
      className={`inline-flex shrink-0 items-center rounded-full px-2 py-0.5 text-[10px] font-medium leading-none ${cls} ${className}`}
      title={TRANG_THAI_EXPIRED}
    >
      {TRANG_THAI_EXPIRED}
    </span>
  )
}
