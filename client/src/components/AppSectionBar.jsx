import { Link } from 'react-router-dom'
import logoVietmy from '../assets/logo-vietmy.png'
import logoEquest from '../assets/logo-equest.png'
import MainSectionNav from './MainSectionNav'

/**
 * Desktop: logo trái · Hỏi đáp/Thư viện/Tình huống · (tuỳ chọn) nút phải.
 */
export default function AppSectionBar({ trailing = null, className = '' }) {
  return (
    <div
      className={`toolbar-blur safe-top hidden shrink-0 border-b border-white/10 bg-black/20 backdrop-blur-md lg:block ${className}`}
    >
      <div className="flex min-h-[var(--nav-h)] items-center gap-2 px-3 py-1.5 sm:gap-3 sm:px-4 xl:gap-4 xl:px-6">
        <Link
          to="/"
          className="flex shrink-0 items-center gap-2 sm:gap-2.5"
          aria-label="Trang chủ — Hỏi đáp"
        >
          <img
            src={logoVietmy}
            alt="Cao đẳng Việt Mỹ Hà Nội"
            className="h-8 w-auto max-h-9 object-contain xl:h-9"
            width={140}
            height={36}
            decoding="async"
          />
          <span className="h-6 w-px shrink-0 bg-white/15 xl:h-7" aria-hidden="true" />
          <img
            src={logoEquest}
            alt="EQuest"
            className="h-7 w-auto max-h-8 object-contain xl:h-8"
            width={120}
            height={32}
            decoding="async"
          />
        </Link>

        <span className="hidden h-7 w-px shrink-0 bg-white/12 sm:block" aria-hidden="true" />

        <MainSectionNav className="min-w-0" />

        {trailing ? (
          <div className="ml-auto flex shrink-0 items-center justify-end gap-0.5">{trailing}</div>
        ) : null}
      </div>
    </div>
  )
}
