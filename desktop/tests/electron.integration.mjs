import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, stat } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { _electron, expect } from '@playwright/test'
import electronPath from 'electron'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const enabled = process.env.OPENSPORT_ELECTRON_TEST === '1' && process.platform === 'darwin'

// Opt-in: opens the real Electron application, but never starts a native server,
// creates an account, opens an external browser, or touches the user's team data.
// Run npm run desktop:prepare first, then:
// OPENSPORT_ELECTRON_TEST=1 node --test desktop/tests/electron.integration.mjs
test('actual Mac shell loads securely and completes the guided fields without starting a server', { skip: !enabled, timeout: 90000 }, async () => {
  await stat(path.join(root, 'desktop/dist/shell/index.html'))
  const fixtureRoot = path.join(root, '.context/electron-ui-check')
  await mkdir(fixtureRoot, { recursive: true, mode: 0o700 })
  const dataDir = await mkdtemp(path.join(fixtureRoot, 'run-'))
  const environment = { ...process.env, OPENSPORT_DESKTOP_DATA_DIR: dataDir }
  delete environment.ELECTRON_RUN_AS_NODE
  const electron = await _electron.launch({ executablePath: electronPath, args: [path.join(root, 'desktop/main.mjs')], cwd: root, env: environment, timeout: 30000 })
  try {
    const page = await electron.firstWindow()
    const errors = []
    page.on('pageerror', error => errors.push(error.message))
    await page.reload()
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Host on this Mac')
    assert.equal(page.url(), 'opensport://app/')
    const security = await electron.evaluate(({ BrowserWindow }) => {
      const preferences = BrowserWindow.getAllWindows()[0].webContents.getLastWebPreferences()
      return { contextIsolation: preferences.contextIsolation, nodeIntegration: preferences.nodeIntegration, sandbox: preferences.sandbox, webSecurity: preferences.webSecurity }
    })
    assert.deepEqual(security, { contextIsolation: true, nodeIntegration: false, sandbox: true, webSecurity: true })
    const renderer = await page.evaluate(async () => ({
      bridge: Object.keys(window.opensportDesktop).sort(),
      frozen: Object.isFrozen(window.opensportDesktop),
      nodeAccess: typeof window.require,
      processAccess: typeof window.process,
      status: await window.opensportDesktop.getStatus(),
    }))
    assert.deepEqual(renderer.bridge, ['backup', 'getStatus', 'openExternal', 'recoverOwner', 'restore', 'setup', 'showDataFolder', 'start', 'stop'].sort())
    assert.equal(renderer.frozen, true)
    assert.equal(renderer.nodeAccess, 'undefined')
    assert.equal(renderer.processAccess, 'undefined')
    assert.equal(renderer.status.configured, false)
    assert.equal(renderer.status.running, false)
    assert.equal(renderer.status.sharedUrl, '')
    assert.equal(renderer.status.storagePath, dataDir)
    assert.doesNotMatch(JSON.stringify(renderer.status), /service.?role|jwt.?secret|password|anon.?key|postgres:\/\//i)

    for (const url of ['javascript:alert(1)', 'file:///etc/passwd', 'data:text/html,unsafe', 'http://example.test', 'https://user:private@example.test', 'opensport://app/']) {
      const result = await page.evaluate(async url => {
        try { await window.opensportDesktop.openExternal({ url }); return 'allowed' }
        catch (error) { return error.message }
      }, url)
      assert.match(result, /secure HTTPS team address/, `Rejected protocol or credentials: ${new URL(url).protocol}`)
    }
    const forbiddenAssets = await page.evaluate(async () => {
      const results = []
      for (const url of ['opensport://app/package.json', 'opensport://app/desktop.json', 'opensport://app/%2e%2e/desktop/main.mjs']) {
        results.push((await fetch(url)).status)
      }
      return results
    })
    assert.deepEqual(forbiddenAssets, [404, 404, 404])

    // The same preload in a different native window cannot exercise privileged IPC.
    const untrusted = await electron.evaluate(async ({ BrowserWindow }, preload) => {
      const secondary = new BrowserWindow({ show: false, webPreferences: { preload, sandbox: true, contextIsolation: true, nodeIntegration: false } })
      try {
        await secondary.loadURL('opensport://app/')
        return await secondary.webContents.executeJavaScript('window.opensportDesktop.getStatus().then(() => "allowed", error => error.message)')
      } finally { secondary.destroy() }
    }, path.join(root, 'desktop/preload.cjs'))
    assert.match(untrusted, /cannot manage OpenSport/)

    await page.getByRole('button', { name: 'Set up on this Mac' }).focus()
    await page.keyboard.press('Enter')
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Make it your team')
    await expect(page.getByRole('heading', { level: 1 })).toBeFocused()
    await page.keyboard.press('Tab')
    await expect(page.getByRole('textbox', { name: 'Team name', exact: true })).toBeFocused()
    await page.keyboard.type('Riverside Sports Club')
    await page.getByLabel('Team timezone').selectOption('America/New_York')
    await page.getByRole('button', { name: 'Continue', exact: true }).focus()
    await page.keyboard.press('Enter')
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Create your account')
    await page.getByLabel('Your name', { exact: true }).fill('Alex Coach')
    await page.getByRole('textbox', { name: /^Email address/ }).fill('mac-shell-test@example.test')
    await page.getByLabel('Password', { exact: true }).fill('Synthetic local shell password')
    await page.getByRole('button', { name: 'Show password' }).click()
    await expect(page.getByLabel('Password', { exact: true })).toHaveAttribute('type', 'text')
    await page.getByRole('button', { name: 'Hide password' }).click()
    await expect(page.getByLabel('Password', { exact: true })).toHaveAttribute('type', 'password')
    await expect(page.getByRole('button', { name: 'Create my team' })).toBeEnabled()
    assert.equal((await page.evaluate(() => window.opensportDesktop.getStatus())).running, false)
    assert.deepEqual(await page.evaluate(() => ({ local: { ...localStorage }, session: { ...sessionStorage } })), { local: {}, session: {} })
    assert.deepEqual(errors, [])

    // Capture the real app's welcome screen without retaining the synthetic password.
    await page.reload()
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Host on this Mac')
    await page.screenshot({ path: path.join(root, '.context/opensport-mac-app.png'), fullPage: true })
  } finally { await electron.close() }
})
