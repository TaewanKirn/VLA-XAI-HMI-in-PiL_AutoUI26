import { createClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

// The app works fine without Supabase configured — prompt examples just stay
// local/manual. When both env vars are present, the dynamic few-shot loop turns on.
export const isSupabaseEnabled = Boolean(url && anonKey)

export const supabase = isSupabaseEnabled ? createClient(url, anonKey) : null

if (!isSupabaseEnabled) {
  console.info('[supabase] not configured (VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY) — dynamic few-shot disabled.')
}
