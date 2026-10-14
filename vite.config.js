import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  // One-click cloud installs receive Supabase's Vercel Marketplace variables
  // instead of VITE_ ones. Expose only the public URL and publishable key.
  const supabaseUrl = env.VITE_SUPABASE_URL || env.NEXT_PUBLIC_SUPABASE_URL || env.SUPABASE_URL || ''
  const supabaseKey = env.VITE_SUPABASE_ANON_KEY || env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || env.SUPABASE_PUBLISHABLE_KEY || env.NEXT_PUBLIC_SUPABASE_ANON_KEY || env.SUPABASE_ANON_KEY || ''
  // A Deploy button install has a setup code, and normally the Marketplace variables.
  // Only whether the code exists reaches the browser, never the code itself.
  const cloud = env.VITE_OPENSPORT_CLOUD || (env.VERCEL && (env.OPENSPORT_SETUP_CODE || (!env.VITE_SUPABASE_URL && supabaseUrl)) ? '1' : '')
  return {
    plugins: [
      react(),
      tailwindcss(),
    ],
    define: {
      'import.meta.env.VITE_SUPABASE_URL': JSON.stringify(supabaseUrl),
      'import.meta.env.VITE_SUPABASE_ANON_KEY': JSON.stringify(supabaseKey),
      'import.meta.env.VITE_OPENSPORT_CLOUD': JSON.stringify(cloud),
    },
  }
})
