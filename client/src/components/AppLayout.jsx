import { Link, NavLink, Outlet } from 'react-router-dom'
import logoVietmy from '../assets/logo-vietmy.png'
import logoEquest from '../assets/logo-equest.png'
import { MAIN_SECTION_NAV } from '../lib/mainNav'

/**
 * Header: logo Việt Mỹ · EQuest ở giữa.
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
        <div className="relative flex h-[var(--nav-h)] items-center justify-center px-[max(0.75rem,env(safe-area-inset-left))] sm:px-4">
          <Link
            to="/"
            className="relative z-10 flex max-w-[min(100%,28rem)] items-center justify-center gap-3 sm:gap-5"
          >
            <img
              src={logoVietmy}
              alt="Cao đẳng Việt Mỹ Hà Nội"
              className="h-8 w-auto max-w-[46%] object-contain sm:h-10 lg:h-11"
              width={180}
              height={48}
              decoding="async"
            />
            <span className="h-7 w-px shrink-0 bg-white/15 sm:h-9" aria-hidden="true" />
            <img
              src={logoEquest}
              alt="EQuest — The Quest for Excellence"
              className="h-8 w-auto max-w-[46%] object-contain sm:h-10 lg:h-11"
              width={160}
              height={48}
              decoding="async"
            />
          </Link>
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
        <div className="mx-auto grid max-w-lg grid-cols-3 px-1 pt-0.5">
          {MAIN_SECTION_NAV.map(({ to, end, short, Icon }) => (
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
