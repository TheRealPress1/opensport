import { createClient } from '@supabase/supabase-js'

// The native host serves only the public anonymous key in this configuration.
// Service-role credentials remain in its main process. Project/demo builds never
// load this module, even if a runtime configuration happens to be present.
const runtime = import.meta.env.VITE_APP_MODE === 'team' ? window.__OPENSPORT_CONFIG__ : null
const SUPABASE_URL = runtime?.supabaseUrl || import.meta.env.VITE_SUPABASE_URL
const SUPABASE_KEY = runtime?.anonKey || import.meta.env.VITE_SUPABASE_ANON_KEY

export const supabaseConfigured = Boolean(SUPABASE_URL && SUPABASE_KEY)

export const supabase = supabaseConfigured
  ? createClient(SUPABASE_URL, SUPABASE_KEY)
  : null
