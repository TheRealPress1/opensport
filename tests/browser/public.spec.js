import { test, expect } from '@playwright/test'
import { mkdir } from 'node:fs/promises'
import { unzipSync, strFromU8 } from 'fflate'
import { createHash } from 'node:crypto'

const headline = 'Behind every great athlete is a team.'
const athleteNames = ['Lionel Messi', 'Caitlin Clark', 'Shohei Ohtani', 'Tom Brady', 'LeBron James']
const athleteImages = page => page.locator('img[data-athlete], [data-athlete] img')

function watchPublicRequests(page) {
  const backend = []
  page.on('request', request => {
    if (/demo-must-never-connect|supabase|\/auth\/v1|\/rest\/v1|\/storage\/v1|\/realtime\/v1/.test(request.url())) backend.push(request.url())
  })
  return backend
}

async function expectNoOverflow(page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBeTruthy()
}

test('public site and source download work without a team account', async ({ page, request, baseURL }) => {
  const backend = watchPublicRequests(page)
  const errors = []
  const externalAssets = []
  page.on('request', request => {
    if (['image', 'font'].includes(request.resourceType()) && new URL(request.url()).origin !== new URL(baseURL).origin) externalAssets.push(request.url())
  })
  page.on('pageerror', error => errors.push(error.message))
  await page.goto('/')
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(headline)
  await expect(page.getByText('The free, open-source alternative to TeamSnap.', { exact: true })).toBeVisible()
  await expect(page.locator('a[href="#compare"]')).toHaveCount(1)
  const comparison = page.getByRole('table', { name: 'How OpenSport compares with TeamSnap' })
  await expect(comparison.getByRole('row')).toHaveCount(7)
  await expect(comparison.getByRole('columnheader', { name: /^OpenSport/ })).toBeVisible()
  const storyPhoto = page.getByRole('img', { name: /boys soccer trophy/ })
  await storyPhoto.scrollIntoViewIfNeeded()
  await expect.poll(() => storyPhoto.evaluate(image => image.complete && image.naturalWidth > 0)).toBeTruthy()
  const slideshow = page.getByRole('region', { name: 'Photos from my years playing soccer' })
  await expect(slideshow.getByText('01 / 05')).toBeVisible()
  await slideshow.getByRole('button', { name: 'Next photo' }).click()
  await expect(slideshow.getByText('02 / 05')).toBeVisible()
  await expect(slideshow.getByRole('img', { name: /youth team/ })).toBeVisible()
  await slideshow.getByRole('button', { name: 'Previous photo' }).click()
  await slideshow.getByRole('button', { name: 'Previous photo' }).click()
  await expect(slideshow.getByText('05 / 05')).toBeVisible()
  await expect(page.getByRole('img', { name: 'Gaspard Seuge' })).toBeVisible()
  await expect(page.getByRole('link', { name: 'View OpenSport on GitHub' })).toHaveAttribute('href', 'https://github.com/TheRealPress1/opensport')
  await expect(page.getByRole('link', { name: 'Try the demo', exact: true }).first()).toHaveAttribute('href', '/#/demo')
  await expect(page.getByRole('link', { name: 'Download', exact: true }).first()).toHaveAttribute('href', '/downloads/opensport-0.1.0-source.zip')
  await expect(athleteImages(page)).toHaveCount(athleteNames.length)
  for (const image of await athleteImages(page).all()) {
    await expect(image).toBeVisible()
    await expect.poll(() => image.evaluate(element => element.complete && element.naturalWidth > 0 && element.naturalHeight > 0)).toBeTruthy()
    expect(await image.evaluate(element => new URL(element.currentSrc).origin === location.origin)).toBeTruthy()
  }
  await expectNoOverflow(page)
  const contribution = await request.get(await page.getByRole('link', { name: 'Contribution guide', exact: true }).getAttribute('href'))
  expect(contribution.ok()).toBeTruthy()
  expect(await contribution.text()).toContain('OpenSport')
  const download = await request.get('/downloads/opensport-0.1.0-source.zip')
  expect(download.ok()).toBeTruthy()
  const archive = unzipSync(await download.body())
  const prefix = 'opensport-0.1.0/'
  for (const file of ['README.md', 'LICENSE', 'package-lock.json', 'Dockerfile', 'scripts/ops.sh', 'docs/SELF_HOSTING.md', 'supabase/migrations/20261012000100_single_team.sql', 'public/fonts/BarlowCondensed-Bold.ttf', 'public/fonts/BarlowCondensed-ExtraBold.ttf', 'public/fonts/OFL-BarlowCondensed.txt', 'public/images/demo-workspace.png', 'src/lib/athleteCredits.json', 'public/athletes/licenses/CC-BY-2.0.txt', 'public/athletes/licenses/CC-BY-SA-2.0.txt', 'public/athletes/licenses/CC-BY-SA-3.0.txt']) expect(archive[`${prefix}${file}`]).toBeTruthy()
  expect(Object.keys(archive).some(name => /(?:^|\/)\.(?:context|opensport|git)\//.test(name) || name.endsWith('/.env') || name.includes('.env.local'))).toBeFalsy()
  for (const line of strFromU8(archive[`${prefix}SOURCE_MANIFEST.sha256`]).trim().split('\n')) {
    const [expected, file] = line.split('  ')
    expect(createHash('sha256').update(archive[`${prefix}${file}`]).digest('hex')).toBe(expected)
  }
  const credits = page.locator('summary').filter({ hasText: /^Photo credits/ })
  await credits.focus()
  await page.keyboard.press('Enter')
  await expect(credits.locator('..')).toHaveAttribute('open', '')
  for (const athlete of athleteNames) {
    await expect(credits.locator('..')).toContainText(athlete)
  }
  const creditDownload = await request.get(await page.getByRole('link', { name: 'asset credits', exact: true }).first().getAttribute('href'))
  expect(creditDownload.ok()).toBeTruthy()
  const photoCredits = await creditDownload.json()
  expect(photoCredits).toEqual(JSON.parse(strFromU8(archive[`${prefix}src/lib/athleteCredits.json`])))
  expect(photoCredits.athletes.map(athlete => athlete.name)).toEqual(athleteNames)
  const imagePaths = new Set()
  const photoLicenses = new Set()
  for (const athlete of photoCredits.athletes) {
    expect(new URL(athlete.sourceUrl).protocol).toBe('https:')
    expect(new URL(athlete.heightSource).protocol).toBe('https:')
    expect(new URL(athlete.licenseUrl).hostname).toBe('creativecommons.org')
    expect(athlete.photographer.trim().length).toBeGreaterThan(0)
    expect(athlete.sourceDimensions.width).toBeGreaterThan(0)
    expect(athlete.sourceDimensions.height).toBeGreaterThan(0)
    expect(athlete.modifications).toMatch(/background|extract|remov/i)
    expect(athlete.modifications).not.toMatch(/pending|blocked|not yet/i)
    expect(athlete.processing.method.trim().length).toBeGreaterThan(0)
    expect(athlete.processing.method).not.toMatch(/pending|blocked/i)
    photoLicenses.add(athlete.licenseFile)
    for (const [src, width, height] of [[athlete.image, athlete.width, athlete.height], [athlete.smallImage, athlete.smallWidth, athlete.smallHeight]]) {
      expect(new URL(src, baseURL).origin).toBe(new URL(baseURL).origin)
      const archivedImage = archive[`${prefix}public${src}`]
      expect(archivedImage).toBeTruthy()
      imagePaths.add(src)
      const asset = await request.get(src)
      expect(asset.ok()).toBeTruthy()
      expect(Buffer.compare(await asset.body(), Buffer.from(archivedImage))).toBe(0)
      const dimensions = await page.evaluate(async source => {
        const image = new Image()
        image.src = source
        await image.decode()
        return { width: image.naturalWidth, height: image.naturalHeight }
      }, src)
      expect(dimensions).toEqual({ width, height })
    }
  }
  expect(imagePaths.size).toBe(athleteNames.length * 2)
  for (const src of photoLicenses) {
    const license = await request.get(src)
    expect(license.ok()).toBeTruthy()
    expect(Buffer.compare(await license.body(), Buffer.from(archive[`${prefix}public${src}`]))).toBe(0)
  }
  await page.getByRole('link', { name: 'Setup guide', exact: true }).first().click()
  await expect(page.getByRole('heading', { name: 'Give your team a home.' })).toBeVisible()
  const guide = await request.get(await page.getByRole('link', { name: 'Download the complete hosting guide' }).getAttribute('href'))
  expect(guide.ok()).toBeTruthy()
  expect(await guide.text()).toContain('Backup and restore')
  await expectNoOverflow(page)
  expect(backend).toEqual([])
  expect(externalAssets).toEqual([])
  expect(errors).toEqual([])
  await page.goto('/')
  await mkdir('.context', { recursive: true })
  await page.screenshot({ path: `.context/opensport-${test.info().project.name}.png` })
})

test('landing stays usable by keyboard and on narrow screens when photographs fail', async ({ page }) => {
  const backend = watchPublicRequests(page)
  await page.route(/\.(?:png|webp|avif|jpe?g)(?:\?|$)/i, route => route.abort())
  await page.goto('/')
  const demo = page.getByRole('link', { name: 'Try the demo', exact: true }).first()
  for (let index = 0; index < 20; index += 1) {
    await page.keyboard.press('Tab')
    if (await demo.evaluate(element => element === document.activeElement)) break
  }
  await expect(demo).toBeFocused()
  expect(await demo.evaluate(element => {
    const style = getComputedStyle(element)
    return (style.outlineStyle !== 'none' && parseFloat(style.outlineWidth) > 0) || style.boxShadow !== 'none'
  })).toBeTruthy()
  for (const width of [320, 768, 1440]) {
    await page.setViewportSize({ width, height: 900 })
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(headline)
    await expect(demo).toBeVisible()
    for (const action of [demo, page.getByRole('link', { name: 'Download', exact: true }).first()]) {
      const box = await action.boundingBox()
      expect(box.width).toBeGreaterThanOrEqual(44)
      expect(box.height).toBeGreaterThanOrEqual(44)
    }
    await expectNoOverflow(page)
  }
  await demo.press('Enter')
  await expect(page.getByRole('heading', { name: 'Union Sports Club' })).toBeVisible()
  expect(backend).toEqual([])
})

test('demo uses real views, editable RSVPs, and zero backend requests', async ({ page }) => {
  const backend = watchPublicRequests(page)
  const errors = []
  page.on('pageerror', error => errors.push(error.message))
  await page.goto('/#/demo')
  await expect(page.getByRole('heading', { name: 'Union Sports Club' })).toBeVisible()
  await expect(page.getByText('Demo · fictional data · changes reset on refresh')).toBeVisible()
  const maybe = page.getByRole('button', { name: /^Maybe \(1\)/ }).first()
  await maybe.click()
  await expect(page.getByRole('button', { name: /^Maybe \(2\)/ }).first()).toBeVisible()
  await page.getByRole('button', { name: /^Can.t \(1\)/ }).first().click()
  await expect(page.getByRole('button', { name: /^Can.t \(2\)/ }).first()).toBeVisible()
  await page.getByRole('button', { name: 'Roster', exact: true }).click()
  await expect(page.getByText('Alex Rivera').first()).toBeVisible()
  await page.getByRole('button', { name: 'Stats', exact: true }).click()
  await expect(page.getByText('Top Scorers')).toBeVisible()
  await page.getByRole('button', { name: 'Schedule', exact: true }).click()
  await page.getByRole('heading', { name: 'vs Riverside FC' }).click()
  await page.getByRole('button', { name: /lineup/i }).click()
  await expect(page.getByText('4-3-3').first()).toBeVisible()
  await page.keyboard.press('Escape')
  await page.reload()
  await expect(page.getByRole('button', { name: /^Maybe \(1\)/ }).first()).toBeVisible()
  await page.getByLabel('Demo sport mode').selectOption('general')
  await page.getByRole('button', { name: 'Stats', exact: true }).click()
  await expect(page.getByText('Score for', { exact: true })).toBeVisible()
  await expect(page.getByText('Top Scorers')).toHaveCount(0)
  await expect(page.getByText('Goals for', { exact: true })).toHaveCount(0)
  await page.getByRole('button', { name: 'Schedule', exact: true }).click()
  await page.getByRole('heading', { name: 'vs Riverside FC' }).click()
  await expect(page.getByRole('button', { name: /lineup/i })).toHaveCount(0)
  expect(backend).toEqual([])
  expect(errors).toEqual([])
})
