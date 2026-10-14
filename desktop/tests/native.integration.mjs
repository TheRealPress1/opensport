// Explicit opt-in integration test; never uses ~/Library or an existing team.
// OPENSPORT_NATIVE_TEST_DATA_DIR must name a disposable directory in .context.
import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import { mkdir, readFile, writeFile, cp, access } from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import net from 'node:net'
import pg from 'pg'
import { createClient } from '@supabase/supabase-js'
import WebSocket from 'ws'
import { NativeRuntime } from '../native-runtime.mjs'
import { NATIVE_MANIFEST_FORMAT, NATIVE_SECURITY_PROFILE } from '../native-profile.mjs'
import { TeamService } from '../team-service.mjs'
import { createBackup, restoreBackup } from '../backup.mjs'
import { startNativeAuthenticationMonitor } from './native-auth-startup.monitor.mjs'

const dataDir = process.env.OPENSPORT_NATIVE_TEST_DATA_DIR && path.resolve(process.env.OPENSPORT_NATIVE_TEST_DATA_DIR)
if (!dataDir?.startsWith(`${path.resolve('.context')}${path.sep}`)) throw new Error('Set OPENSPORT_NATIVE_TEST_DATA_DIR to a disposable directory inside this repository’s .context folder.')
const resourcesDir = path.resolve(process.env.OPENSPORT_NATIVE_TEST_RESOURCES || 'desktop/resources')
const runtime = new NativeRuntime({ dataDir, resourcesDir, onProgress: ({ phase }) => console.log(`native phase: ${phase}`) })
await mkdir(dataDir, { recursive: true, mode: 0o700 })
if (process.env.OPENSPORT_NATIVE_TEST_SEED_CACHE) {
  const target = path.join(dataDir, 'runtime/home/cache')
  let exists = false
  try { await access(target); exists = true } catch { /* first test run */ }
  if (!exists) await cp(path.resolve(process.env.OPENSPORT_NATIVE_TEST_SEED_CACHE), target, { recursive: true, dereference: true })
}
let config
const service = new TeamService({ dataDir, getRuntimeConfig: () => config })
const publicUrl = 'http://127.0.0.1:18991'
let installationSecrets
const securityEvidence = []
async function authenticatedStart(server, directory, { requireTemporary = false, stage }) {
  const monitor = await startNativeAuthenticationMonitor({ dataDir: directory, requireTemporary })
  try {
    const started = await server.start({ publicUrl })
    const readyAt = performance.now()
    // Test readiness exactly where the setup wizard reads team status.
    await new TeamService({ dataDir: directory, getRuntimeConfig: () => started }).status()
    const sockets = await monitor.finish({ readyAt })
    const audit = server.authenticationAudit
    assert.equal(audit?.productionDatabaseAuthenticationPassed, true, 'Native runtime did not verify database authentication')
    assert.equal(audit.validCredentialsAuthenticated, true)
    assert.equal(audit.probes.filter(probe => probe.passwordAccepted).length, 0)
    assert.ok(audit.roles.some(role => role.role === 'pgbouncer'), 'All LOGIN roles must be inventoried, including the unused pooler role')
    assert.equal(audit.probes.length, audit.roles.length * 2 + 1)
    const secrets = JSON.parse(await readFile(path.join(directory, 'runtime/secrets.json'), 'utf8'))
    const manifest = JSON.parse(await readFile(path.join(directory, 'runtime/manifest.json'), 'utf8'))
    assert.equal(manifest.format, NATIVE_MANIFEST_FORMAT)
    assert.equal(manifest.securityProfile, NATIVE_SECURITY_PROFILE)
    // Boolean assertions deliberately avoid printing private values on failure.
    if (installationSecrets) assert.ok(JSON.stringify(secrets) === JSON.stringify(installationSecrets), 'Restart or restore changed installation credentials')
    else installationSecrets = secrets
    assert.ok(decodeURIComponent(new URL(started.dbUrl).password) === secrets.OPENSPORT_NATIVE_DATABASE_PASSWORD, 'Native database endpoint uses a different installation credential')
    securityEvidence.push({ stage, startupSockets: sockets, authentication: audit })
    await writeFile(path.join(dataDir, 'native-auth-lifecycle.json'), JSON.stringify(securityEvidence, null, 2), { mode: 0o600 })
    console.log(`ok - ${stage}: ${audit.roles.length} LOGIN roles, ${audit.probes.length} denied credential probes, SCRAM verified before readiness${requireTemporary ? ' on temporary and final servers' : ''}`)
    return started
  } finally { await monitor.stop() }
}
try {
  let existing = false
  try { await access(path.join(dataDir, 'runtime/manifest.json')); existing = true } catch { /* fresh fixture */ }
  config = await authenticatedStart(runtime, dataDir, { requireTemporary: !existing, stage: existing ? 'existing fixture' : 'fresh installation' })
  assert.equal(config.localOnly, true)
  assert.ok(runtime.listenerAudit.listeners.length >= 6)
  assert.ok(runtime.listenerAudit.listeners.every(listener => listener.loopback))
  console.log(`ok - ${runtime.listenerAudit.listeners.length} owned TCP listeners bind only loopback`)
  const lan = Object.values(os.networkInterfaces()).flat().find(address => address && !address.internal && address.family === 'IPv4')
  if (lan) {
    for (const listener of runtime.listenerAudit.listeners) {
      const port = Number(listener.address.split(':').at(-1))
      const connected = await new Promise(resolve => {
        const socket = net.connect({ host: lan.address, port })
        socket.setTimeout(500)
        socket.once('connect', () => { socket.destroy(); resolve(true) })
        socket.once('error', () => resolve(false))
        socket.once('timeout', () => { socket.destroy(); resolve(false) })
      })
      assert.equal(connected, false, 'A local native service was reachable through the Mac LAN address')
    }
    console.log('ok - every native listener refuses connections through this Mac’s LAN address')
  }
  let fixture
  const fixturePath = path.join(dataDir, 'native-test-credentials.json')
  try { fixture = JSON.parse(await readFile(fixturePath, 'utf8')) } catch { /* fresh fixture */ }
  const db = new pg.Client({ connectionString: config.dbUrl })
  await db.connect()
  try {
    const journal = await db.query('SELECT count(*)::int AS count FROM opensport_internal.migrations')
    assert.equal(journal.rows[0].count, 3)
    if (!fixture) {
      let notices = 0
      db.on('notice', notice => { if (notice.message.startsWith('ok -')) notices++ })
      await db.query(await readFile('supabase/tests/security.sql', 'utf8'))
      assert.equal(notices, 62)
      console.log('ok - 62 database security assertions against native PostgreSQL')
    }
  } finally { await db.end() }
  if (!fixture) {
    fixture = { email: `desktop-${Date.now()}@example.test`, password: randomBytes(32).toString('hex'), name: 'Desktop test owner' }
    await writeFile(fixturePath, JSON.stringify(fixture), { mode: 0o600 })
  }
  const setup = await service.setup({ owner: fixture, team: { name: 'Desktop Integration Team', timezone: 'UTC', sport_mode: 'soccer' } })
  assert.equal(setup.configured, true)
  const request = async (route, body) => {
    const response = await fetch(`${config.apiUrl}${route}`, { method: body ? 'POST' : 'GET', headers: { apikey: config.serviceKey, Authorization: `Bearer ${config.serviceKey}`, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined })
    if (!response.ok) throw new Error(`Native fixture request failed: HTTP ${response.status}`)
    return response.json()
  }
  let teammate
  try {
    const email = `desktop-other-${Date.now()}@example.test`
    teammate = await request('/auth/v1/admin/users', { email, password: randomBytes(32).toString('hex'), email_confirm: true })
    const found = await request('/rest/v1/rpc/find_invitation_user', { p_email: email })
    assert.equal(found.id, teammate.id)
    console.log('ok - native setup and a second independent Auth account')
  } finally {
    if (teammate) await fetch(`${config.apiUrl}/auth/v1/admin/users/${teammate.id}`, { method: 'DELETE', headers: { apikey: config.serviceKey, Authorization: `Bearer ${config.serviceKey}` } })
  }
  await writeFile(path.join(dataDir, 'native-test-runtime.json'), JSON.stringify(config), { mode: 0o600 })
  await runtime.stop()
  config = null
  assert.equal(runtime.status().running, false)
  config = await authenticatedStart(runtime, dataDir, { stage: 'restart' })
  const after = await service.status()
  assert.equal(after.configured, true)
  assert.equal(after.team.name, 'Desktop Integration Team')
  const response = await fetch(`${config.apiUrl}/auth/v1/token?grant_type=password`, { method: 'POST', headers: { apikey: config.anonKey, 'Content-Type': 'application/json' }, body: JSON.stringify({ email: fixture.email, password: fixture.password }) })
  assert.equal(response.status, 200)
  console.log('ok - graceful stop/restart retains team records, Auth login, and migration checksums')
  // Node's built-in WebSocket has different interoperability than Chromium's;
  // use the explicit Node transport while retaining the normal v2 protocol.
  const client = createClient(config.apiUrl, config.anonKey, { auth: { persistSession: false, autoRefreshToken: false }, realtime: { transport: WebSocket } })
  const login = await client.auth.signInWithPassword({ email: fixture.email, password: fixture.password })
  assert.equal(login.error, null)
  const member = await client.from('soccer_members').select('id').eq('user_id', login.data.user.id).single()
  assert.equal(member.error, null)
  let receive
  const delivered = new Promise(resolve => { receive = resolve })
  const channel = client.channel('desktop-native-integration').on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'soccer_events' }, receive)
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Native Realtime subscription timed out')), 20000)
    channel.subscribe(status => {
      if (status === 'SUBSCRIBED') { clearTimeout(timer); resolve() }
      if (status === 'CHANNEL_ERROR') { clearTimeout(timer); reject(new Error('Native Realtime subscription failed')) }
    })
  })
  const event = await client.from('soccer_events').insert({ type: 'other', title: 'Native backup fixture', date: '2099-12-29', created_by: member.data.id }).select('id').single()
  assert.equal(event.error, null)
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Native Realtime did not deliver the event')), 10000)
    delivered.then(payload => { clearTimeout(timer); try { assert.equal(payload.new.id, event.data.id); resolve() } catch (error) { reject(error) } })
  })
  await client.removeAllChannels()
  console.log('ok - native Realtime delivers the inserted event without polling')
  const rsvp = await client.from('soccer_rsvps').insert({ event_id: event.data.id, member_id: member.data.id, status: 'going' })
  assert.equal(rsvp.error, null)
  const photo = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aRZ8AAAAASUVORK5CYII=', 'base64')
  const photoPath = `${login.data.user.id}/native-backup-check.png`
  const upload = await client.storage.from('avatars').upload(photoPath, photo, { contentType: 'image/png', upsert: true })
  assert.equal(upload.error, null)
  await client.auth.signOut()
  await runtime.stop()
  config = null
  // The normal macOS data directory contains “Application Support”. Exercise
  // a different root with spaces without ever touching the user's Library.
  const restoredDir = `${dataDir}-restored with spaces-${Date.now()}`
  const archivePath = `${restoredDir}.opensport`
  await createBackup({ dataDir, archivePath })
  await restoreBackup({ dataDir: restoredDir, archivePath })
  // Download cache is deliberately absent from the archive. Seed the already
  // verified test cache to keep a restore rehearsal independent of bandwidth.
  await cp(path.join(dataDir, 'runtime/home/cache'), path.join(restoredDir, 'runtime/home/cache'), { recursive: true, dereference: true })
  const restored = new NativeRuntime({ dataDir: restoredDir, resourcesDir, onProgress: ({ phase }) => console.log(`restore phase: ${phase}`) })
  try {
    const restoredConfig = await authenticatedStart(restored, restoredDir, { stage: 'relocated restore' })
    const restoredClient = createClient(restoredConfig.apiUrl, restoredConfig.anonKey, { auth: { persistSession: false, autoRefreshToken: false }, realtime: { transport: WebSocket } })
    const restoredLogin = await restoredClient.auth.signInWithPassword({ email: fixture.email, password: fixture.password })
    assert.equal(restoredLogin.error, null)
    const savedEvent = await restoredClient.from('soccer_events').select('id').eq('id', event.data.id).single()
    assert.equal(savedEvent.data?.id, event.data.id)
    const savedRsvp = await restoredClient.from('soccer_rsvps').select('status').eq('event_id', event.data.id).single()
    assert.equal(savedRsvp.data?.status, 'going')
    const signed = await restoredClient.storage.from('avatars').createSignedUrl(photoPath, 60)
    assert.equal(signed.error, null)
    const downloaded = await fetch(signed.data.signedUrl)
    assert.equal(downloaded.status, 200)
    assert.deepEqual(Buffer.from(await downloaded.arrayBuffer()), photo)
    await restoredClient.auth.signOut()
    console.log('ok - cold backup restores Auth, schedule, RSVP, and exact private photo bytes in a different directory')
  } finally { await restored.stop() }
  console.log('Native desktop integration passed. Private synthetic login saved in the test data directory.')
} finally {
  await runtime.stop()
}
