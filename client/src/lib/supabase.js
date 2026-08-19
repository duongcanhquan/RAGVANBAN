import { createClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL
const anon = import.meta.env.VITE_SUPABASE_ANON_KEY

export const supabaseConfigured = Boolean(
  url && anon && !String(url).includes('your-project') && !String(anon).includes('your-')
)

/** Anon client — đọc công khai + đăng nhập /quantri (email/password). */
export const supabase = supabaseConfigured
  ? createClient(url, anon, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
        storageKey: 'ragvanban-quantri-auth',
      },
    })
  : null
