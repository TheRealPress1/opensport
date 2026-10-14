import { test, expect } from '@playwright/test'

// Extra opt-in: use only synthetic credentials on a disposable loopback host.
// This never starts/stops a backend or changes another test's team settings.
const enabled = process.env.OPENSPORT_TEST_RECONNECT === '1'
const email = process.env.OPENSPORT_TEST_ADMIN_EMAIL
const password = process.env.OPENSPORT_TEST_ADMIN_PASSWORD
const baseURL = process.env.OPENSPORT_TEST_URL || 'http://localhost:18880'
test.skip(!enabled || !email || !password, 'Set OPENSPORT_TEST_RECONNECT=1 with disposable local admin credentials.')

async function signIn(page) {
  await page.goto(baseURL)
  await page.getByLabel('Email', { exact: true }).fill(email)
  await page.getByLabel('Password', { exact: true }).fill(password)
  await page.getByRole('button', { name: 'Sign in', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Manage', exact: true })).toBeVisible()
}

test('an offline browser catches up saved event and RSVP changes without reloading', async ({ page, browser }, testInfo) => {
  expect(['localhost', '127.0.0.1']).toContain(new URL(baseURL).hostname)
  test.setTimeout(60000)
  const title = `Reconnect practice ${Date.now()}`
  const revisedTitle = `${title} updated`
  const date = new Date()
  date.setUTCDate(date.getUTCDate() + 3)
  const secondContext = await browser.newContext({ ignoreHTTPSErrors: process.env.OPENSPORT_TEST_TLS === '1' })
  let disconnected = false
  const socketRoutes = []
  // Chromium's offline emulation does not close an already-open WebSocket.
  // Forward real traffic normally, and explicitly cut both sides during the
  // outage so this reproduces a lost connection instead of a false offline UI.
  await secondContext.routeWebSocket('**/realtime/v1/**', async route => {
    if (disconnected) return route.close({ code: 1011, reason: 'Synthetic connection loss' })
    socketRoutes.push({ client: route, server: route.connectToServer() })
  })
  const second = await secondContext.newPage()
  const sockets = []
  second.on('websocket', socket => { if (socket.url().includes('/realtime/v1/')) sockets.push(socket) })
  let created = false
  let currentTitle = title
  let primaryFailure
  try {
    await signIn(page)
    await page.getByRole('button', { name: '+ Event', exact: true }).click()
    const form = page.getByRole('dialog', { name: 'New event' })
    await form.getByRole('radio', { name: 'Practice' }).locator('..').click()
    await form.getByLabel('Title *', { exact: true }).fill(title)
    await form.getByLabel('Date *', { exact: true }).fill(date.toISOString().slice(0, 10))
    await form.getByRole('button', { name: 'Create Event', exact: true }).click()
    await expect(form).toBeHidden()
    created = true
    const originalCard = page.getByRole('button', { name: `View ${title}`, exact: true })
    await originalCard.getByRole('button', { name: /^Maybe \(/ }).click()
    await expect(originalCard.getByRole('button', { name: /^Maybe \(1\)/ })).toBeVisible()

    // Signing in last keeps the complete disconnect/reconnect assertion well
    // inside the app's 60-second fallback poll. Both contexts use the same
    // synthetic account so its own persisted RSVP must reconcile too.
    const sessionStarted = Date.now()
    await signIn(second)
    const secondOriginal = second.getByRole('button', { name: `View ${title}`, exact: true })
    await expect(secondOriginal.getByRole('button', { name: /^Maybe \(1\)/ })).toBeVisible()
    await expect.poll(() => sockets.length).toBeGreaterThan(0)
    disconnected = true
    await secondContext.setOffline(true)
    for (const route of socketRoutes) {
      await route.server.close({ code: 1011, reason: 'Synthetic connection loss' })
      await route.client.close({ code: 1011, reason: 'Synthetic connection loss' })
    }
    await expect.poll(() => second.evaluate(() => navigator.onLine)).toBe(false)
    await expect.poll(() => sockets.every(socket => socket.isClosed()), { timeout: 5000, message: 'The offline session must actually lose its Realtime socket.' }).toBe(true)

    await originalCard.getByRole('button', { name: /^Going \(/ }).click()
    await expect(originalCard.getByRole('button', { name: /^Going \(1\)/ })).toBeVisible()
    await originalCard.getByRole('heading', { name: title, exact: true }).click()
    const details = page.getByRole('dialog', { name: 'Event details' })
    await details.getByRole('button', { name: 'Edit event', exact: true }).click()
    await details.getByLabel('Title', { exact: true }).fill(revisedTitle)
    await details.getByRole('button', { name: 'Save Changes', exact: true }).click()
    await expect(details.getByRole('heading', { name: revisedTitle, exact: true })).toBeVisible()
    currentTitle = revisedTitle
    await details.getByRole('button', { name: 'Close event details' }).click()
    // Prove the offline browser missed these writes before reconnecting.
    await expect(secondOriginal.getByRole('button', { name: /^Maybe \(1\)/ })).toBeVisible()
    await expect(second.getByRole('heading', { name: revisedTitle, exact: true })).toHaveCount(0)

    const reconnectedAt = Date.now()
    disconnected = false
    await secondContext.setOffline(false)
    await expect.poll(() => second.evaluate(() => navigator.onLine)).toBe(true)
    const updated = second.getByRole('button', { name: `View ${revisedTitle}`, exact: true })
    await expect(updated, 'Missed event changes must catch up after reconnection without waiting for the 60-second poll.').toBeVisible({ timeout: 15000 })
    await expect(updated.getByRole('button', { name: /^Going \(1\)/ })).toBeVisible()
    expect(Date.now() - sessionStarted, 'Fallback polling must not mask a broken reconnect.').toBeLessThan(50000)
    await testInfo.attach('reconnection-timing', { body: JSON.stringify({ catchUpMs: Date.now() - reconnectedAt, socketConnections: sockets.length }), contentType: 'application/json' })

    // Catch-up alone is insufficient: subsequent changes must stream in both
    // directions too, including a new update received by the recovered browser.
    await expect.poll(() => sockets.some(socket => !socket.isClosed())).toBe(true)
    const organizerUpdated = page.getByRole('button', { name: `View ${revisedTitle}`, exact: true })
    await organizerUpdated.getByRole('button', { name: /^Maybe \(/ }).click()
    await expect(updated.getByRole('button', { name: /^Maybe \(1\)/ })).toBeVisible()
    await updated.getByRole('button', { name: /^Can.t \(/ }).click()
    await expect(updated.getByRole('button', { name: /^Can.t \(1\)/ })).toBeVisible()
    await expect(organizerUpdated.getByRole('button', { name: /^Can.t \(1\)/ })).toBeVisible()
  } catch (cause) {
    primaryFailure = cause
    await testInfo.attach('reconnection-transport', { body: JSON.stringify({
      online: await second.evaluate(() => navigator.onLine),
      socketConnections: sockets.length,
      closedSockets: sockets.filter(socket => socket.isClosed()).length,
    }), contentType: 'application/json' })
  } finally {
    await secondContext.close()
    if (created && !page.isClosed()) {
      try {
        await page.keyboard.press('Escape')
        await page.getByRole('heading', { name: currentTitle, exact: true }).click()
        const details = page.getByRole('dialog', { name: 'Event details' })
        await details.getByRole('button', { name: 'Edit event', exact: true }).click()
        page.once('dialog', dialog => dialog.accept())
        await details.getByRole('button', { name: 'Delete', exact: true }).click()
        await expect(page.getByRole('heading', { name: currentTitle, exact: true })).toHaveCount(0)
      } catch (cleanupError) {
        primaryFailure ||= cleanupError
        await testInfo.attach('fixture-cleanup-failure', { body: cleanupError.message, contentType: 'text/plain' })
      }
    }
  }
  if (primaryFailure) throw primaryFailure
})

test('a recovered read clears its error while a failed event edit remains available to retry', async ({ page, context }) => {
  expect(['localhost', '127.0.0.1']).toContain(new URL(baseURL).hostname)
  await signIn(page)
  const endpoint = '**/rest/v1/soccer_events*'
  let failRead = true
  let failWrite = false
  await page.route(endpoint, route => {
    const method = route.request().method()
    if ((failRead && method === 'GET') || (failWrite && method === 'POST')) {
      return route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ message: method === 'GET' ? 'Synthetic temporary read failure' : 'Synthetic unsaved event' }) })
    }
    return route.continue()
  })
  const reconnect = async () => { await context.setOffline(true); await context.setOffline(false) }
  try {
    await reconnect()
    await expect(page.getByRole('alert')).toContainText('Synthetic temporary read failure')
    // The last known workspace stays usable during a transient read failure.
    await expect(page.getByRole('button', { name: 'Manage', exact: true })).toBeVisible()
    failRead = false
    await reconnect()
    await expect(page.getByRole('alert')).toHaveCount(0)

    failWrite = true
    const unsavedTitle = `Unsaved reconnect practice ${Date.now()}`
    await page.getByRole('button', { name: '+ Event', exact: true }).click()
    const form = page.getByRole('dialog', { name: 'New event' })
    await form.getByRole('radio', { name: 'Practice' }).locator('..').click()
    await form.getByLabel('Title *', { exact: true }).fill(unsavedTitle)
    await form.getByLabel('Date *', { exact: true }).fill('2099-12-29')
    await form.getByRole('button', { name: 'Create Event', exact: true }).click()
    await expect(form.getByRole('alert')).toHaveText('Synthetic unsaved event')
    const refreshed = page.waitForResponse(response => response.url().includes('/rest/v1/team_invitations?') && response.status() === 200)
    await reconnect()
    await refreshed
    await expect(form.getByRole('alert')).toHaveText('Synthetic unsaved event')
    await expect(form.getByLabel('Title *', { exact: true })).toHaveValue(unsavedTitle)
    await expect(page.getByRole('heading', { name: unsavedTitle, exact: true })).toHaveCount(0)
  } finally {
    await page.unroute(endpoint)
  }
})
