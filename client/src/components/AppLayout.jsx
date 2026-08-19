import { Link, NavLink, Outlet } from 'react-router-dom'
import {
  FolderTree,
  Lightbulb,
  MessageSquareText,
} from 'lucide-react'
import logoVietmy from '../assets/logo-vietmy.png'
import logoEquest from '../assets/logo-equest.png'

const NAV = [
  { to: '/', end: true, label: 'Hỏi đáp', short: 'Hỏi', Icon: MessageSquareText },
  { to: '/thu-vien', label: 'Thư viện', short: 'Cây', Icon: FolderTree },
  { to: '/tinh-huong', label: 'Tình huống', short: 'Mẫu', Icon: Lightbulb },
]

/**
 * Header: Việt Mỹ trái · menu giữa · EQuest phải.
 */
export default function AppLayout() {
  return (
    <div className="app-canvas relative flex h-dvh max-h-dvh flex-col overflow-hidden text-slate-100">
      <div className="pointer-events-none absolute inset-0 admin-aurora" aria-hidden="true" />
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:absolute focus:left-3 focus:top-3 focus:z-50 focus:rounded-xl focus:bg-white focus:px-3 focus:py-2 focus:text-[#1a1214] focus:shadow"
      >
        Bỏ qua đến nội dung
      </a>

      <header className="site-header safe-top relative z-40 shrink-0 border-b border-white/10 bg-black/25 backdrop-blur-xl">
        <div className="relative flex h-[var(--nav-h)] items-center justify-between gap-2 pl-[max(0.5rem,env(safe-area-inset-left))] pr-[max(0.5rem,env(safe-area-inset-right))] sm:gap-4 sm:px-4">
          <Link
            to="/"
            className="relative z-10 flex h-full max-w-[42%] shrink-0 items-center sm:max-w-[30%]"
          >
            <img
              src={logoVietmy}
              alt="Cao đẳng Việt Mỹ Hà Nội"
              className="h-10 w-auto max-w-full object-contain object-left sm:h-12"
              width={180}
              height={48}
              decoding="async"
            />
          </Link>

          <p className="relative z-10 m-0 min-w-0 flex-1 truncate px-1 text-center text-[11px] font-medium leading-tight text-white/90 lg:hidden">
            Hệ thống tra cứu văn bản thông minh
          </p>

          <div className="pointer-events-none absolute inset-0 hidden flex-col items-center justify-center gap-0.5 lg:flex">
            <p className="m-0 text-[12px] font-semibold tracking-wide text-white">
              Hệ thống tra cứu văn bản thông minh
            </p>
            <nav
              className="pointer-events-auto flex items-center gap-0.5 rounded-full bg-white/10 p-0.5"
              aria-label="Điều hướng chính"
            >
              {NAV.map(({ to, end, label, Icon }) => (
                <NavLink
                  key={to}
                  to={to}
                  end={end}
                  className={({ isActive }) =>
                    `inline-flex min-h-8 cursor-pointer items-center gap-1.5 rounded-full px-3 py-1 text-[13px] font-medium transition duration-200 ${
                      isActive
                        ? 'bg-[var(--hcc-gold)] text-[#0a1628] shadow-sm'
                        : 'text-white/85 hover:bg-white/10 hover:text-white'
                    }`
                  }
                >
                  <Icon className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                  {label}
                </NavLink>
              ))}
            </nav>
          </div>

          <div className="relative z-10 flex h-full max-w-[42%] shrink-0 items-center justify-end sm:max-w-[30%]">
            <img
              src={logoEquest}
              alt="EQuest — The Quest for Excellence"
              className="h-10 w-auto max-w-full object-contain object-right sm:h-12"
              width={160}
              height={48}
              decoding="async"
            />
          </div>
        </div>
      </header>

      <div
        id="main-content"
        className="relative z-10 flex min-h-0 flex-1 flex-col overflow-hidden"
        style={{ paddingBottom: 'var(--bottom-nav-h)' }}
      >
        <Outlet />
      </div>

      <nav
        className="safe-bottom fixed inset-x-0 bottom-0 z-40 border-t border-white/10 bg-[#1a080c]/95 backdrop-blur-xl lg:hidden"
        aria-label="Tab điện thoại"
      >
        <div className="mx-auto grid max-w-lg grid-cols-3 px-1 pt-1">
          {NAV.map(({ to, end, short, Icon }) => (
            <NavLink
              key={to}
              to={to}
              end={end}
              className={({ isActive }) =>
                `bottom-tab flex cursor-pointer flex-col items-center justify-center gap-0.5 rounded-2xl py-1.5 text-[10px] font-medium transition ${
                  isActive ? 'text-[var(--hcc-gold-bright)]' : 'text-white/55'
                }`
              }
            >
              {({ isActive }) => (
                <>
                  <span
                    className={`flex h-8 w-12 items-center justify-center rounded-2xl transition ${
                      isActive ? 'bg-white/10' : ''
                    }`}
                  >
                    <Icon className="h-5 w-5" aria-hidden="true" />
                  </span>
                  {short}
                </>
              )}
            </NavLink>
          ))}
        </div>
      </nav>
    </div>
  )
}
