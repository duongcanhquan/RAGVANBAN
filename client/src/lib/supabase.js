import { createClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL
const anon = import.meta.env.VITE_SUPABASE_ANON_KEY

export const supabaseConfigured = Boolean(
  url && anon && !String(url).includes('your-project') && !String(anon).includes('your-')
)

/** Anon client — chỉ đọc stats/logs (RLS select). */
export const supabase = supabaseConfigured
  ? createClient(url, anon)
  : null
