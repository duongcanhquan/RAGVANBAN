import { useCallback, useEffect, useRef, useState } from 'react'
import { NavLink, useNavigate } from 'react-router-dom'
import { Brain, FileText, GraduationCap, KeyRound, LogOut, Settings, Users, PenLine, Search } from 'lucide-react'
import { supabase, supabaseConfigured } from '../../lib/supabase'
import { adminFetch, clearAuthTokenCache } from '../../lib/adminApi'
import { explainLoginError } from '../../lib/authErrors'
import { apiUrl } from '../../lib/apiBase'
import logoVietmy from '../../assets/logo-vietmy.png'
import KeepAliveOutlet from '../../components/KeepAliveOutlet'

export default function QuantriShell() {
  const [session, setSession] = useState(null)
  const [me, setMe] = useState(null)
  const [loading, setLoading] = useState(true)
  const [email, setEmail] = useState('quan.duong@caodangvietmy.edu.vn')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const navigate = useNavigate()
  const loadedUserId = useRef(null)

  const [gateStatus, setGateStatus] = useState(null)

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
    const { data } = supabase.auth.onAuthStateChange((event, next) => {
      if (event === 'TOKEN_REFRESHED') return
      clearAuthTokenCache()
      setSession(next)
    })
    unsub = () => data.subscription.unsubscribe()
    return () => unsub()
  }, [])

  useEffect(() => {
    fetch(apiUrl('/api/quantri/status'))
      .then(async (res) => {
        const data = await res.json().catch(() => ({}))
        setGateStatus(data)
      })
      .catch(() => {
        setGateStatus({ fetchError: true })
      })
  }, [])

  useEffect(() => {
    let cancelled = false
    async function load() {
      const userId = session?.user?.id || null
      if (!userId) {
        loadedUserId.current = null
        setMe(null)
        setLoading(false)
        return
      }
      if (loadedUserId.current === userId) {
        setLoading(false)
        return
      }
      setLoading(true)
      try {
        await refreshMe()
        if (!cancelled) loadedUserId.current = userId
      } catch (e) {
        if (!cancelled) {
          loadedUserId.current = null
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
  }, [session?.user?.id, refreshMe])

  async function onLogin(e) {
    e.preventDefault()
    setError('')
    setBusy(true)
    try {
      if (!supabaseConfigured || !supabase) {
        throw new Error('Thiếu VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY trên bản build Vercel')
      }
      const statusRes = await fetch(apiUrl('/api/quantri/status'))
      const status = await statusRes.json().catch(() => ({}))
      setGateStatus(status)
      if (status.profileError) {
        throw new Error(status.profileError.includes('admin_profiles')
          ? status.profileError
          : `Không đọc được admin_profiles: ${status.profileError}`)
      }
      if (status.needsBootstrap) {
        if (!status.hasPasswordEnv) {
          throw new Error('Thiếu SUPER_ADMIN_PASSWORD trên Vercel. Thêm biến (≥ 8 ký tự, không dùng 123456), Redeploy, rồi đăng nhập.')
        }
        const boot = await fetch(apiUrl('/api/quantri/bootstrap'), { method: 'POST' })
        const bootData = await boot.json().catch(() => ({}))
        if (!boot.ok) throw new Error(bootData.error || 'Không tạo được tài khoản super-admin')
      }
      clearAuthTokenCache()
      const { error: signErr } = await supabase.auth.signInWithPassword({
        email: email.trim(),
        password,
      })
      if (signErr) throw signErr
    } catch (err) {
      setError(explainLoginError(err.message || err.error_description || 'Đăng nhập thất bại'))
    } finally {
      setBusy(false)
    }
  }

  async function onLogout() {
    loadedUserId.current = null
    clearAuthTokenCache()
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

  if (loading && !me) {
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
          {gateStatus?.fetchError ? (
            <p className="m-0 rounded-xl bg-amber-500/20 px-3 py-2 text-xs text-amber-100">
              Không gọi được /api/quantri/status — API chưa lên hoặc đang deploy.
            </p>
          ) : null}
          {gateStatus && gateStatus.supabase === false ? (
            <p className="m-0 rounded-xl bg-amber-500/20 px-3 py-2 text-xs text-amber-100">
              Server thiếu SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY trên Vercel.
            </p>
          ) : null}
          {gateStatus?.needsBootstrap && !gateStatus.hasPasswordEnv ? (
            <p className="m-0 rounded-xl bg-amber-500/20 px-3 py-2 text-xs text-amber-100">
              Chưa có SUPER_ADMIN_PASSWORD trên Vercel — thêm rồi Redeploy.
            </p>
          ) : null}
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
          {error ? (
            <p className="m-0 rounded-xl bg-red-500/25 px-3 py-2 text-sm font-medium text-red-50">
              {error}
            </p>
          ) : null}
          <button
            type="submit"
            disabled={busy}
            className="relative z-20 cursor-pointer rounded-xl bg-[var(--hcc-red)] px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-60"
          >
            {busy ? 'Đang vào…' : 'Đăng nhập'}
          </button>
          {session && !me ? (
            <button
              type="button"
              onClick={onLogout}
              className="cursor-pointer text-xs text-white/60 underline"
            >
              Xóa phiên cũ và thử lại
            </button>
          ) : null}
        </form>
      </Gate>
    )
  }

  const links = [
    { to: '/quantri', end: true, label: 'Tài liệu', Icon: FileText },
    { to: '/quantri/day-ai', end: false, label: 'Dạy AI', Icon: GraduationCap },
    ...(me.role === 'super_admin'
      ? [
          { to: '/quantri/bo-nao', end: false, label: 'Bộ não', Icon: Brain },
          { to: '/quantri/rag', end: false, label: 'RAG', Icon: Search },
          { to: '/quantri/giong-ai', end: false, label: 'Giọng AI', Icon: PenLine },
        ]
      : []),
    { to: '/quantri/cai-dat', end: false, label: 'Cài đặt', Icon: Settings },
    ...(me.role === 'super_admin'
      ? [{ to: '/quantri/nhan-su', end: false, label: 'Nhân sự', Icon: Users }]
      : []),
    { to: '/quantri/tai-khoan', end: false, label: 'Đổi mật khẩu', Icon: KeyRound },
  ]

  return (
    <div className="admin-shell flex min-h-dvh flex-col bg-[#1a1214] text-slate-100">
      <header className="flex flex-wrap items-center gap-3 border-b border-white/10 px-4 py-3">
        <img src={logoVietmy} alt="" className="h-9 w-auto max-h-9 object-contain" width={120} height={36} />
        <div className="min-w-0 flex-1">
          <p className="m-0 text-sm font-semibold">Quản trị</p>
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
      {me.must_change_password ? (
        <p className="m-0 border-b border-amber-400/30 bg-amber-500/15 px-4 py-2 text-xs text-amber-100">
          Nên đổi mật khẩu tạm.{' '}
          <NavLink to="/quantri/tai-khoan" className="underline">
            Đổi ngay
          </NavLink>
        </p>
      ) : null}
      <div className="min-h-0 flex-1 overflow-y-auto">
        <KeepAliveOutlet context={{ me, session, refreshMe }} />
      </div>
    </div>
  )
}

function Gate({ children }) {
  return (
    <div className="admin-shell relative flex min-h-dvh items-center justify-center px-4 text-slate-100">
      <div className="pointer-events-none absolute inset-0 z-0 admin-aurora" aria-hidden="true" />
      <div className="relative z-10 w-full max-w-md rounded-3xl border border-white/10 bg-black/30 p-6 backdrop-blur-xl">
        <div className="mb-5 flex items-center gap-3">
          <img src={logoVietmy} alt="Cao đẳng Việt Mỹ" className="h-11 w-auto max-h-11 object-contain" width={140} height={44} />
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
