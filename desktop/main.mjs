import { app, BrowserWindow, dialog, ipcMain, protocol, session, shell, powerSaveBlocker } from 'electron'
import path from 'node:path'
import os from 'node:os'
import { mkdir, readFile, writeFile, chmod } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { TeamGateway, readAsset } from './gateway.mjs'
import { NativeRuntime } from './native-runtime.mjs'
import { TeamService } from './team-service.mjs'
import { createBackup, restoreBackup } from './backup.mjs'

const here = path.dirname(fileURLToPath(import.meta.url))
const resourcesDir = path.join(here, 'resources')
const frontendDir = path.join(here, 'dist')
app.setName('OpenSport')
const dataDir = !app.isPackaged && process.env.OPENSPORT_DESKTOP_DATA_DIR
  ? path.resolve(process.env.OPENSPORT_DESKTOP_DATA_DIR) : path.join(app.getPath('appData'), 'OpenSport')
app.setPath('userData', path.join(dataDir, 'window'))
protocol.registerSchemesAsPrivileged([{ scheme: 'opensport', privileges: { standard: true, secure: true, supportFetchAPI: true } }])
if (!app.requestSingleInstanceLock()) app.quit()
else {
  let window, gateway, runtimeConfig = null, busy = false, phase = '', wakeLock = null, quitting = false
  let preferences = {}
  const runtime = new NativeRuntime({ dataDir, resourcesDir, onProgress: progress => { phase = typeof progress === 'string' ? progress : progress.message || progress.phase || 'Starting your team server…' } })
  const service = new TeamService({ dataDir, getRuntimeConfig: () => runtimeConfig, getPublicUrl: () => gateway?.origin })
  const preferencesPath = path.join(dataDir, 'desktop.json')
  async function savePreferences() {
    await mkdir(dataDir, { recursive: true, mode: 0o700 })
    await writeFile(`${preferencesPath}.tmp`, JSON.stringify(preferences), { mode: 0o600 })
    const { rename } = await import('node:fs/promises')
    await rename(`${preferencesPath}.tmp`, preferencesPath)
  }
  async function status() {
    const team = await service.status()
    const compatibility = await runtime.compatibility()
    const canHost = process.platform === 'darwin' && process.arch === 'arm64' && Number(os.release().split('.')[0]) >= 23
    return {
      configured: team.configured, teamName: team.team?.name || preferences.teamName || '',
      running: Boolean(runtimeConfig), canHost, compatibility,
      hostReason: canHost ? '' : 'Hosting currently requires an Apple silicon Mac with macOS 14 or later. You can still open an existing team.',
      localUrl: runtimeConfig ? gateway?.origin : '', sharedUrl: '', storagePath: dataDir,
      lastBackupAt: preferences.lastBackupAt || null, busy, phase,
      setupPending: team.setupPending, pendingOwner: team.pendingOwner, team: team.team,
      localOnly: true, runtimeLabel: 'Mac hosting preview',
    }
  }
  async function start() {
    const compatibility = await runtime.compatibility()
    if (!compatibility.supported) throw new Error(compatibility.message)
    if (runtimeConfig) return status()
    if (!(await status()).canHost) throw new Error('Hosting requires an Apple silicon Mac with macOS 14 or later.')
    phase = 'Starting your team server…'
    gateway = new TeamGateway({ staticDir: path.join(frontendDir, 'team'), getRuntimeConfig: () => runtimeConfig })
    try {
      const publicUrl = await gateway.start(preferences.port || 0)
      preferences.port = Number(new URL(publicUrl).port)
      await savePreferences()
      runtimeConfig = await runtime.start({ publicUrl })
      wakeLock = powerSaveBlocker.start('prevent-app-suspension')
      phase = ''
      return status()
    } catch (error) {
      runtimeConfig = null
      await gateway?.stop().catch(() => {})
      await runtime.stop().catch(() => {})
      throw error
    }
  }
  async function stop() {
    phase = 'Stopping your team server safely…'
    runtimeConfig = null
    await gateway?.stop()
    gateway = null
    if (wakeLock !== null) { powerSaveBlocker.stop(wakeLock); wakeLock = null }
    await runtime.stop()
    phase = ''
    return status()
  }
  async function exclusive(action) {
    if (busy) throw new Error('Another operation is still running. Please wait for it to finish.')
    busy = true
    try { return await action() } finally { busy = false; phase = '' }
  }
  function trusted(event) {
    const url = new URL(event.senderFrame.url)
    return window && event.sender === window.webContents && event.senderFrame === window.webContents.mainFrame
      && url.protocol === 'opensport:' && url.host === 'app'
  }
  function register(method, handler) {
    ipcMain.handle(`opensport:${method}`, async (event, value) => {
      if (!trusted(event)) throw new Error('This window cannot manage OpenSport.')
      try { return await handler(value) } catch (error) {
        // Never return arbitrary HTTP payloads, process output, keys, or DB URLs.
        const message = String(error.message || '')
        if (/password=|postgres(?:ql)?:|Bearer |eyJ|service.?role.?key/i.test(message)) throw new Error('OpenSport could not complete this operation. Your saved data remains on this Mac.')
        throw new Error(message.slice(0, 400) || 'OpenSport could not complete this operation. Please retry.')
      }
    })
  }
  app.whenReady().then(async () => {
  await mkdir(dataDir, { recursive: true, mode: 0o700 })
  await chmod(dataDir, 0o700)
  try { preferences = JSON.parse(await readFile(preferencesPath, 'utf8')) } catch { /* fresh install */ }
  // Only one app instance may own this private runtime. Reclaim any daemon left
  // by a previous crash, including a legacy preview, before showing "Stopped".
  // Never start or convert that daemon while checking compatibility.
  try { await runtime.stop() }
  catch {
    dialog.showErrorBox('OpenSport could not stop its earlier server', 'The earlier local server could not be confirmed stopped. Quit any earlier OpenSport copy and reopen this app. Keep your saved team folder; no migration was attempted.')
    app.exit(1)
    return
  }
  protocol.handle('opensport', async request => {
    const url = new URL(request.url)
    if (url.host !== 'app' || request.method !== 'GET') return new Response('Not found', { status: 404 })
    const asset = await readAsset(path.join(frontendDir, 'shell'), url.pathname === '/' ? '/index.html' : url.pathname)
    if (!asset) return new Response('Not found', { status: 404 })
    return new Response(asset.body, { headers: {
      'Content-Type': asset.type,
      'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; object-src 'none'; frame-src 'none'; base-uri 'self'; form-action 'none'",
      'X-Content-Type-Options': 'nosniff',
    } })
  })
  session.defaultSession.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false))
  session.defaultSession.setPermissionCheckHandler(() => false)
  register('getStatus', status)
  register('showDataFolder', () => { shell.showItemInFolder(dataDir) })
  register('start', () => exclusive(start))
  register('stop', () => exclusive(stop))
  register('setup', value => exclusive(async () => {
    await start()
    const result = await service.setup(value)
    preferences.teamName = result.team.name
    await savePreferences()
    return status()
  }))
  register('recoverOwner', email => exclusive(async () => {
    await start()
    return service.recoverOwner(email)
  }))
  register('backup', () => exclusive(async () => {
    const compatibility = await runtime.compatibility()
    if (!compatibility.supported) throw new Error(compatibility.message)
    if (!(await service.status()).configured) throw new Error('Create your team before saving a backup.')
    const choice = await dialog.showSaveDialog(window, { title: 'Save a private OpenSport backup', defaultPath: `OpenSport-${new Date().toISOString().slice(0, 10)}.opensport`, filters: [{ name: 'OpenSport backup', extensions: ['opensport'] }] })
    if (choice.canceled) return { cancelled: true }
    const wasRunning = Boolean(runtimeConfig)
    await stop()
    runtime.getBackupPaths()
    phase = 'Saving accounts, team records, and photos…'
    try {
      await createBackup({ dataDir, archivePath: choice.filePath })
      preferences.lastBackupAt = new Date().toISOString()
      await savePreferences()
      return { path: choice.filePath, createdAt: preferences.lastBackupAt }
    } finally { if (wasRunning) await start() }
  }))
  register('restore', () => exclusive(async () => {
    const compatibility = await runtime.compatibility()
    if (!compatibility.supported) throw new Error(compatibility.message)
    if ((await service.status()).configured) throw new Error('Restore requires an empty installation. Your current team has not been changed.')
    const choice = await dialog.showOpenDialog(window, { title: 'Restore an OpenSport backup', properties: ['openFile'], filters: [{ name: 'OpenSport backup', extensions: ['opensport'] }] })
    if (choice.canceled) return { cancelled: true }
    await stop()
    phase = 'Restoring your private backup…'
    await restoreBackup({ dataDir, archivePath: choice.filePaths[0] })
    try { preferences = JSON.parse(await readFile(preferencesPath, 'utf8')) } catch { preferences = {} }
    await start()
    return { status: await status() }
  }))
  register('openExternal', async value => {
    const url = new URL(value?.url)
    const local = gateway?.origin && url.origin === gateway.origin
    if ((!local && url.protocol !== 'https:') || url.username || url.password) throw new Error('Use a secure HTTPS team address.')
    await shell.openExternal(url.href)
  })
  function createWindow() {
    window = new BrowserWindow({ title: 'OpenSport', width: 1100, height: 810, minWidth: 720, minHeight: 620, backgroundColor: '#f7f6ef',
      webPreferences: { preload: path.join(here, 'preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true, webSecurity: true },
    })
    window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
    window.webContents.on('will-navigate', (event, url) => { if (url !== 'opensport://app/') event.preventDefault() })
    window.on('close', event => { if (!quitting && runtimeConfig) { event.preventDefault(); window.hide() } })
    window.loadURL('opensport://app/')
  }
  createWindow()
  app.on('second-instance', () => { window?.show(); window?.focus() })
  app.on('activate', () => { if (!BrowserWindow.getAllWindows().length) createWindow(); else window.show() })
  app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit() })
  app.on('before-quit', event => {
    if (quitting) return
    event.preventDefault()
    if (busy) {
      window?.show()
      dialog.showMessageBox(window, { type: 'info', title: 'OpenSport is working', message: 'Wait for the current setup or backup to finish before quitting. Your progress is shown in the app.' })
      return
    }
    quitting = true
    stop().then(() => app.quit()).catch(async () => {
      quitting = false
      await dialog.showMessageBox(window, { type: 'error', title: 'OpenSport is still stopping', message: 'The team server could not stop safely. Try Stop hosting again before quitting.' })
    })
  })
  }).catch(() => {
    dialog.showErrorBox('OpenSport could not start', 'The application could not open its private settings or bundled files. Reinstall the preview without deleting your OpenSport data folder.')
    app.exit(1)
  })
}
