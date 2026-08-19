import { useCallback, useEffect, useState } from 'react'
import { NavLink, Navigate, Outlet, useLocation, useNavigate } from 'react-router-dom'
import { FileUp, KeyRound, LogOut, Users } from 'lucide-react'
import { supabase, supabaseConfigured } from '../../lib/supabase'
import { adminFetch } from '../../lib/adminApi'
import logo from '../../assets/hcc-logo.jpg'

export default function QuantriShell() {
  const [session, setSession] = useState(null)
  const [me, setMe] = useState(null)
  const [loading, setLoading] = useState(true)
  const [email, setEmail] = useState('quan.duong@caodangvietmy.edu.vn')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const location = useLocation()
  const navigate = useNavigate()

  const refreshMe = useCallback(async () => {
    const res = await adminFetch('/api/quantri/me')
    const data = await res.json().catch(() => ({}))
    if (!res.ok) throw new Error(data.error || 'Không tải được hồ sơ')
    setMe(data.me)
    return data.me
  }, [])

  useEffect(() => {
    if (!supabase) {
      setLoading(false)
      return
    }
    let unsub = () => {}
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session || null)
    })
    const { data } = supabase.auth.onAuthStateChange((_event, next) => {
      setSession(next)
    })
    unsub = () => data.subscription.unsubscribe()
    return () => unsub()
  }, [])

  useEffect(() => {
    let cancelled = false
    async function load() {
      if (!session) {
        setMe(null)
        setLoading(false)
        return
      }
      setLoading(true)
      try {
        const profile = await refreshMe()
        if (!cancelled && profile?.must_change_password && location.pathname !== '/quantri/tai-khoan') {
          navigate('/quantri/tai-khoan', { replace: true })
        }
      } catch (e) {
        if (!cancelled) {
          setError(e.message)
          setMe(null)
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    load()
    return () => {
      cancelled = true
    }
  }, [session, refreshMe, location.pathname, navigate])

  async function onLogin(e) {
    e.preventDefault()
    setError('')
    setBusy(true)
    try {
      if (!supabaseConfigured || !supabase) {
        throw new Error('Thiếu VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY trên bản build Vercel')
      }
      const statusRes = await fetch('/api/quantri/status')
      const status = await statusRes.json()
      if (status.needsBootstrap) {
        const boot = await fetch('/api/quantri/bootstrap', { method: 'POST' })
        const bootData = await boot.json().catch(() => ({}))
        if (!boot.ok) throw new Error(bootData.error || 'Không tạo được tài khoản super-admin')
      }
      const { error: signErr } = await supabase.auth.signInWithPassword({
        email: email.trim(),
        password,
      })
      if (signErr) throw signErr
    } catch (err) {
      setError(err.message || 'Đăng nhập thất bại')
    } finally {
      setBusy(false)
    }
  }

  async function onLogout() {
    await supabase?.auth.signOut()
    setMe(null)
    setSession(null)
    navigate('/quantri', { replace: true })
  }

  if (!supabaseConfigured) {
    return (
      <Gate>
        <p className="m-0 text-sm text-white/80">
          Client chưa có <code className="text-[var(--hcc-gold-bright)]">VITE_SUPABASE_*</code>. Thêm trên
          Vercel rồi Redeploy.
        </p>
      </Gate>
    )
  }

  if (loading) {
    return (
      <Gate>
        <p className="m-0 text-sm text-white/70">Đang kiểm tra phiên…</p>
      </Gate>
    )
  }

  if (!session || !me) {
    return (
      <Gate>
        <form onSubmit={onLogin} className="flex w-full max-w-sm flex-col gap-3">
          <label className="text-xs font-medium text-white/70">
            Email
            <input
              className="mt-1 w-full rounded-xl border border-white/15 bg-white/10 px-3 py-2 text-sm text-white outline-none"
              type="email"
              autoComplete="username"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
          </label>
          <label className="text-xs font-medium text-white/70">
            Mật khẩu
            <input
              className="mt-1 w-full rounded-xl border border-white/15 bg-white/10 px-3 py-2 text-sm text-white outline-none"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
          </label>
          {error ? <p className="m-0 text-sm text-red-200">{error}</p> : null}
          <button
            type="submit"
            disabled={busy}
            className="rounded-xl bg-[var(--hcc-red)] px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-60"
          >
            {busy ? 'Đang vào…' : 'Đăng nhập'}
          </button>
        </form>
      </Gate>
    )
  }

  const links = [
    { to: '/quantri', end: true, label: 'Nạp tài liệu', Icon: FileUp },
    ...(me.role === 'super_admin'
      ? [{ to: '/quantri/nhan-su', end: false, label: 'Người quản trị', Icon: Users }]
      : []),
    { to: '/quantri/tai-khoan', end: false, label: 'Đổi mật khẩu', Icon: KeyRound },
  ]

  return (
    <div className="admin-shell flex min-h-dvh flex-col bg-[#1a1214] text-slate-100">
      <header className="flex flex-wrap items-center gap-3 border-b border-white/10 px-4 py-3">
        <img src={logo} alt="" className="h-9 w-9 rounded-full object-cover" width={36} height={36} />
        <div className="min-w-0 flex-1">
          <p className="m-0 text-sm font-semibold">Quản trị HCC</p>
          <p className="m-0 truncate text-[11px] text-white/55">
            {me.display_name || me.email} · {me.role === 'super_admin' ? 'Toàn quyền' : 'Theo chuyên mục'}
          </p>
        </div>
        <nav className="flex flex-wrap gap-1">
          {links.map(({ to, end, label, Icon }) => (
            <NavLink
              key={to}
              to={to}
              end={end}
              className={({ isActive }) =>
                `inline-flex items-center gap-1 rounded-full px-3 py-1.5 text-xs font-medium ${
                  isActive ? 'bg-white text-[var(--hcc-red)]' : 'bg-white/10 text-white/80'
                }`
              }
            >
              <Icon className="h-3.5 w-3.5" />
              {label}
            </NavLink>
          ))}
        </nav>
        <button
          type="button"
          onClick={onLogout}
          className="inline-flex items-center gap-1 rounded-full bg-white/10 px-3 py-1.5 text-xs text-white/80"
        >
          <LogOut className="h-3.5 w-3.5" />
          Thoát
        </button>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto">
        <Outlet context={{ me, session, refreshMe }} />
      </div>
    </div>
  )
}

function Gate({ children }) {
  return (
    <div className="admin-shell relative flex min-h-dvh items-center justify-center px-4 text-slate-100">
      <div className="pointer-events-none absolute inset-0 admin-aurora" aria-hidden="true" />
      <div className="relative z-10 w-full max-w-md rounded-3xl border border-white/10 bg-black/30 p-6 backdrop-blur-xl">
        <div className="mb-5 flex items-center gap-3">
          <img src={logo} alt="HCC" className="h-11 w-11 rounded-full object-cover" width={44} height={44} />
          <div>
            <p className="m-0 text-xs font-semibold uppercase tracking-[0.16em] text-[var(--hcc-gold-bright)]">
              /quantri
            </p>
            <h1 className="m-0 text-xl font-semibold">Đăng nhập quản trị</h1>
          </div>
        </div>
        {children}
      </div>
    </div>
  )
}
