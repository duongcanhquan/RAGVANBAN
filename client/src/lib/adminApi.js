import { supabase } from './supabase'
import { apiUrl } from './apiBase'

export async function getAuthHeaders(extra = {}) {
  const headers = { ...extra }
  if (!supabase) return headers
  const { data } = await supabase.auth.getSession()
  const token = data.session?.access_token
  if (token) headers.Authorization = `Bearer ${token}`
  return headers
}

export async function adminFetch(url, options = {}) {
  const headers = await getAuthHeaders(options.headers || {})
  return fetch(apiUrl(url), { ...options, headers })
}
