import { test, expect } from '@playwright/test'

// A one-click cloud install's first-run screens, served in cloud mode with a
// placeholder database address. Every server answer is scripted here.
const cloudURL = 'http://127.0.0.1:4179/'
const ready = { databaseReady: true, needsSetup: true, setupCode: 'ok', ownerRecovery: false }

async function openCloud(page, status, onPost) {
  const errors = []
  page.on('pageerror', error => errors.push(error.message))
  await page.route('https://cloud-test.invalid/**', route => route.fulfill({ status: 400, json: { error: 'invalid_grant', error_description: 'Invalid login credentials' } }))
  await page.route('**/api/setup', route => route.request().method() === 'GET' ? route.fulfill({ json: status }) : route.fulfill(onPost(route.request().postDataJSON())))
  await page.goto(cloudURL)
  return errors
}

test('a new cloud install asks for its setup code, then creates the team', async ({ page }) => {
  let posted
  const errors = await openCloud(page, ready, body => { posted = body; return { json: { ok: true } } })
  await expect(page.getByRole('heading', { name: 'Create your team' })).toBeVisible()
  await page.getByLabel('Setup code').fill('riverside setup phrase')
  await page.getByLabel('Team name').fill('Riverside FC')
  await page.getByLabel('Sport tools').selectOption('soccer')
  await page.getByLabel('Your name').fill('Alex Rivera')
  await page.getByLabel('Email').fill(' alex@example.test ')
  await page.getByLabel('Password').fill('a long enough password')
  await page.getByRole('button', { name: 'Create team' }).click()
  // The scripted database refuses the sign-in that follows a successful setup.
  await expect(page.getByRole('alert')).toHaveText('Invalid login credentials')
  expect(posted).toMatchObject({ code: 'riverside setup phrase', team_name: 'Riverside FC', sport_mode: 'soccer', name: 'Alex Rivera', email: 'alex@example.test', password: 'a long enough password' })
  expect(posted.timezone).toBeTruthy()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBeTruthy()
  expect(errors).toEqual([])
})

test('setup explains a missing setup code and a database that is not ready', async ({ page }) => {
  await openCloud(page, { ...ready, setupCode: 'missing' }, () => ({ status: 500 }))
  await expect(page.getByRole('heading', { name: 'Add your setup code' })).toBeVisible()
  await expect(page.getByText('OPENSPORT_SETUP_CODE')).toBeVisible()
  await page.unroute('**/api/setup')
  await page.route('**/api/setup', route => route.fulfill({ json: { ...ready, databaseReady: false } }))
  await page.getByRole('button', { name: 'Check again' }).click()
  await expect(page.getByRole('heading', { name: 'Almost ready' })).toBeVisible()
})

test('an existing cloud team explains how its owner turns on recovery', async ({ page }) => {
  await openCloud(page, { ...ready, needsSetup: false }, () => ({ status: 500 }))
  await expect(page.getByRole('heading', { name: 'Your team, together' })).toBeVisible()
  await page.getByRole('button', { name: 'Forgot password?' }).click()
  await expect(page.getByText('Turn on owner recovery first.')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Recover access' })).toHaveCount(0)
})

test('with recovery on, the owner can recover access with the setup code', async ({ page }) => {
  let posted
  await openCloud(page, { ...ready, needsSetup: false, ownerRecovery: true }, body => { posted = body; return { status: 403, json: { error: 'That setup code is not correct' } } })
  await expect(page.getByRole('heading', { name: 'Your team, together' })).toBeVisible()
  await page.getByRole('button', { name: 'Forgot password?' }).click()
  const recovery = page.locator('form').filter({ hasText: 'Team owner? Use your setup code' })
  await recovery.getByLabel('Email').fill('alex@example.test')
  await recovery.getByLabel('Setup code').fill('a wrong guess')
  await recovery.getByRole('button', { name: 'Recover access' }).click()
  await expect(recovery.getByRole('alert')).toHaveText('That setup code is not correct')
  expect(posted).toEqual({ action: 'recover-owner', email: 'alex@example.test', code: 'a wrong guess' })
})
