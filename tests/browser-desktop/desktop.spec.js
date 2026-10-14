import { test, expect } from '@playwright/test'

async function installBridge(page, options = {}) {
  await page.addInitScript(options => {
    let current = { configured: false, running: false, canHost: true, ...options.status }
    let setupCalls = 0
    let restoreCalls = 0
    window.desktopCalls = []
    const record = (method, value) => window.desktopCalls.push({ method, value })
    window.opensportDesktop = {
      getStatus: async () => ({ ...current }),
      showDataFolder: async () => { record('showDataFolder') },
      setup: async value => {
        record('setup', value)
        setupCalls++
        if (options.failFirstSetup && setupCalls === 1) throw new Error('The local server did not finish starting. Please retry.')
        current = { ...current, configured: true, running: true, teamName: value.team.name, localUrl: 'http://127.0.0.1:23456', sharedUrl: '', storagePath: '/Synthetic/OpenSport' }
        return current
      },
      start: async () => { record('start'); current = { ...current, running: true, localUrl: 'http://127.0.0.1:23456' }; return current },
      stop: async () => { record('stop'); current = { ...current, running: false }; return current },
      openExternal: async value => { record('openExternal', value) },
      backup: async () => { record('backup'); current.lastBackupAt = '2026-10-12T12:00:00Z'; return { path: '/Synthetic/Backups/team.opensport', createdAt: current.lastBackupAt } },
      restore: async () => {
        record('restore')
        restoreCalls++
        if (options.cancelFirstRestore && restoreCalls === 1) return { cancelled: true }
        current = { ...current, configured: true, running: true, teamName: 'Restored Sports Club', localUrl: 'http://127.0.0.1:23456' }
        return { status: current }
      },
      recoverOwner: async email => { record('recoverOwner', email); return { link: 'http://127.0.0.1:23456/?auth=recovery#token_hash=synthetic-private-token&type=recovery', expiresAt: '2026-10-12T13:00:00Z' } },
    }
  }, options)
}

test('setup failure retains fields; retry creates the local team without persisting its password', async ({ page }) => {
  const forbidden = []
  page.on('request', request => { if (request.url().includes('desktop-must-not-connect')) forbidden.push(request.url()) })
  await installBridge(page, { failFirstSetup: true })
  await page.goto('/')
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Host on this Mac')
  await expect(page.getByText('Use fictional team data. Other software or accounts on this Mac may be able to access its local database.', { exact: false })).toBeVisible()
  await page.screenshot({ path: '.context/desktop-setup-welcome.png', fullPage: true })
  await page.getByRole('button', { name: 'Set up on this Mac' }).click()
  await page.getByLabel('Team name').fill('Riverside Sports Club')
  await page.getByLabel('Team timezone').selectOption('America/New_York')
  await page.getByLabel('Soccer', { exact: false }).check()
  await page.getByRole('button', { name: 'Continue', exact: true }).click()
  await page.getByLabel('Your name', { exact: true }).fill('Alex Coach')
  await page.getByRole('textbox', { name: /^Email address/ }).fill('desktop-coach@example.test')
  await page.getByLabel('Password', { exact: true }).fill('Synthetic setup password 2026!')
  await page.getByRole('button', { name: 'Create my team' }).click()
  await expect(page.getByRole('alert')).toContainText('Please retry')
  await expect(page.getByRole('alert')).toBeFocused()
  await expect(page.getByLabel('Password', { exact: true })).toHaveValue('Synthetic setup password 2026!')
  await expect(page.getByLabel('Your name', { exact: true })).toHaveValue('Alex Coach')
  await page.getByRole('button', { name: 'Create my team' }).click()
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Riverside Sports Club')
  await expect(page.getByText('Local only · sharing not configured')).toBeVisible()
  await expect(page.getByText('This is an experimental local hosting preview.')).toBeVisible()
  await expect(page.locator('input[type=password]')).toHaveCount(0)
  await page.getByRole('button', { name: 'Open team in browser' }).click()
  expect(await page.evaluate(() => ({ local: { ...localStorage }, session: { ...sessionStorage } }))).toEqual({ local: {}, session: {} })
  expect(await page.evaluate(() => window.desktopCalls.filter(call => call.method === 'setup').length)).toBe(2)
  expect(await page.evaluate(() => window.desktopCalls.at(-1))).toEqual({ method: 'openExternal', value: { url: 'http://127.0.0.1:23456' } })
  expect(forbidden).toEqual([])
  await page.screenshot({ path: '.context/desktop-setup-dashboard.png', fullPage: true })
})

test('existing HTTPS host works without local hosting and rejects unsafe or private invitation URLs', async ({ page }) => {
  await installBridge(page, { status: { canHost: false, hostReason: 'Hosting requires an Apple silicon Mac.' } })
  await page.goto('/')
  await expect(page.getByRole('button', { name: 'Set up on this Mac' })).toBeDisabled()
  await page.getByText('Already have a team address?', { exact: true }).click()
  const address = page.getByRole('textbox', { name: /^Team address/ })
  for (const url of ['http://team.example.test', 'https://user:password@team.example.test', 'https://team.example.test/?auth=invite#token_hash=private']) {
    await address.fill(url)
    await page.getByRole('button', { name: 'Open existing team' }).click()
    await expect(page.getByRole('alert')).toBeVisible()
    await expect(address).toHaveValue(url)
  }
  expect(await page.evaluate(() => window.desktopCalls)).toEqual([])
  await address.fill('https://team.example.test/club')
  await page.getByRole('button', { name: 'Open existing team' }).click()
  await expect(page.getByRole('status')).toContainText('opened in your default browser')
  expect(await page.evaluate(() => window.desktopCalls)).toEqual([{ method: 'openExternal', value: { url: 'https://team.example.test/club' } }])
})

test('dashboard handles server lifecycle, private recovery and backups without overwriting an existing team', async ({ page }) => {
  await installBridge(page, { status: { configured: true, running: true, teamName: 'Northside Community Sports Association With A Long Team Name', localUrl: 'http://127.0.0.1:23456' } })
  await page.goto('/')
  await page.getByRole('button', { name: 'Stop server', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Open team in browser' })).toBeDisabled()
  await page.getByRole('button', { name: 'Start server', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Open team in browser' })).toBeEnabled()
  await page.getByRole('button', { name: 'Save a backup', exact: true }).click()
  await expect(page.getByRole('status')).toContainText('/Synthetic/Backups/team.opensport')
  await page.getByRole('button', { name: 'Restore a backup', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Restore on a new installation' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Choose a backup…' })).toHaveCount(0)
  await page.getByText('Recover administrator access', { exact: true }).click()
  await page.getByLabel('Account email address').fill('desktop-coach@example.test')
  await page.getByRole('button', { name: 'Create recovery link' }).click()
  await expect(page.getByLabel('Private recovery link', { exact: true })).toHaveValue(/synthetic-private-token/)
  await page.getByRole('button', { name: 'Open password reset' }).click()
  const calls = await page.evaluate(() => window.desktopCalls)
  expect(calls.filter(call => call.method === 'restore')).toEqual([])
  expect(calls.find(call => call.method === 'recoverOwner').value).toBe('desktop-coach@example.test')
  expect(calls.at(-1).value.url).toContain('?auth=recovery#token_hash=synthetic-private-token')
  await page.setViewportSize({ width: 390, height: 844 })
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBeTruthy()
  await page.screenshot({ path: '.context/desktop-setup-mobile.png', fullPage: true })
})

test('interrupted setup resumes the account step without remembering its password', async ({ page }) => {
  await installBridge(page, { status: { setupPending: true, team: { name: 'Pending Club', timezone: 'UTC', sport_mode: 'general' }, pendingOwner: { name: 'Pending Coach', email: 'pending@example.test' } } })
  await page.goto('/')
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Create your account')
  await expect(page.getByLabel('Your name', { exact: true })).toHaveValue('Pending Coach')
  await expect(page.getByRole('textbox', { name: /^Email address/ })).toHaveValue('pending@example.test')
  await expect(page.getByLabel('Password', { exact: true })).toHaveValue('')
  await page.getByRole('button', { name: 'Back', exact: true }).click()
  await expect(page.getByLabel('Team name')).toHaveValue('Pending Club')
})

test('welcome restore can be cancelled and then completed', async ({ page }) => {
  await installBridge(page, { cancelFirstRestore: true })
  await page.goto('/')
  await page.getByRole('button', { name: 'Restore from a backup' }).click()
  await page.getByRole('button', { name: 'Choose a backup…' }).click()
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Host on this Mac')
  await expect(page.getByRole('button', { name: 'Choose a backup…' })).toBeEnabled()
  await page.getByRole('button', { name: 'Choose a backup…' }).click()
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Restored Sports Club')
  await expect(page.getByRole('status')).toContainText('Use an account from that backup')
})

test('ordinary browser cannot start a native server', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByText('OpenSport for Mac is needed here.')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Set up on this Mac' })).toBeDisabled()
  await expect(page.getByRole('button', { name: 'Restore from a backup' })).toBeDisabled()
})

test('older preview data stays visible while unsafe host actions are disabled', async ({ page }) => {
  await installBridge(page, { status: {
    configured: true, running: false, teamName: 'Legacy Fictional Club', storagePath: '/Synthetic/Old OpenSport',
    compatibility: { supported: false, reason: 'legacy-preview', message: 'This older preview cannot start with the new database protection. Your saved team files are preserved.' },
  } })
  await page.goto('/')
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Legacy Fictional Club')
  await expect(page.getByRole('alert')).toContainText('Your saved team files are preserved.')
  await expect(page.getByRole('alert')).toContainText('will not reset, convert, or delete your team files')
  await expect(page.getByRole('button', { name: 'Start server', exact: true })).toBeDisabled()
  await expect(page.getByRole('button', { name: 'Open team in browser', exact: true })).toBeDisabled()
  await expect(page.getByRole('button', { name: 'Save a backup', exact: true })).toBeDisabled()
  await page.getByText('Recover administrator access', { exact: true }).click()
  await page.getByLabel('Account email address').fill('legacy@example.test')
  await expect(page.getByRole('button', { name: 'Create recovery link' })).toBeDisabled()
  await page.getByRole('button', { name: 'Show data folder in Finder' }).click()
  expect(await page.evaluate(() => window.desktopCalls)).toEqual([{ method: 'showDataFolder' }])
  await page.setViewportSize({ width: 390, height: 844 })
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBeTruthy()
})

test('an incompatible interrupted preview cannot resume or restore over its data; another HTTPS team still opens', async ({ page }) => {
  await installBridge(page, { status: {
    configured: false, setupPending: true, pendingOwner: { name: 'Old Coach', email: 'old@example.test' }, team: { name: 'Old Fictional Club', timezone: 'UTC', sport_mode: 'general' },
    compatibility: { supported: false, reason: 'legacy-preview', message: 'Your old preview files are preserved.' },
  } })
  await page.goto('/')
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Host on this Mac')
  await expect(page.getByLabel('Password', { exact: true })).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Set up on this Mac' })).toBeDisabled()
  await expect(page.getByRole('button', { name: 'Restore from a backup' })).toBeDisabled()
  await page.getByText('Already have a team address?', { exact: true }).click()
  await page.getByRole('textbox', { name: /^Team address/ }).fill('https://existing.example.test')
  await page.getByRole('button', { name: 'Open existing team' }).click()
  expect(await page.evaluate(() => window.desktopCalls)).toEqual([{ method: 'openExternal', value: { url: 'https://existing.example.test/' } }])
})
