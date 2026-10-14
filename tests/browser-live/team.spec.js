import { test, expect } from '@playwright/test'

// Explicitly opt in against a disposable local installation. Never use production accounts.
const email = process.env.OPENSPORT_TEST_ADMIN_EMAIL
const password = process.env.OPENSPORT_TEST_ADMIN_PASSWORD
const syntheticPassword = 'Synthetic-player-password-42!'
const baseURL = process.env.OPENSPORT_TEST_URL || 'http://localhost:18880'
const localTls = process.env.OPENSPORT_TEST_TLS === '1'
const contextOptions = { ignoreHTTPSErrors: localTls }
const socketsByPage = new WeakMap()
const dateOffset = offset => { const date = new Date(); date.setUTCDate(date.getUTCDate() + offset); return date.toISOString().slice(0, 10) }
const unique = () => `${Date.now()}-${Math.floor(Math.random() * 100000)}`

test.beforeEach(async ({ page }) => {
  test.skip(!email || !password, 'Set synthetic admin credentials for a disposable local stack.')
  expect(['localhost', '127.0.0.1']).toContain(new URL(baseURL).hostname)
  if (localTls) expect(new URL(baseURL).protocol).toBe('https:')
  const sockets = []
  socketsByPage.set(page, sockets)
  page.on('websocket', socket => sockets.push(socket.url()))
  await page.goto('/')
  await page.getByLabel('Email', { exact: true }).fill(email)
  await page.getByLabel('Password', { exact: true }).fill(password)
  await page.getByRole('button', { name: 'Sign in', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Manage', exact: true })).toBeVisible()
})

async function manage(page) {
  await page.getByRole('button', { name: 'Manage', exact: true }).click()
  return page.getByRole('dialog', { name: 'Manage your team' })
}

async function createEvent(page, title, type = 'practice') {
  await page.getByRole('button', { name: '+ Event', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'New event' })
  await dialog.getByRole('radio', { name: type === 'game' ? 'Game' : 'Practice' }).locator('..').click()
  await dialog.getByLabel('Title *', { exact: true }).fill(title)
  await dialog.getByLabel('Date *', { exact: true }).fill(dateOffset(2))
  await dialog.getByLabel('Start Time', { exact: true }).fill('18:00')
  await dialog.getByRole('button', { name: 'Create Event', exact: true }).click()
  await expect(dialog).toBeHidden()
  await expect(page.getByRole('heading', { name: title, exact: true })).toBeVisible()
}

test('admin configures a general team; a failed event write keeps input and can retry', async ({ page }) => {
  const errors = []
  page.on('pageerror', cause => errors.push(cause.message))
  const settings = await manage(page)
  await settings.getByLabel('Team name', { exact: true }).fill('Synthetic Community Team')
  await settings.getByLabel('Sport tools').selectOption('general')
  await settings.getByLabel('Timezone').fill('America/New_York')
  await settings.getByRole('button', { name: 'Save settings', exact: true }).click()
  await expect(settings.getByText('Team settings saved.')).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(settings).toBeHidden()
  await expect(page.getByRole('heading', { name: 'Synthetic Community Team' })).toBeVisible()
  await page.getByRole('button', { name: '+ Event', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'New event' })
  const title = `Retry practice ${unique()}`
  await dialog.getByRole('radio', { name: 'Practice' }).locator('..').click()
  await dialog.getByLabel('Title *', { exact: true }).fill(title)
  await dialog.getByLabel('Date *', { exact: true }).fill(dateOffset(1))
  const blockWrite = route => route.request().method() === 'POST' ? route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ message: 'Synthetic offline failure' }) }) : route.continue()
  await page.route('**/rest/v1/soccer_events*', blockWrite)
  await dialog.getByRole('button', { name: 'Create Event', exact: true }).click()
  await expect(dialog.getByRole('alert')).toHaveText('Synthetic offline failure')
  await expect(dialog.getByLabel('Title *', { exact: true })).toHaveValue(title)
  await page.unroute('**/rest/v1/soccer_events*', blockWrite)
  await dialog.getByRole('button', { name: 'Create Event', exact: true }).click()
  await expect(dialog).toBeHidden()
  await expect(page.getByRole('heading', { name: title, exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Roster', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Saved lineups' })).toHaveCount(0)
  await page.getByRole('button', { name: 'Stats', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Top Scorers' })).toHaveCount(0)
  expect(errors).toEqual([])
})

test('invite, decline RSVP across two sessions, role privacy, and organizer recovery', async ({ page, browser }) => {
  const suffix = unique()
  const memberName = `Synthetic Player ${suffix}`
  const memberEmail = `player-${suffix}@example.test`
  const title = `Team practice ${suffix}`
  const initialSettings = await manage(page)
  await initialSettings.getByLabel('Sport tools').selectOption('general')
  await initialSettings.getByRole('button', { name: 'Save settings', exact: true }).click()
  await expect(initialSettings.getByText('Team settings saved.')).toBeVisible()
  await page.keyboard.press('Escape')
  await createEvent(page, title)
  const settings = await manage(page)
  await settings.getByLabel('Email', { exact: true }).fill(memberEmail)
  await settings.getByLabel('Name (optional)', { exact: true }).fill(memberName)
  await settings.getByRole('button', { name: 'Create invitation link', exact: true }).click()
  const inviteLink = await settings.getByLabel('Private, expiring link').inputValue()
  expect(inviteLink).toContain('auth=invite')
  const memberContext = await browser.newContext(contextOptions)
  const member = await memberContext.newPage()
  const memberSockets = []
  member.on('websocket', socket => memberSockets.push(socket.url()))
  try {
    const tokenRequests = []
    member.on('request', request => { if (request.url().includes('/auth/v1/verify')) tokenRequests.push(request.url()) })
    await member.goto(inviteLink)
    await expect(member.getByRole('button', { name: 'Continue with this link' })).toBeVisible()
    expect(tokenRequests).toEqual([])
    await member.getByRole('button', { name: 'Continue with this link' }).click()
    await member.getByLabel('Your name', { exact: true }).fill(memberName)
    await member.getByLabel('New password', { exact: true }).fill(syntheticPassword)
    await member.route('**/rest/v1/rpc/complete_invitation', route => route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ message: 'Synthetic invitation save failure' }) }))
    await member.getByRole('button', { name: 'Join team', exact: true }).click()
    await expect(member.getByRole('alert')).toHaveText('Synthetic invitation save failure')
    await expect(member.getByLabel('Your name', { exact: true })).toHaveValue(memberName)
    await expect(member.getByLabel('New password', { exact: true })).toHaveValue(syntheticPassword)
    await member.unroute('**/rest/v1/rpc/complete_invitation')
    await member.getByRole('button', { name: 'Join team', exact: true }).click()
    await expect(member.getByRole('button', { name: 'Roster', exact: true })).toBeVisible()
    await expect(member.getByRole('button', { name: 'Manage', exact: true })).toHaveCount(0)
    await expect(member.getByRole('button', { name: '+ Event', exact: true })).toHaveCount(0)
    await page.keyboard.press('Escape')
    const card = member.getByRole('button', { name: `View ${title}`, exact: true })
    await card.getByRole('button', { name: /^Can.t \(/ }).click()
    await expect(card.getByRole('button', { name: /^Can.t \(1\)/ })).toBeVisible()
    await expect(member.getByText('Got an excuse?')).toHaveCount(0)
    const adminCard = page.getByRole('button', { name: `View ${title}`, exact: true })
    await expect(adminCard.getByRole('button', { name: /^Can.t \(1\)/ })).toBeVisible()
    if (localTls) {
      await expect.poll(() => socketsByPage.get(page).some(url => url.startsWith('wss://') && url.includes('/realtime/v1/'))).toBeTruthy()
      await expect.poll(() => memberSockets.some(url => url.startsWith('wss://') && url.includes('/realtime/v1/'))).toBeTruthy()
      expect([...socketsByPage.get(page), ...memberSockets].filter(url => url.includes('/realtime/v1/')).every(url => url.startsWith('wss://'))).toBeTruthy()
    }
    await member.getByRole('button', { name: 'Edit profile' }).click()
    await member.getByLabel('Position (optional)').fill('Utility')
    await member.getByLabel('Phone (optional)').fill('+15550100101')
    await member.getByRole('button', { name: 'Save changes' }).click()
    await member.getByRole('button', { name: 'Roster', exact: true }).click()
    await expect(member.getByRole('button').filter({ hasText: memberName }).getByText('Utility')).toBeVisible()
    const manageAgain = await manage(page)
    const memberRow = manageAgain.locator('section').filter({ has: page.getByRole('heading', { name: 'Members', exact: true }) }).locator('div.py-3').filter({ hasText: memberName })
    await memberRow.getByRole('button', { name: 'Password recovery link' }).click()
    const recoveryLink = await manageAgain.getByLabel('Private, expiring link').inputValue()
    const recoveryContext = await browser.newContext(contextOptions)
    const recoveryPage = await recoveryContext.newPage()
    try {
      await recoveryPage.goto(recoveryLink)
      await recoveryPage.getByRole('button', { name: 'Continue with this link' }).click()
      await recoveryPage.getByLabel('New password', { exact: true }).fill(`${syntheticPassword}-new`)
      await recoveryPage.getByRole('button', { name: 'Save password', exact: true }).click()
      await expect(recoveryPage.getByRole('button', { name: 'Roster', exact: true })).toBeVisible()
    } finally { await recoveryContext.close() }
  } finally { await memberContext.close() }
})

test('soccer 0–0 result and draft/published lineups work for a player', async ({ page, browser }) => {
  const settings = await manage(page)
  await settings.getByLabel('Sport tools').selectOption('soccer')
  await settings.getByRole('button', { name: 'Save settings', exact: true }).click()
  await expect(settings.getByText('Team settings saved.')).toBeVisible()
  await page.keyboard.press('Escape')
  const suffix = unique()
  const title = `Soccer match ${suffix}`
  await createEvent(page, title, 'game')
  await page.getByRole('heading', { name: title, exact: true }).click()
  await page.getByRole('button', { name: 'Add Result', exact: true }).click()
  const result = page.getByRole('dialog', { name: 'Game result' })
  await result.getByLabel('Team score').fill('0')
  await result.getByLabel('Opponent score').fill('0')
  await result.getByRole('button', { name: 'Save Result', exact: true }).click()
  await expect(page.getByRole('dialog', { name: 'Event details' }).getByText('0 - 0')).toBeVisible()
  await page.getByRole('button', { name: 'Create Lineup', exact: true }).click()
  await page.getByRole('dialog', { name: 'Soccer lineup' }).getByRole('button', { name: 'Save Draft', exact: true }).click()
  await expect(page.getByRole('dialog', { name: 'Event details' })).toBeVisible()
  await page.keyboard.press('Escape')
  const inviteSettings = await manage(page)
  await inviteSettings.getByLabel('Email', { exact: true }).fill(`lineup-${suffix}@example.test`)
  await inviteSettings.getByRole('button', { name: 'Create invitation link', exact: true }).click()
  const inviteLink = await inviteSettings.getByLabel('Private, expiring link').inputValue()
  await page.keyboard.press('Escape')
  const memberContext = await browser.newContext(contextOptions)
  const member = await memberContext.newPage()
  try {
    await member.goto(inviteLink)
    await member.getByRole('button', { name: 'Continue with this link' }).click()
    await member.getByLabel('Your name', { exact: true }).fill(`Lineup Player ${suffix}`)
    await member.getByLabel('New password', { exact: true }).fill(syntheticPassword)
    await member.getByRole('button', { name: 'Join team', exact: true }).click()
    await member.getByRole('heading', { name: title, exact: true }).click()
    const memberEvent = member.getByRole('dialog', { name: 'Event details' })
    await expect(memberEvent.getByRole('button', { name: 'View Lineup', exact: true })).toHaveCount(0)
    await page.getByRole('heading', { name: title, exact: true }).click()
    await page.getByRole('button', { name: /Edit Lineup/ }).click()
    await page.getByRole('dialog', { name: 'Soccer lineup' }).getByRole('button', { name: 'Publish Lineup', exact: true }).click()
    await expect(memberEvent.getByRole('button', { name: 'View Lineup', exact: true })).toBeVisible()
    await memberEvent.getByRole('button', { name: 'View Lineup', exact: true }).click()
    const memberLineup = member.getByRole('dialog', { name: 'Soccer lineup' })
    await expect(memberLineup.getByText('4-4-2').first()).toBeVisible()
    await expect(memberLineup.getByRole('button', { name: 'Publish Lineup', exact: true })).toHaveCount(0)
  } finally { await memberContext.close() }
})

test('mobile team header, long names, settings, and form keyboard controls fit', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  const settings = await manage(page)
  await settings.getByLabel('Team name', { exact: true }).fill('Northside Community Sports and Recreation Club')
  await settings.getByRole('button', { name: 'Save settings', exact: true }).click()
  await expect(settings.getByText('Team settings saved.')).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBeTruthy()
  await page.keyboard.press('Escape')
  await expect(settings).toBeHidden()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBeTruthy()
  await page.screenshot({ path: '.context/live-team-mobile.png', fullPage: true })
  await page.getByRole('button', { name: '+ Event', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'New event' })
  await dialog.getByRole('button', { name: 'Close event form' }).focus()
  await page.keyboard.press('Shift+Tab')
  await expect(dialog.getByRole('button', { name: 'Create Event', exact: true })).toBeFocused()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBeTruthy()
  await page.keyboard.press('Escape')
  await expect(dialog).toBeHidden()
  await expect(page.getByRole('button', { name: '+ Event', exact: true })).toBeFocused()
})
