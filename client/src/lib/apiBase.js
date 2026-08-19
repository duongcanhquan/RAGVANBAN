/**
 * Gốc API khi client và server khác origin (`VITE_API_BASE`).
 */
export function apiUrl(path = '') {
  const base = String(import.meta.env.VITE_API_BASE || '').replace(/\/$/, '')
  const p = path.startsWith('/') ? path : path ? `/${path}` : ''
  if (!p) return base || ''
  return `${base}${p}`
}

export function publicApiUrl(path = '') {
  const built = apiUrl(path)
  if (/^https?:\/\//i.test(built)) return built
  if (typeof window !== 'undefined') {
    const p = built.startsWith('/') ? built : `/${built}`
    return `${window.location.origin}${p}`
  }
  return built
}
