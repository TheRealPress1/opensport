import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, readdir, rm, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { TeamService } from '../team-service.mjs'

const input = { team: { name: 'Harbor United', timezone: 'America/New_York', sport_mode: 'soccer' }, owner: { name: 'Avery', email: 'owner@example.test', password: 'A private passphrase 123' } }
async function fixture(t) {
  const dataDir = await mkdtemp(join(tmpdir(), 'opensport-native-setup-'))
  t.after(() => rm(dataDir, { recursive: true, force: true }))
  const store = { users: [], members: [], team: { id: 1, name: 'My team', season: '2026', timezone: 'UTC', sport_mode: 'general', scores_enabled: true, organizer_name: '', organizer_whatsapp: '' }, requests: [], fail: null, loseCreateResponse: false }
  const config = { apiUrl: 'http://127.0.0.1:54321', serviceKey: 'private-service-key', anonKey: 'public-key', publicUrl: 'http://localhost:18888' }
  const fetchImpl = async (url, options) => {
    assert.equal(options.headers.apikey, config.serviceKey)
    const path = new URL(url).pathname; const body = options.body && JSON.parse(options.body)
    store.requests.push({ path, method: options.method, body })
    const respond = (value, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } })
    if (store.fail?.(path, options.method)) return respond({ message: `${config.serviceKey} ${input.owner.password}` }, 503)
    if (path === '/rest/v1/soccer_members') return respond(store.members.filter(member => member.active && ['admin', 'coach'].includes(member.role)).slice(0, 2))
    if (path === '/rest/v1/team_settings') {
      if (options.method === 'PATCH') Object.assign(store.team, body)
      return respond([store.team])
    }
    if (path === '/rest/v1/rpc/find_invitation_user') return respond(store.users.find(user => user.email === body.p_email) || null)
    if (path === '/auth/v1/admin/users' && options.method === 'POST') {
      const user = { id: `user-${store.users.length + 1}`, ...body, email_confirmed_at: new Date().toISOString() }
      store.users.push(user)
      if (store.loseCreateResponse) { store.loseCreateResponse = false; throw new Error('Connection lost after commit') }
      return respond(user)
    }
    if (path.startsWith('/auth/v1/admin/users/')) {
      const user = store.users.find(user => user.id === path.split('/').at(-1))
      if (!user) return respond({}, 404)
      if (options.method === 'PUT') Object.assign(user, body)
      return respond(user)
    }
    if (path === '/rest/v1/rpc/bootstrap_owner') {
      let member = store.members.find(row => row.user_id === body.p_user_id)
      if (!member) { member = { id: 'member-1', user_id: body.p_user_id, name: body.p_name }; store.members.push(member) }
      Object.assign(member, { active: true, role: 'admin' })
      return respond(member)
    }
    if (path === '/auth/v1/admin/generate_link') return respond({ ...store.users.find(user => user.email === body.email), hashed_token: 'one-use-recovery-token' })
    throw new Error(`Unhandled fixture endpoint ${options.method} ${path}`)
  }
  const create = () => new TeamService({ dataDir, getRuntimeConfig: () => config, fetchImpl })
  return { store, config, dataDir, service: create(), create }
}

test('native setup creates an owner and settings, keeping privileged data and passwords out of results and checkpoints', async t => {
  const f = await fixture(t)
  assert.equal((await f.service.status()).configured, false)
  const result = await f.service.setup(input)
  assert.equal(result.configured, true)
  assert.equal(result.team.name, input.team.name)
  assert.equal(result.owner.email, input.owner.email)
  assert.equal(f.store.members[0].role, 'admin')
  const stored = await readFile(join(f.dataDir, 'team-setup.json'), 'utf8')
  assert.equal((await stat(join(f.dataDir, 'team-setup.json'))).mode & 0o777, 0o600)
  for (const text of [stored, JSON.stringify(result), JSON.stringify(await f.service.status())]) {
    assert.ok(!text.includes(input.owner.password))
    assert.ok(!text.includes(f.config.serviceKey))
  }
  assert.equal((await f.service.status()).configured, true)
  await f.create().setup(input)
  assert.equal(f.store.users.length, 1, 'Repeated completed setup must not create another account')
})

test('settings failure preserves a resumable setup across process recreation', async t => {
  const f = await fixture(t)
  f.store.fail = (path, method) => path === '/rest/v1/team_settings' && method === 'PATCH'
  await assert.rejects(f.service.setup(input), error => !error.message.includes(f.config.serviceKey) && !error.message.includes(input.owner.password) && /save team settings/.test(error.message))
  assert.equal(f.store.users.length, 1)
  assert.equal(f.store.members.length, 1)
  const resumed = f.create()
  const status = await resumed.status()
  assert.equal(status.configured, false)
  assert.equal(status.setupPending, true)
  assert.equal(status.pendingOwner.email, input.owner.email)
  f.store.fail = null
  const updated = { ...input, team: { ...input.team, name: 'Final team name' }, owner: { ...input.owner, password: 'Updated private passphrase 456' } }
  await resumed.setup(updated)
  assert.equal(f.store.team.name, updated.team.name)
  assert.equal(f.store.users[0].password, updated.owner.password)
  assert.equal(f.store.users.length, 1)
  assert.equal((await resumed.status()).configured, true)
})

test('lost Auth create response is reconciled using the durable setup nonce without duplicating or deleting the account', async t => {
  const f = await fixture(t)
  f.store.loseCreateResponse = true
  await assert.rejects(f.service.setup(input), /create the administrator account/)
  assert.equal(f.store.users.length, 1)
  await f.create().setup(input)
  assert.equal(f.store.users.length, 1)
  assert.equal(f.store.members.length, 1)
  assert.equal(f.store.requests.filter(request => request.path === '/auth/v1/admin/users' && request.method === 'POST').length, 1)
})

test('setup refuses an existing team or an unrelated Auth account and validates before provisioning', async t => {
  const f = await fixture(t)
  await assert.rejects(f.service.setup({ ...input, team: { ...input.team, timezone: 'Invalid/Zone' } }), /valid IANA timezone/)
  assert.equal(f.store.requests.length, 0)
  assert.deepEqual(await readdir(f.dataDir), [])
  f.store.members.push({ user_id: 'another-owner', role: 'coach', active: true })
  await assert.rejects(f.service.setup(input), /already has an administrator/)
  f.store.members = []
  f.store.users.push({ id: 'existing-person', email: input.owner.email, user_metadata: {}, email_confirmed_at: new Date().toISOString() })
  await assert.rejects(f.service.setup(input), /outside this setup/)
  assert.equal(f.store.members.length, 0)
  assert.equal(f.store.users.length, 1)
})

test('host recovery uses raw Auth response, restores administrator membership, and returns only the private one-use link', async t => {
  const f = await fixture(t)
  await f.service.setup(input)
  f.store.members[0].active = false
  f.store.members[0].role = 'player'
  const result = await f.service.recoverOwner(input.owner.email)
  assert.equal(result.link, 'http://localhost:18888/?auth=recovery#token_hash=one-use-recovery-token&type=recovery')
  assert.equal(f.store.members[0].role, 'admin')
  assert.equal(f.store.members[0].active, true)
  assert.deepEqual(Object.keys(result).sort(), ['expiresAt', 'link'])
  assert.ok(!JSON.stringify(result).includes(f.config.serviceKey))
  assert.ok(!JSON.stringify(result).includes(input.owner.password))
})

test('native helper refuses service credential forwarding to a non-loopback endpoint', async t => {
  const f = await fixture(t)
  f.config.apiUrl = 'https://untrusted.example.test'
  await assert.rejects(f.service.status(), /only supports the local team service/)
  assert.equal(f.store.requests.length, 0)
})

test('desktop can read fresh and configured status while its native runtime is stopped', async t => {
  const f = await fixture(t)
  const stopped = new TeamService({ dataDir: f.dataDir, getRuntimeConfig: () => null })
  assert.deepEqual(await stopped.status(), { configured: false, setupPending: false, team: null })
  await f.service.setup(input)
  const status = await stopped.status()
  assert.equal(status.configured, true)
  assert.equal(status.team.name, input.team.name)
})
