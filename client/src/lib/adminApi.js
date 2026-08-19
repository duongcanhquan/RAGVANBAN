import { supabase } from './supabase'
import { apiUrl } from './apiBase'

let tokenCache = { token: '', at: 0 }
const TOKEN_TTL_MS = 8_000

export async function getAuthHeaders(extra = {}) {
  const headers = { ...extra }
  if (!supabase) return headers
  const now = Date.now()
  let token = tokenCache.token
  if (!token || now - tokenCache.at > TOKEN_TTL_MS) {
    const { data } = await supabase.auth.getSession()
    token = data.session?.access_token || ''
    tokenCache = { token, at: now }
  }
  if (token) headers.Authorization = `Bearer ${token}`
  return headers
}

export async function adminFetch(url, options = {}) {
  const headers = await getAuthHeaders(options.headers || {})
  return fetch(apiUrl(url), { ...options, headers })
}

export function clearAuthTokenCache() {
  tokenCache = { token: '', at: 0 }
}

