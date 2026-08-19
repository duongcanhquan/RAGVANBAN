import { useEffect, useState } from 'react'
import { useOutletContext } from 'react-router-dom'
import { adminFetch } from '../../lib/adminApi'

export default function QuantriUsers() {
  const { me } = useOutletContext()
  const [items, setItems] = useState([])
  const [categories, setCategories] = useState([])
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [form, setForm] = useState({
    email: '',
    password: '',
    display_name: '',
    role: 'editor',
    categoryIds: [],
  })

  async function load() {
    const [uRes, cRes] = await Promise.all([
      adminFetch('/api/quantri/users'),
      adminFetch('/api/quantri/categories'),
    ])
    const users = await uRes.json()
    const cats = await cRes.json()
    if (!uRes.ok) throw new Error(users.error || 'Không tải danh sách')
    setItems(users.items || [])
    setCategories(cats.items || [])
  }

  useEffect(() => {
    load().catch((e) => setError(e.message))
  }, [])

  if (me?.role !== 'super_admin') {
    return <p className="p-6 text-sm text-white/70">Chỉ super-admin được quản lý cán bộ.</p>
  }

  const pathOf = (id) => {
    const byId = new Map(categories.map((c) => [c.id, c]))
    const parts = []
    let cur = byId.get(id)
    const guard = new Set()
    while (cur && !guard.has(cur.id)) {
      guard.add(cur.id)
      parts.unshift(cur.name)
      cur = cur.parent_id ? byId.get(cur.parent_id) : null
    }
    return parts.join(' / ')
  }

  async function onCreate(e) {
    e.preventDefault()
    setBusy(true)
    setError('')
    try {
      const res = await adminFetch('/api/quantri/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Không tạo được')
      setForm({ email: '', password: '', display_name: '', role: 'editor', categoryIds: [] })
      await load()
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  async function toggleActive(user) {
    setError('')
    const res = await adminFetch(`/api/quantri/users/${user.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ is_active: !user.is_active }),
    })
    const data = await res.json()
    if (!res.ok) {
      setError(data.error || 'Không cập nhật được')
      return
    }
    await load()
  }

  async function saveGrants(user, categoryIds) {
    const res = await adminFetch(`/api/quantri/users/${user.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ categoryIds, role: user.role }),
    })
    const data = await res.json()
    if (!res.ok) setError(data.error || 'Không gán chuyên mục')
    else await load()
  }

  async function removeUser(user) {
    if (!window.confirm(`Xóa ${user.email}?`)) return
    const res = await adminFetch(`/api/quantri/users/${user.id}`, { method: 'DELETE' })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) setError(data.error || 'Không xóa được')
    else await load()
  }

  return (
    <div className="mx-auto max-w-5xl px-4 py-8 text-slate-100">
      <h1 className="m-0 text-2xl font-semibold">Nhân sự</h1>
      <p className="m-0 mt-1 mb-6 text-sm text-white/65">
        Super-admin tạo cán bộ và gán chuyên mục được quản lý. Cán bộ chỉ nạp / sửa tài liệu trong phần được
        giao (kèm thư mục con).
      </p>
      {error ? <p className="mb-4 text-sm text-red-200">{error}</p> : null}

      <form
        onSubmit={onCreate}
        className="mb-8 grid gap-3 rounded-3xl border border-white/10 bg-white/5 p-5 sm:grid-cols-2"
      >
        <h2 className="m-0 sm:col-span-2 text-base font-semibold">Thêm cán bộ</h2>
        <input
          required
          type="email"
          placeholder="Email"
          className="rounded-xl border border-white/15 bg-black/20 px-3 py-2 text-sm"
          value={form.email}
          onChange={(e) => setForm({ ...form, email: e.target.value })}
        />
        <input
          required
          type="text"
          placeholder="Mật khẩu tạm"
          className="rounded-xl border border-white/15 bg-black/20 px-3 py-2 text-sm"
          value={form.password}
          onChange={(e) => setForm({ ...form, password: e.target.value })}
        />
        <input
          type="text"
          placeholder="Tên hiển thị"
          className="rounded-xl border border-white/15 bg-black/20 px-3 py-2 text-sm"
          value={form.display_name}
          onChange={(e) => setForm({ ...form, display_name: e.target.value })}
        />
        <select
          className="rounded-xl border border-white/15 bg-black/20 px-3 py-2 text-sm"
          value={form.role}
          onChange={(e) => setForm({ ...form, role: e.target.value })}
        >
          <option value="editor">Theo chuyên mục</option>
          <option value="super_admin">Super-admin</option>
        </select>
        {form.role === 'editor' ? (
          <label className="sm:col-span-2 text-xs text-white/70">
            Chuyên mục được quản lý (Ctrl/Cmd để chọn nhiều)
            <select
              multiple
              className="mt-1 h-36 w-full rounded-xl border border-white/15 bg-black/20 px-3 py-2 text-sm"
              value={form.categoryIds}
              onChange={(e) =>
                setForm({
                  ...form,
                  categoryIds: [...e.target.selectedOptions].map((o) => o.value),
                })
              }
            >
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {pathOf(c.id)}
                </option>
              ))}
            </select>
          </label>
        ) : null}
        <button
          type="submit"
          disabled={busy}
          className="rounded-xl bg-[var(--hcc-red)] px-4 py-2 text-sm font-semibold sm:col-span-2"
        >
          {busy ? 'Đang tạo…' : 'Tạo tài khoản'}
        </button>
      </form>

      <ul className="m-0 list-none space-y-3 p-0">
        {items.map((user) => (
          <li key={user.id} className="rounded-3xl border border-white/10 bg-white/5 p-4">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div>
                <p className="m-0 font-semibold">{user.display_name || user.email}</p>
                <p className="m-0 text-xs text-white/60">
                  {user.email} · {user.role === 'super_admin' ? 'Toàn quyền' : 'Theo chuyên mục'} ·{' '}
                  {user.is_active ? 'Đang hoạt động' : 'Đã khóa'}
                </p>
              </div>
              <div className="flex gap-2">
                <button
                  type="button"
                  className="rounded-full bg-white/10 px-3 py-1 text-xs"
                  onClick={() => toggleActive(user)}
                >
                  {user.is_active ? 'Khóa' : 'Mở'}
                </button>
                <button
                  type="button"
                  className="rounded-full bg-red-500/20 px-3 py-1 text-xs text-red-100"
                  onClick={() => removeUser(user)}
                >
                  Xóa
                </button>
              </div>
            </div>
            {user.role === 'editor' ? (
              <label className="mt-3 block text-xs text-white/70">
                Gán ngành / hạng mục / chủ đề
                <select
                  multiple
                  className="mt-1 h-28 w-full rounded-xl border border-white/15 bg-black/20 px-3 py-2 text-sm"
                  value={user.grantCategoryIds || []}
                  onChange={(e) => saveGrants(user, [...e.target.selectedOptions].map((o) => o.value))}
                >
                  {categories.map((c) => (
                    <option key={c.id} value={c.id}>
                      {pathOf(c.id)}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}
          </li>
        ))}
      </ul>
    </div>
  )
}
