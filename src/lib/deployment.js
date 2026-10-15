// After a successful deploy, Vercel sends the coach back here with the new
// site's address. Only https vercel.app addresses become the "Open my team" link.
export function readDeployment(search = window.location.search, hash = window.location.hash) {
  const params = new URLSearchParams(search)
  for (const [key, value] of new URLSearchParams(hash.split('?')[1] || '')) if (!params.has(key)) params.set(key, value)
  const raw = params.get('deployment-url')
  if (!raw) return null
  try {
    const site = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`)
    if (site.protocol !== 'https:' || !site.hostname.endsWith('.vercel.app')) return null
    let dashboard = null
    try {
      const candidate = new URL(params.get('project-dashboard-url'))
      if (candidate.protocol === 'https:' && candidate.hostname === 'vercel.com') dashboard = candidate.href
    } catch { /* the dashboard link is optional */ }
    return { url: `https://${site.hostname}`, host: site.hostname, dashboard }
  } catch {
    return null
  }
}
