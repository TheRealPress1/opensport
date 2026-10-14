export function getDesktopBridge() {
  return typeof window === 'undefined' ? null : window.opensportDesktop || null
}

export function isDesktopApp() {
  return Boolean(getDesktopBridge())
}

export function validateServerUrl(value) {
  let url
  try { url = new URL(value.trim()) } catch { throw new Error('Enter the full team address, starting with https://.') }
  if (url.protocol !== 'https:' || !url.hostname || url.username || url.password) {
    throw new Error('Use an HTTPS team address without a username or password in the link.')
  }
  if (url.search || url.hash) throw new Error('Enter the team’s main address, without an invitation or sign-in link.')
  return url.href
}

async function invoke(method, payload) {
  const bridge = getDesktopBridge()
  if (typeof bridge?.[method] !== 'function') throw new Error('Open this screen in the OpenSport Mac app to manage a local team.')
  try { return await bridge[method](payload) }
  catch (error) { throw new Error(error?.message || 'That action did not finish. Please try again.') }
}

export const desktop = {
  getStatus: () => invoke('getStatus'),
  showDataFolder: () => invoke('showDataFolder'),
  setup: payload => invoke('setup', payload),
  start: () => invoke('start'),
  stop: () => invoke('stop'),
  backup: () => invoke('backup'),
  restore: () => invoke('restore'),
  recoverOwner: email => invoke('recoverOwner', email),
  openExternal: url => invoke('openExternal', { url }),
}
