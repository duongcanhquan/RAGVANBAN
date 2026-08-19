import { useState } from 'react'
import { useOutletContext } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { adminFetch } from '../../lib/adminApi'

export default function QuantriAccount() {
  const { me, refreshMe } = useOutletContext()
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  async function onSubmit(e) {
    e.preventDefault()
    setError('')
    setMessage('')
    if (password.length < 8) {
      setError('Mật khẩu mới tối thiểu 8 ký tự (tránh mật khẩu dễ đoán như 123456).')
      return
    }
    if (password !== confirm) {
      setError('Hai mật khẩu không khớp')
      return
    }
    setBusy(true)
    try {
      const { error: updErr } = await supabase.auth.updateUser({ password })
      if (updErr) throw updErr
      const res = await adminFetch('/api/quantri/me/password-changed', { method: 'POST' })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || 'Không cập nhật hồ sơ')
      await refreshMe()
      setPassword('')
      setConfirm('')
      setMessage('Đã đổi mật khẩu.')
    } catch (err) {
      setError(err.message || 'Không đổi được mật khẩu')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="mx-auto max-w-md px-4 py-10 text-slate-100">
      <h1 className="m-0 text-2xl font-semibold">Đổi mật khẩu</h1>
      {me?.must_change_password ? (
        <p className="mt-2 text-sm text-[var(--hcc-gold-bright)]">
          Tài khoản mới — hãy đổi mật khẩu trước khi nạp tài liệu.
        </p>
      ) : (
        <p className="mt-2 text-sm text-white/65">{me?.email}</p>
      )}
      <form onSubmit={onSubmit} className="mt-6 flex flex-col gap-3">
        <input
          type="password"
          autoComplete="new-password"
          placeholder="Mật khẩu mới"
          className="rounded-xl border border-white/15 bg-white/10 px-3 py-2 text-sm"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
        <input
          type="password"
          autoComplete="new-password"
          placeholder="Nhập lại mật khẩu mới"
          className="rounded-xl border border-white/15 bg-white/10 px-3 py-2 text-sm"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
        />
        {error ? <p className="m-0 text-sm text-red-200">{error}</p> : null}
        {message ? <p className="m-0 text-sm text-emerald-200">{message}</p> : null}
        <button
          type="submit"
          disabled={busy}
          className="rounded-xl bg-[var(--hcc-red)] px-4 py-2.5 text-sm font-semibold disabled:opacity-60"
        >
          {busy ? 'Đang lưu…' : 'Cập nhật mật khẩu'}
        </button>
      </form>
    </div>
  )
}
