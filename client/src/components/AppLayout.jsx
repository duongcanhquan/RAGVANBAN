import { NavLink, Outlet } from 'react-router-dom'
import {
  FolderTree,
  LayoutDashboard,
  Lightbulb,
  MessageSquareText,
} from 'lucide-react'
import logo from '../assets/hcc-logo.jpg'

const NAV = [
  { to: '/', end: true, label: 'Hỏi đáp', short: 'Hỏi', Icon: MessageSquareText },
  { to: '/thu-vien', label: 'Thư viện', short: 'Cây', Icon: FolderTree },
  { to: '/tinh-huong', label: 'Tình huống', short: 'Mẫu', Icon: Lightbulb },
  { to: '/admin', label: 'Quản trị', short: 'Admin', Icon: LayoutDashboard, gold: true },
]

/**
 * Shell HCC — brand ghim giấy sát mép trái · nav căn mép cột bàn làm việc.
 */
export default function AppLayout() {
  return (
    <div className="app-canvas flex h-dvh max-h-dvh flex-col overflow-hidden text-[var(--color-foreground)]">
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:absolute focus:left-3 focus:top-3 focus:z-50 focus:rounded-xl focus:bg-white focus:px-3 focus:py-2 focus:shadow"
      >
        Bỏ qua đến nội dung
      </a>

      <header className="safe-top relative z-40 shrink-0 overflow-visible border-b border-[var(--hcc-line)]/80 bg-[var(--hcc-canvas)]/90 backdrop-blur-xl">
        <div
          className="pointer-events-none absolute inset-x-0 top-0 h-full opacity-[0.35]"
          aria-hidden="true"
          style={{
            backgroundImage:
              'radial-gradient(circle at 1px 1px, rgba(196,30,58,0.07) 1px, transparent 0)',
            backgroundSize: '14px 14px',
          }}
        />

        <div className="relative flex h-[var(--nav-h)] w-full items-center gap-3 pt-1.5 pl-[max(0.5rem,env(safe-area-inset-left))] pr-[max(0.75rem,env(safe-area-inset-right))] sm:gap-4">
          <div className="paper-pin brand-pin z-10 shrink-0">
            <span className="push-pin" aria-hidden="true" />
            <div className="flex items-center gap-2 sm:gap-2.5">
              <img
                src={logo}
                alt="Logo HCC — Hành chính công"
                width={40}
                height={40}
                className="h-8 w-8 shrink-0 rounded-full object-cover shadow-[0_0_0_2px_#fff,0_0_0_3px_var(--hcc-gold)] sm:h-9 sm:w-9"
                decoding="async"
              />
              <div className="min-w-0 pr-1">
                <p className="m-0 truncate text-[13px] font-semibold tracking-tight text-[var(--hcc-red)] sm:text-[15px]">
                  HCC Văn bản thông minh
                </p>
                <p className="m-0 truncate text-[10px] text-[var(--hcc-muted)] sm:text-[11px]">
                  Tra cứu · Tư vấn · Có căn cứ pháp lý
                </p>
              </div>
            </div>
          </div>

          <nav
            className="nav-pins ml-auto hidden min-w-0 items-end gap-1.5 overflow-x-auto lg:flex"
            aria-label="Điều hướng chính"
          >
            {NAV.map(({ to, end, label, Icon, gold }, i) => (
              <NavLink
                key={to}
                to={to}
                end={end}
                className={({ isActive }) =>
                  `paper-pin nav-pin group relative inline-flex cursor-pointer items-center gap-1.5 px-3 py-1.5 text-sm font-medium transition duration-200 ${
                    isActive
                      ? gold
                        ? 'nav-pin--gold'
                        : 'nav-pin--active'
                      : 'nav-pin--idle'
                  }`
                }
                style={{
                  ['--pin-tilt']: `${(i % 2 === 0 ? -1.2 : 1.1) + i * 0.15}deg`,
                }}
              >
                <span className="push-pin push-pin--sm" aria-hidden="true" />
                <Icon className="h-3.5 w-3.5 shrink-0 opacity-90" aria-hidden="true" />
                {label}
              </NavLink>
            ))}
          </nav>
        </div>
      </header>

      <div
        id="main-content"
        className="flex min-h-0 flex-1 flex-col overflow-y-auto"
        style={{ paddingBottom: 'var(--bottom-nav-h)' }}
      >
        <Outlet />
      </div>

      <nav
        className="safe-bottom fixed inset-x-0 bottom-0 z-40 border-t border-[var(--hcc-line)] bg-white/95 backdrop-blur-xl lg:hidden"
        aria-label="Tab điện thoại"
      >
        <div className="mx-auto grid max-w-lg grid-cols-4 px-1 pt-1">
          {NAV.map(({ to, end, short, Icon }) => (
            <NavLink
              key={to}
              to={to}
              end={end}
              className={({ isActive }) =>
                `bottom-tab flex cursor-pointer flex-col items-center justify-center gap-0.5 rounded-2xl py-1.5 text-[10px] font-medium transition ${
                  isActive ? 'text-[var(--hcc-red)]' : 'text-[var(--hcc-muted)]'
                }`
              }
            >
              {({ isActive }) => (
                <>
                  <span
                    className={`flex h-8 w-12 items-center justify-center rounded-2xl transition ${
                      isActive ? 'bg-[var(--hcc-red-soft)]' : ''
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
