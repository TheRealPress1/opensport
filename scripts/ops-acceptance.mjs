// Disposable full-stack release acceptance. Requires npm ci, Docker and Playwright Chromium.
import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync, readdirSync, rmSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { createServer } from 'node:net'
import { spawn } from 'node:child_process'
import { createClient } from '@supabase/supabase-js'

const root = resolve(import.meta.dirname, '..')
mkdirSync(join(root, '.context'), { recursive: true })
const temporary = mkdtempSync(join(root, '.context', 'acceptance-'))
const suffix = randomBytes(5).toString('hex')
const source = { project: `opensport-acceptance-${suffix}`, state: join(temporary, 'source') }
const restored = { project: `opensport-restore-${suffix}`, state: join(temporary, 'restored') }
const password = randomBytes(24).toString('hex')
const email = `owner-${suffix}@example.test`
const keep = process.env.OPENSPORT_ACCEPTANCE_KEEP === '1'
const tlsTest = process.env.OPENSPORT_ACCEPTANCE_TLS === '1'
let success = false
const generatedEnv = (installation) => {
  const env = { ...process.env }
  // An ambient shell's PUBLIC_URL or service key must never redirect this test.
  try { for (const key of Object.keys(readEnv(installation))) delete env[key] } catch { /* Fresh init has no configuration yet. */ }
  delete env.COMPOSE_PROFILES
  delete env.COMPOSE_FILE
  return { ...env, OPENSPORT_STATE_DIR: installation.state, COMPOSE_PROJECT_NAME: installation.project }
}
function run(command, args, { env = process.env, input, quiet = false, capture = false } = {}) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, { cwd: root, env, stdio: [input === undefined ? 'ignore' : 'pipe', capture ? 'pipe' : quiet ? 'ignore' : 'inherit', 'inherit'] })
    let output = ''
    if (capture) child.stdout.on('data', (chunk) => { output += chunk })
    if (input !== undefined) child.stdin.end(input)
    child.on('error', reject)
    child.on('close', (code) => code === 0 ? resolvePromise(output) : reject(new Error(`${command} ${args[0] || ''} failed (exit ${code})`)))
  })
}
const ops = (installation, ...args) => run('bash', ['scripts/ops.sh', ...args], { env: generatedEnv(installation) })
const compose = (installation, args, options = {}) => run('docker', ['compose', '--project-name', installation.project, '--env-file', join(installation.state, '.env'), '-f', 'deploy/compose.yml', ...args], { ...options, env: generatedEnv(installation) })
const readEnv = (installation) => Object.fromEntries(readFileSync(join(installation.state, '.env'), 'utf8').trim().split('\n').map((line) => [line.slice(0, line.indexOf('=')), line.slice(line.indexOf('=') + 1)]))
async function freePort() {
  const server = createServer()
  await new Promise((resolvePromise, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolvePromise) })
  const port = server.address().port
  await new Promise((resolvePromise) => server.close(resolvePromise))
  if (port >= 65535) return freePort()
  const neighbor = createServer()
  try { await new Promise((resolvePromise, reject) => { neighbor.once('error', reject); neighbor.listen(port + 1, '127.0.0.1', resolvePromise) }) }
  catch { return freePort() }
  await new Promise((resolvePromise) => neighbor.close(resolvePromise))
  return port
}
function clientFor(env) { return createClient(`${env.PUBLIC_URL}/api`, env.ANON_KEY, { auth: { persistSession: false, autoRefreshToken: false } }) }
async function signIn(client) {
  const result = await client.auth.signInWithPassword({ email, password })
  assert.equal(result.error, null, result.error?.message)
  return result.data.user
}
const requireData = (result) => { assert.equal(result.error, null, result.error?.message); return result.data }

try {
  const port = await freePort()
  console.log(`Testing fresh deployment ${source.project} on localhost:${port}.`)
  await ops(source, 'init', `http://localhost:${port}`)
  if (tlsTest) {
    const local = readEnv(source); const origin = `https://localhost:${port}`
    Object.assign(local, { PUBLIC_URL: origin, SITE_URL: origin, ADDITIONAL_REDIRECT_URLS: origin, CADDY_SITE: 'https://localhost', HTTP_PORT: String(port + 1), HTTPS_PORT: String(port), API_EXTERNAL_URL: `${origin}/api/auth/v1`, SUPABASE_PUBLIC_URL: `${origin}/api` })
    writeFileSync(join(source.state, '.env'), Object.entries(local).map(([key, value]) => `${key}=${value}`).join('\n') + '\n', { mode: 0o600 })
    // Only this disposable, loopback-only test accepts Caddy's local test CA.
    // Production deployment keeps ordinary certificate verification enabled.
    process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0'
  }
  await ops(source, 'up')
  await compose(source, ['run', '--rm', '-T', 'operator', 'bootstrap'], { input: `${email}\nRelease Test Owner\n${password}\n` })
  const env = readEnv(source)
  const client = clientFor(env)
  const user = await signIn(client)
  const member = requireData(await client.from('soccer_members').select('id').eq('user_id', user.id).single())
  const event = requireData(await client.from('soccer_events').insert({ type: 'practice', title: `Restore acceptance ${suffix}`, date: '2027-01-15', time: '18:30:00', created_by: member.id }).select().single())
  requireData(await client.from('soccer_rsvps').insert({ event_id: event.id, member_id: member.id, status: 'going' }))
  const avatarPath = `${user.id}/restore-acceptance.png`
  const avatar = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/x7sAAAAASUVORK5CYII=', 'base64')
  requireData(await client.storage.from('avatars').upload(avatarPath, avatar, { contentType: 'image/png' }))
  const anonymous = clientFor(env)
  assert.ok((await anonymous.storage.from('avatars').download(avatarPath)).error, 'Anonymous avatar reads must fail')
  const browserEnv = { ...process.env, OPENSPORT_TEST_URL: env.PUBLIC_URL, OPENSPORT_TEST_ADMIN_EMAIL: email, OPENSPORT_TEST_ADMIN_PASSWORD: password, OPENSPORT_TEST_TLS: tlsTest ? '1' : '0' }
  await run('npm', ['run', 'test:live'], { env: browserEnv })
  await run(process.execPath, ['supabase/tests/native-api.mjs'], { env: { ...browserEnv, OPENSPORT_TEST_ANON_KEY: env.ANON_KEY, OPENSPORT_TEST_SERVICE_ROLE_KEY: env.SERVICE_ROLE_KEY } })
  await client.auth.signOut()
  const recoveryOutput = await compose(source, ['run', '--rm', '-T', 'operator', 'recover'], { input: `${email}\n`, capture: true })
  const recoveryLink = recoveryOutput.split('\n').find((line) => line.startsWith(`${env.PUBLIC_URL}/?auth=recovery#`))
  assert.ok(recoveryLink, 'Host recovery command produces a private link')
  const recoveryToken = new URLSearchParams(new URL(recoveryLink).hash.slice(1)).get('token_hash')
  await ops(source, 'backup')
  const archiveName = readdirSync(join(source.state, 'backups')).find((name) => name.endsWith('.tar.gz'))
  assert.ok(archiveName, 'Backup archive was produced')
  await ops(source, 'down')
  await ops(restored, 'restore', join(source.state, 'backups', archiveName))
  await ops(restored, 'up')
  const restoredClient = clientFor(readEnv(restored))
  const restoredUser = await signIn(restoredClient)
  assert.equal(restoredUser.id, user.id, 'Auth identity/password survives restore')
  assert.equal(requireData(await restoredClient.from('soccer_events').select('title').eq('id', event.id).single()).title, event.title)
  assert.equal(requireData(await restoredClient.from('soccer_rsvps').select('status').eq('event_id', event.id).eq('member_id', member.id).single()).status, 'going')
  const signed = requireData(await restoredClient.storage.from('avatars').createSignedUrl(avatarPath, 60))
  assert.ok(signed.signedUrl.startsWith(`${env.PUBLIC_URL}/api/storage/v1/`))
  const image = await fetch(signed.signedUrl)
  assert.equal(image.status, 200)
  assert.deepEqual(Buffer.from(await image.arrayBuffer()), avatar, 'Avatar bytes survive restore')
  await restoredClient.auth.signOut()
  const recovery = await restoredClient.auth.verifyOtp({ token_hash: recoveryToken, type: 'recovery' })
  assert.equal(recovery.error, null, recovery.error?.message)
  assert.equal(recovery.data.user.id, user.id, 'Host recovery token survives backup/restore')
  const recoveredPassword = randomBytes(24).toString('hex')
  requireData(await restoredClient.auth.updateUser({ password: recoveredPassword }))
  await restoredClient.auth.signOut()
  const recoveredLogin = await restoredClient.auth.signInWithPassword({ email, password: recoveredPassword })
  assert.equal(recoveredLogin.error, null, recoveredLogin.error?.message)
  assert.equal(recoveredLogin.data.user.id, user.id)
  await restoredClient.auth.signOut()
  success = true
  console.log('PASS: fresh deployment, bootstrap, browser workflows, private avatar access, and cold restore of Auth/event/RSVP/avatar and host recovery.')
} catch (error) {
  console.error(`Release acceptance failed: ${error.message}`)
  process.exitCode = 1
} finally {
  if (keep) console.log(`Kept disposable acceptance fixtures at ${temporary}; projects ${source.project} and ${restored.project}.`)
  else {
    let cleanupFailed = false
    for (const installation of [source, restored]) {
      try { readEnv(installation) } catch { continue }
      try { await compose(installation, ['down', '--volumes', '--remove-orphans'], { quiet: true }) }
      catch { cleanupFailed = true; process.exitCode = 1; console.error(`Cleanup failed for ${installation.project}; retained configuration at ${temporary}.`) }
    }
    if (!cleanupFailed) rmSync(temporary, { recursive: true, force: true })
  }
  if (!success) console.error('Do not publish a tested release until full-stack acceptance passes.')
}
