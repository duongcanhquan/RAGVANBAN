import { NavLink } from 'react-router-dom'
import { MAIN_SECTION_NAV } from '../lib/mainNav'

/**
 * Hỏi đáp · Thư viện · Tình huống — dùng trên thanh công cụ trang (desktop).
 */
export default function MainSectionNav({ className = '' }) {
  return (
    <nav
      className={`inline-flex items-center gap-0.5 rounded-2xl border border-white/15 bg-white/10 p-1 sm:rounded-full ${className}`}
      aria-label="Điều hướng chính"
    >
      {MAIN_SECTION_NAV.map(({ to, end, label, Icon }) => (
        <NavLink
          key={to}
          to={to}
          end={end}
          className={({ isActive }) =>
            `inline-flex min-h-9 cursor-pointer items-center gap-1.5 rounded-xl px-2.5 py-1 text-xs font-semibold transition active:scale-95 active:brightness-90 sm:min-h-9 sm:rounded-full sm:px-3 sm:text-sm ${
              isActive
                ? 'bg-[var(--hcc-gold)] text-[#0a1628] shadow-sm'
                : 'text-white/70 hover:bg-white/10 hover:text-white'
            }`
          }
        >
          <Icon className="h-4 w-4 shrink-0 sm:h-3.5 sm:w-3.5" aria-hidden="true" />
          <span className="hidden sm:inline">{label}</span>
        </NavLink>
      ))}
    </nav>
  )
}
