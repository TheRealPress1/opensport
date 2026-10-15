// Vercel's Deploy button sends coaches back here after a successful deploy and
// adds these callback parameters. Any of them means the coach has returned.
const callbackParams = ['deployment-url', 'project-name', 'project-dashboard-url', 'deployment-dashboard-url', 'repository-url']

function returnParams(search, hash) {
  const params = new URLSearchParams(search)
  for (const [key, value] of new URLSearchParams(hash.split('?')[1] || '')) if (!params.has(key)) params.set(key, value)
  return params
}

export const returnedFromVercel = (search = window.location.search, hash = window.location.hash) => {
  const params = returnParams(search, hash)
  return callbackParams.some(name => params.has(name))
}

function safeUrl(raw, allowed) {
  try {
    const url = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`)
    return url.protocol === 'https:' && allowed(url.hostname) ? url : null
  } catch {
    return null
  }
}

// Only an https vercel.app address becomes the "Open my team" link, and only a
// vercel.com address the dashboard link. Without a usable site address the page
// still welcomes the coach back and points to their Vercel dashboard.
export function readDeployment(search = window.location.search, hash = window.location.hash) {
  if (!returnedFromVercel(search, hash)) return null
  const params = returnParams(search, hash)
  const site = params.get('deployment-url') && safeUrl(params.get('deployment-url'), host => host.endsWith('.vercel.app'))
  const dashboard = params.get('project-dashboard-url') && safeUrl(params.get('project-dashboard-url'), host => host === 'vercel.com')
  return { url: site ? `https://${site.hostname}` : null, host: site?.hostname || null, dashboard: dashboard ? dashboard.href : null }
}
