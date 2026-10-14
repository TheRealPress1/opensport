import { useCallback, useEffect, useState } from 'react'

// One-click cloud installs (Vercel + Supabase) run privileged actions as Vercel
// Functions in the same deployment instead of a Supabase Edge Function.
export const cloudInstall = import.meta.env.VITE_OPENSPORT_CLOUD === '1'

export async function cloudRequest(path, { method = 'GET', body, token } = {}) {
  const headers = {}
  if (body) headers['Content-Type'] = 'application/json'
  if (token) headers.Authorization = `Bearer ${token}`
  const response = await fetch(path, { method, headers, body: body ? JSON.stringify(body) : undefined })
  let data = null
  try { data = await response.json() } catch { /* reported below */ }
  if (!response.ok || data?.error) throw new Error(data?.error || 'OpenSport could not reach its server. Check your connection and try again.')
  return data
}

// First-run state: whether the team still needs its owner, and whether Supabase
// still allows public sign-ups.
export function useCloudStatus() {
  const [state, setState] = useState({ loading: cloudInstall, status: null, error: '' })
  const [version, setVersion] = useState(0)
  useEffect(() => {
    if (!cloudInstall) return
    let active = true
    cloudRequest('/api/setup')
      .then(status => { if (active) setState({ loading: false, status, error: '' }) })
      .catch(cause => { if (active) setState({ loading: false, status: null, error: cause.message }) })
    return () => { active = false }
  }, [version])
  const refresh = useCallback(() => setVersion(value => value + 1), [])
  return { ...state, refresh }
}
