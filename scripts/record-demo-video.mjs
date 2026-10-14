// Records the product walkthrough from the public demo.
// Usage: start the project site (npm run dev), then
//   node scripts/record-demo-video.mjs [base-url]
// Requires ffmpeg with libx264 and libvpx-vp9 on PATH. Writes:
//   public/videos/opensport-walkthrough.mp4    shareable cut with intro and outro cards
//   public/videos/opensport-demo.mp4/.webm     landing-page loop without the cards
//   public/images/demo-walkthrough-poster.jpg  first frame of the loop (kept in the source download)
import { chromium } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

const base = (process.argv[2] || 'http://127.0.0.1:5173').replace(/\/$/, '')
const output = path.resolve('public/videos')
const work = await mkdtemp(path.join(tmpdir(), 'opensport-video-'))

const studioCss = `
#studio-cursor { position: fixed; left: 0; top: 0; width: 26px; height: 26px; z-index: 2147483001; pointer-events: none; filter: drop-shadow(0 2px 3px #0005); transform: translate(-100px, -100px); }
.studio-ripple { position: fixed; z-index: 2147483000; width: 46px; height: 46px; margin: -23px 0 0 -23px; border-radius: 50%; border: 3px solid #1f7a45; pointer-events: none; animation: studio-ripple .5s ease-out forwards; }
@keyframes studio-ripple { from { transform: scale(.3); opacity: .9; } to { transform: scale(1.4); opacity: 0; } }
#studio-caption { position: fixed; left: 36px; bottom: 44px; width: 248px; padding: 18px 20px 20px; border-radius: 10px; background: #f7f5ed; box-shadow: 0 18px 40px -18px #19392e99, 0 0 0 1px #19392e14; z-index: 2147482999; pointer-events: none; opacity: 0; transform: translateY(12px); transition: opacity .35s, transform .35s; color: #19392e; }
#studio-caption.on { opacity: 1; transform: none; }
#studio-caption small { display: block; margin-bottom: 10px; font: 700 11px/1 Inter, system-ui, sans-serif; letter-spacing: .16em; color: #b94b2e; }
#studio-caption strong { display: block; font: 800 40px/.92 'OpenSport Display', Impact, sans-serif; letter-spacing: -.02em; }
#studio-card { position: fixed; inset: 0; z-index: 2147483002; display: grid; place-content: center; text-align: center; background: #f7f5ed; color: #19392e; opacity: 0; transition: opacity .5s; pointer-events: none; }
#studio-card.on { opacity: 1; }
#studio-card small { font: 700 12px/1 Inter, system-ui, sans-serif; letter-spacing: .2em; color: #b94b2e; }
#studio-card h1 { margin: 18px 0 0; font: 800 112px/.9 'OpenSport Display', Impact, sans-serif; letter-spacing: -.03em; text-transform: uppercase; color: #1f7a45; }
#studio-card p { margin: 22px 0 0; font: 600 24px/1.3 Inter, system-ui, sans-serif; letter-spacing: -.02em; }
#studio-card p b { background: linear-gradient(transparent 58%, #f7c9ae 58%); padding: 0 3px; }
`

function installStudio() {
  const cursor = document.createElement('div')
  cursor.id = 'studio-cursor'
  cursor.innerHTML = '<svg viewBox="0 0 24 24" width="26" height="26"><path d="M4 2.5 19.5 14l-6.8 1.1 3.9 6.4-2.9 1.6-3.8-6.5L4 21.2Z" fill="#fff" stroke="#19392e" stroke-width="1.6" stroke-linejoin="round"/></svg>'
  const caption = document.createElement('div')
  caption.id = 'studio-caption'
  const card = document.createElement('div')
  card.id = 'studio-card'
  document.body.append(cursor, caption, card)
  let x = 900, y = 520
  const place = () => { cursor.style.transform = `translate(${x - 4}px, ${y - 3}px)` }
  place()
  const ease = t => t < .5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2
  window.studio = {
    move: (toX, toY, ms) => new Promise(resolve => {
      const fromX = x, fromY = y, start = performance.now()
      const step = now => {
        const t = Math.min(1, (now - start) / ms)
        x = fromX + (toX - fromX) * ease(t); y = fromY + (toY - fromY) * ease(t); place()
        if (t < 1) requestAnimationFrame(step); else resolve()
      }
      requestAnimationFrame(step)
    }),
    ripple: () => { const ring = document.createElement('div'); ring.className = 'studio-ripple'; ring.style.left = `${x}px`; ring.style.top = `${y}px`; document.body.append(ring); setTimeout(() => ring.remove(), 600) },
    caption: (step, text) => { caption.classList.remove('on'); setTimeout(() => { caption.innerHTML = `<small>${step}</small><strong>${text}</strong>`; caption.classList.add('on') }, step ? 250 : 0) },
    hideCaption: () => caption.classList.remove('on'),
    card: html => { card.innerHTML = html; card.classList.add('on') },
    hideCard: () => card.classList.remove('on'),
  }
}

const browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE })
const page = await browser.newPage({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 2, reducedMotion: 'no-preference' })
await page.goto(`${base}/#/demo`, { waitUntil: 'networkidle' })
await page.getByRole('heading', { name: 'Union Sports Club' }).waitFor()
await page.evaluate(() => document.fonts.ready)
await page.addStyleTag({ content: studioCss })
await page.evaluate(installStudio)

const wait = ms => page.waitForTimeout(ms)
const studio = (method, ...args) => page.evaluate(([name, values]) => window.studio[name](...values), [method, args])
const glide = async (locator, ms = 750) => {
  const box = await locator.boundingBox()
  const [x, y] = [box.x + box.width / 2, box.y + box.height / 2]
  await studio('move', x, y, ms)
  await page.mouse.move(x, y)
}
const click = async (locator, ms) => { await glide(locator, ms); await studio('ripple'); await page.mouse.down(); await page.mouse.up() }
const marks = {}
const mark = name => { marks[name] = Date.now() / 1000 }

const cdp = await page.context().newCDPSession(page)
const frames = []
cdp.on('Page.screencastFrame', ({ data, metadata, sessionId }) => {
  frames.push({ data, time: metadata.timestamp })
  cdp.send('Page.screencastFrameAck', { sessionId }).catch(() => {})
})
await studio('card', '<small>OPENSPORT</small><h1>Your team’s home.</h1><p>The free, open-source alternative to <b>TeamSnap</b>.</p>')
await wait(600)
// Lossless 2x frames keep small UI text sharp; the videos are encoded at the same 1440p size.
await cdp.send('Page.startScreencast', { format: 'png', maxWidth: 2560, maxHeight: 1440 })
mark('start')
await wait(2300)
await studio('hideCard')
mark('loopStart')
await wait(500)

const card = page.locator('[role="button"][aria-label^="View "]').first()
await studio('caption', '01 / SCHEDULE', 'Every game and practice in one place.')
await glide(card.getByRole('heading').first(), 800)
await wait(900)
await studio('caption', '02 / RSVP', 'Answer in one tap.')
await click(card.getByRole('button', { name: /^Maybe/ }), 650)
await wait(800)
await click(card.getByRole('button', { name: /^Going/ }), 500)
await wait(700)

await studio('caption', '03 / AVAILABILITY', 'See who’s coming.')
await click(card.getByRole('heading').first(), 600)
await wait(700)
const dialog = page.locator('.max-h-\\[90vh\\]').first()
await dialog.evaluate(element => element.scrollBy({ top: 260, behavior: 'smooth' }))
await wait(1200)

await studio('caption', '04 / LINEUPS', 'Publish the lineup.')
await click(page.getByRole('button', { name: /lineup/i }).first(), 700)
await wait(2000)
await click(page.getByRole('button', { name: 'Close lineup' }), 600)
await wait(350)
await click(page.getByRole('button', { name: 'Close event details' }), 500)
await wait(350)
await page.evaluate(() => document.activeElement?.blur())

await click(page.getByRole('button', { name: 'Roster', exact: true }), 700)
await studio('caption', '05 / ROSTER', 'One shared roster.')
await wait(800)
await page.evaluate(() => window.scrollBy({ top: 240, behavior: 'smooth' }))
await wait(1200)

await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'smooth' }))
await wait(400)
await click(page.getByRole('button', { name: 'Stats', exact: true }), 700)
await studio('caption', '06 / RESULTS', 'Scores and stats, all season.')
await wait(2000)

await click(page.getByRole('button', { name: 'Schedule', exact: true }), 700)
await wait(300)
await click(page.getByRole('button', { name: 'Calendar view' }), 600)
await studio('caption', '07 / CALENDAR', 'Plan the month ahead.')
await wait(2200)
mark('loopEnd')

await studio('hideCaption')
await studio('card', '<small>FREE · OPEN SOURCE · NO ADS</small><h1>OpenSport.</h1><p>Try the demo at <b>getopensport.vercel.app</b></p>')
await wait(3200)
mark('end')
await cdp.send('Page.stopScreencast')
await browser.close()

// Screencast frames arrive only when the page repaints, so each frame lasts until the next one.
async function encode(name, from, to, codecArgs) {
  const selected = frames.filter(frame => frame.time >= from - 0.05 && frame.time <= to)
  const dir = path.join(work, name)
  await mkdir(dir)
  const list = []
  for (const [index, frame] of selected.entries()) {
    const file = path.join(dir, `${String(index).padStart(5, '0')}.png`)
    await writeFile(file, Buffer.from(frame.data, 'base64'))
    const next = selected[index + 1]?.time ?? to
    list.push(`file '${file}'`, `duration ${Math.max(0.001, next - Math.max(frame.time, from)).toFixed(4)}`)
  }
  list.push(`file '${path.join(dir, `${String(selected.length - 1).padStart(5, '0')}.png`)}'`)
  await writeFile(path.join(dir, 'frames.txt'), list.join('\n'))
  for (const [extension, args] of codecArgs) {
    execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'concat', '-safe', '0', '-i', path.join(dir, 'frames.txt'), '-vf', 'fps=30,scale=2560:1440:flags=lanczos,format=yuv420p', ...args, '-an', path.join(output, `${name}.${extension}`)])
  }
  return selected.length
}
await mkdir(output, { recursive: true })
const h264 = ['-c:v', 'libx264', '-preset', 'slow', '-crf', '18', '-tune', 'animation', '-movflags', '+faststart']
const vp9 = ['-c:v', 'libvpx-vp9', '-b:v', '0', '-crf', '30', '-tune-content', 'screen', '-deadline', 'good', '-cpu-used', '2', '-row-mt', '1']
const fullFrames = await encode('opensport-walkthrough', marks.start, marks.end, [['mp4', h264]])
const loopFrames = await encode('opensport-demo', marks.loopStart, marks.loopEnd, [['mp4', h264], ['webm', vp9]])
execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-ss', '0.3', '-i', path.join(output, 'opensport-demo.mp4'), '-frames:v', '1', '-vf', 'scale=1920:1080:flags=lanczos', '-q:v', '2', path.resolve('public/images/demo-walkthrough-poster.jpg')])
await rm(work, { recursive: true, force: true })
console.log(JSON.stringify({ fullFrames, loopFrames, seconds: { full: +(marks.end - marks.start).toFixed(1), loop: +(marks.loopEnd - marks.loopStart).toFixed(1) } }))
