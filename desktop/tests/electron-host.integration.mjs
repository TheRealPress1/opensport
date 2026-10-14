// Opt-in real GUI -> native server -> browser -> backup lifecycle.
// Every run creates private synthetic data in a new repository .context folder.
import test from 'node:test'
import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import { mkdir, mkdtemp, cp, stat } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { _electron, chromium, expect } from '@playwright/test'
import electronPath from 'electron'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
test('Mac wizard creates a real team, signs in through its browser gateway, and backs up across restart', {
  skip: process.env.OPENSPORT_ELECTRON_HOST_TEST !== '1', timeout: 20 * 60 * 1000,
}, async () => {
  const fixtures = path.join(root, '.context/electron-host-integration')
  await mkdir(fixtures, { recursive: true, mode: 0o700 })
  const dataDir = await mkdtemp(path.join(fixtures, 'run-'))
  if (process.env.OPENSPORT_NATIVE_TEST_SEED_CACHE) {
    const cache = path.resolve(process.env.OPENSPORT_NATIVE_TEST_SEED_CACHE)
    if (!cache.startsWith(`${path.join(root, '.context')}${path.sep}`)) throw new Error('Test cache must be in this repository’s private .context directory.')
    await cp(cache, path.join(dataDir, 'runtime/home/cache'), { recursive: true })
  }
  const env = { ...process.env, OPENSPORT_DESKTOP_DATA_DIR: dataDir }
  delete env.ELECTRON_RUN_AS_NODE
  const app = await _electron.launch({ executablePath: electronPath, args: [path.join(root, 'desktop/main.mjs')], cwd: root, env })
  let browser
  try {
    const page = await app.firstWindow()
    await page.getByRole('button', { name: 'Set up on this Mac' }).click()
    await page.getByLabel('Team name', { exact: true }).fill('Mac Wizard Sports Club')
    await page.getByRole('button', { name: 'Continue', exact: true }).click()
    const email = `mac-wizard-${Date.now()}@example.test`
    const password = randomBytes(32).toString('base64url')
    await page.getByLabel('Your name', { exact: true }).fill('Preview Coach')
    await page.getByRole('textbox', { name: /^Email address/ }).fill(email)
    await page.getByLabel('Password', { exact: true }).fill(password)
    await page.getByRole('button', { name: 'Create my team' }).click()
    await Promise.race([
      expect(page.getByRole('button', { name: 'Stop server', exact: true })).toBeEnabled({ timeout: 15 * 60 * 1000 }),
      page.getByRole('alert').waitFor({ state: 'visible', timeout: 15 * 60 * 1000 }).then(async () => { throw new Error(await page.getByRole('alert').innerText()) }),
    ])
    const status = await page.evaluate(() => window.opensportDesktop.getStatus())
    assert.equal(status.configured, true)
    assert.equal(status.running, true)
    assert.equal(status.teamName, 'Mac Wizard Sports Club')
    assert.equal(status.sharedUrl, '')
    await page.screenshot({ path: path.join(root, '.context/opensport-mac-hosting.png'), fullPage: true })
    browser = await chromium.launch(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE } : {})
    const team = await browser.newPage()
    await team.goto(status.localUrl)
    await team.getByLabel('Email', { exact: true }).fill(email)
    await team.getByLabel('Password', { exact: true }).fill(password)
    await team.getByRole('button', { name: 'Sign in', exact: true }).click()
    await expect(team.getByRole('button', { name: 'Manage', exact: true })).toBeVisible()
    const archivePath = path.join(fixtures, `${path.basename(dataDir)}.opensport`)
    await app.evaluate(({ dialog }, filePath) => { dialog.showSaveDialog = async () => ({ canceled: false, filePath }) }, archivePath)
    await page.getByRole('button', { name: 'Save a backup', exact: true }).click()
    await expect(page.getByText(`Backup saved to ${archivePath}`, { exact: true })).toBeVisible({ timeout: 120000 })
    assert.equal((await stat(archivePath)).mode & 0o777, 0o600)
    await expect(page.getByRole('button', { name: 'Stop server', exact: true })).toBeEnabled()
    await page.getByRole('button', { name: 'Stop server', exact: true }).click()
    await expect(page.getByRole('button', { name: 'Start server', exact: true })).toBeEnabled({ timeout: 60000 })
    await page.getByRole('button', { name: 'Start server', exact: true }).click()
    await expect(page.getByRole('button', { name: 'Stop server', exact: true })).toBeEnabled({ timeout: 120000 })
    await team.reload()
    await expect(team.getByRole('button', { name: 'Manage', exact: true })).toBeVisible({ timeout: 15000 })
    assert.equal((await page.evaluate(() => window.opensportDesktop.getStatus())).localUrl, status.localUrl)
  } finally {
    await browser?.close()
    // Quit goes through the application's graceful native shutdown handler.
    await app.close()
  }
})
