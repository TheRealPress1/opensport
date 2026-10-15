import { test, expect } from '@playwright/test'

// The guided "Start your team" page and the page Vercel returns coaches to.
async function watch(page) {
  const problems = []
  page.on('pageerror', error => problems.push(error.message))
  page.on('request', request => { if (/supabase|\/auth\/v1|\/rest\/v1/.test(request.url())) problems.push(request.url()) })
  return problems
}

test('the guide walks a new coach through every screen and opens Vercel with a way back', async ({ page }) => {
  const problems = await watch(page)
  await page.goto('/#/start')
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Your team, live in a few clicks.')
  const stack = page.getByRole('list', { name: 'The three free services that run your team' })
  for (const name of ['GitHub', 'Vercel', 'Supabase']) await expect(stack.getByText(name, { exact: true })).toBeVisible()
  await expect(stack.locator('svg.os-logo')).toHaveCount(3)
  const steps = page.locator('.os-start-step h3')
  await expect(steps).toHaveText(['Continue with GitHub', 'Create your GitHub account', 'Name your team', 'Add the free database', 'Pick a setup code', 'Wait a few minutes'])
  await expect(page.getByText('Create an account').first()).toBeVisible()
  for (const start of await page.getByRole('link', { name: 'Start my team' }).all()) {
    await expect(start).toHaveAttribute('target', '_blank')
    const deploy = new URL(await start.getAttribute('href'))
    expect(deploy.origin + deploy.pathname).toBe('https://vercel.com/new/clone')
    expect(deploy.searchParams.get('repository-url')).toBe('https://github.com/TheRealPress1/opensport')
    expect(deploy.searchParams.get('env')).toBe('OPENSPORT_SETUP_CODE')
    expect(deploy.searchParams.get('redirect-url')).toBe('https://getopensport.vercel.app/')
    expect(JSON.parse(deploy.searchParams.get('stores'))).toEqual([{ type: 'integration', integrationSlug: 'supabase', productSlug: 'supabase' }])
  }
  const header = page.getByRole('navigation', { name: 'Main navigation' })
  await expect(header.getByRole('link', { name: '← Home' })).toHaveAttribute('href', '/')
  await expect(page.getByRole('link', { name: 'OpenSport home' })).toHaveAttribute('href', '/')
  if (await header.getByRole('button', { name: 'Help' }).isVisible()) {
    await expect(header.getByRole('link', { name: 'Try the demo' })).toHaveAttribute('href', '/#/demo')
    await header.getByRole('button', { name: 'Help' }).click()
    await expect(page.getByRole('heading', { name: 'If something looks different.' })).toBeInViewport()
    await expect(page).toHaveURL(/#\/start$/)
  }
  await page.getByText('Supabase’s Free plan is greyed out').click()
  await expect(page.getByText('two active free projects')).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBeTruthy()
  expect(problems).toEqual([])
})

test('coming back from Vercel shows the new team’s address and next steps', async ({ page }) => {
  const problems = await watch(page)
  await page.goto('/?project-name=riverside-fc&deployment-url=riverside-fc.vercel.app&project-dashboard-url=' + encodeURIComponent('https://vercel.com/riverside/riverside-fc'))
  await expect(page.getByRole('heading', { name: 'Your team’s site is live.' })).toBeVisible()
  await expect(page.getByText('riverside-fc.vercel.app', { exact: true })).toBeVisible()
  await expect(page.getByRole('link', { name: 'Open my team' })).toHaveAttribute('href', 'https://riverside-fc.vercel.app')
  await expect(page.getByRole('link', { name: 'your Vercel dashboard ↗' })).toHaveAttribute('href', 'https://vercel.com/riverside/riverside-fc')
  await expect(page.locator('.os-start-step')).toHaveCount(0)
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBeTruthy()
  expect(problems).toEqual([])
})

test('a return without a usable vercel.app address points to the Vercel dashboard instead', async ({ page }) => {
  await page.goto('/?deployment-url=' + encodeURIComponent('https://riverside-fc.vercel.app.attacker.test'))
  await expect(page.getByRole('heading', { name: 'Your team’s site is live.' })).toBeVisible()
  await expect(page.getByRole('link', { name: 'Open my team' })).toHaveCount(0)
  await expect(page.getByRole('link', { name: 'Open my Vercel dashboard' })).toHaveAttribute('href', 'https://vercel.com/dashboard')
  await page.goto('/?project-name=riverside-fc&project-dashboard-url=' + encodeURIComponent('https://vercel.com/riverside/riverside-fc'))
  await expect(page.getByRole('link', { name: 'Open my Vercel dashboard' })).toHaveAttribute('href', 'https://vercel.com/riverside/riverside-fc')
})
