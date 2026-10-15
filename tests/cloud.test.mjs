import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createTeamAdminHandler } from '../supabase/functions/team-admin/core.js'
import { cloudEnvironment } from '../server/cloud.js'
import { createSetupHandler } from '../server/setup.js'
import { connectWhenReady, migrate, readMigrations } from '../scripts/cloud-migrate.mjs'

const SECRET = 'sb_secret_test_only'
const PUBLISHABLE = 'sb_publishable_test_only'
const SITE = 'https://riverside.vercel.app'
const ownerId = '10000000-0000-0000-0000-000000000001'
const env = { url: 'https://abcdefgh.supabase.co', serviceKey: SECRET, anonKey: PUBLISHABLE, siteUrl: SITE, allowedOrigins: [SITE, 'https://riverside-git-main.vercel.app'] }
const json = (body, status = 200) => body === null ? new Response(null, { status }) : new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

// Replays scripted upstream responses and records every call's method, path, and headers.
async function withUpstream(routes, run) {
  const calls = []
  const original = globalThis.fetch
  globalThis.fetch = async (input, init = {}) => {
    const url = new URL(String(input))
    const call = { method: init.method || 'GET', path: url.pathname + url.search, headers: new Headers(init.headers), body: init.body ? JSON.parse(init.body) : undefined }
    calls.push(call)
    const route = routes.find(([method, pattern]) => method === call.method && pattern.test(call.path))
    if (!route) throw new Error(`Unexpected upstream call: ${call.method} ${call.path}`)
    return route[2](call)
  }
  try { await run(calls) } finally { globalThis.fetch = original }
}

const post = (path, body, origin = SITE, token, address = '203.0.113.7') => new Request(`${SITE}${path}`, { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json', 'x-real-ip': address, ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(body) })
const setupWith = (code, { ownerRecovery = false } = {}) => createSetupHandler(() => env, () => code, { failureDelay: 0, ownerRecovery: () => ownerRecovery })
// Team status asks whether any active administrator exists; membership lookups ask by user.
const admins = rows => ['GET', /^\/rest\/v1\/soccer_members\?select=id&role=/, () => json(rows)]
const memberOf = (userId, rows) => ['GET', new RegExp(`^/rest/v1/soccer_members\\?user_id=eq\\.${userId}&`), () => json(rows)]

test('cloud environment maps Supabase Marketplace variables and Vercel addresses', () => {
  const mapped = cloudEnvironment({
    SUPABASE_URL: 'https://abcdefgh.supabase.co', SUPABASE_SECRET_KEY: SECRET, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: PUBLISHABLE,
    VERCEL_PROJECT_PRODUCTION_URL: 'riverside.vercel.app', VERCEL_URL: 'riverside-abc123.vercel.app', VERCEL_BRANCH_URL: 'riverside-git-main.vercel.app',
  })
  assert.equal(mapped.serviceKey, SECRET)
  assert.equal(mapped.anonKey, PUBLISHABLE)
  assert.equal(mapped.siteUrl, SITE)
  assert.deepEqual(mapped.allowedOrigins, [SITE, 'https://riverside-abc123.vercel.app', 'https://riverside-git-main.vercel.app'])
})

test('opaque secret keys travel only in apikey; user tokens keep Authorization', async () => {
  const handle = createTeamAdminHandler(() => env)
  await withUpstream([
    ['GET', /^\/auth\/v1\/user$/, () => json({ id: ownerId })],
    ['GET', /^\/rest\/v1\/soccer_members/, () => json([{ id: ownerId, user_id: ownerId, role: 'admin', active: true, onboarding_completed_at: '2026-01-01' }])],
    ['POST', /^\/rest\/v1\/rpc\/revoke_invitation$/, () => json(null, 204)],
  ], async calls => {
    const response = await handle(post('/api/team-admin', { action: 'revoke-invite', invitation_id: '50000000-0000-0000-0000-000000000001' }, SITE, 'user-session-jwt'))
    assert.equal(response.status, 200)
    const [userCheck, memberCheck, revoke] = calls
    assert.equal(userCheck.headers.get('Authorization'), 'Bearer user-session-jwt')
    assert.equal(userCheck.headers.get('apikey'), PUBLISHABLE)
    assert.equal(memberCheck.headers.get('apikey'), SECRET)
    assert.equal(memberCheck.headers.has('Authorization'), false, 'the secret key must never be sent as a bearer token')
    assert.equal(revoke.headers.get('Authorization'), 'Bearer user-session-jwt', 'revocation runs with the caller’s own token')
  })
})

test('team administration accepts deployment origins and rejects others', async () => {
  const handle = createTeamAdminHandler(() => env)
  await withUpstream([], async () => {
    const foreign = await handle(post('/api/team-admin', { action: 'invite', email: 'a@example.test' }, 'https://attacker.test', 'token'))
    assert.equal(foreign.status, 403)
    const preflight = await handle(new Request(`${SITE}/api/team-admin`, { method: 'OPTIONS', headers: { Origin: 'https://riverside-git-main.vercel.app' } }))
    assert.equal(preflight.status, 204)
    // A custom domain serving the same deployment passes as same-origin, then needs sign-in.
    const ownDomain = await handle(new Request('https://riverside.example.org/api/team-admin', { method: 'POST', headers: { Origin: 'https://riverside.example.org' }, body: '{}' }))
    assert.equal(ownDomain.status, 401)
    const spoofed = await handle(new Request('https://riverside.example.org/api/team-admin', { method: 'POST', headers: { Origin: 'https://riverside.example.org.attacker.test' }, body: '{}' }))
    assert.equal(spoofed.status, 403)
  })
})

test('setup status reports a missing owner and missing tables', async () => {
  const handle = setupWith('correct horse battery')
  await withUpstream([admins([])], async calls => {
    const body = await (await handle(new Request(`${SITE}/api/setup`))).json()
    assert.deepEqual(body, { databaseReady: true, needsSetup: true, setupCode: 'ok', ownerRecovery: false })
    assert.equal(calls.length, 1, 'one database read per status check')
  })
  await withUpstream([
    ['GET', /^\/rest\/v1\/soccer_members/, () => json({ code: 'PGRST205', message: 'Could not find the table' }, 404)],
  ], async () => {
    const body = await (await setupWith('correct horse battery', { ownerRecovery: true })(new Request(`${SITE}/api/setup`))).json()
    assert.equal(body.databaseReady, false)
    assert.equal(body.ownerRecovery, true)
  })
})

// The database decides whether a visitor may check a code this hour.
const attempt = (allowed = true) => ['POST', /^\/rest\/v1\/rpc\/record_setup_attempt$/, () => json(allowed)]

test('setup refuses a wrong code, a short or missing configured code, and a second owner', async () => {
  await withUpstream([admins([]), attempt()], async calls => {
    const wrong = await setupWith('correct horse battery')(post('/api/setup', { code: 'guess' }))
    assert.equal(wrong.status, 403)
    assert.deepEqual(calls.map(call => call.method), ['GET', 'POST'], 'a wrong code is counted and changes nothing')
  })
  await withUpstream([], async calls => {
    const short = await setupWith('eleven char')(post('/api/setup', { code: 'eleven char' }))
    assert.equal(short.status, 503)
    assert.match((await short.json()).error, /at least 12 characters/)
    assert.equal((await setupWith('')(post('/api/setup', { code: '' }))).status, 503)
    assert.equal(calls.length, 0, 'nothing is counted or changed while the code is misconfigured')
  })
  await withUpstream([admins([{ id: ownerId }])], async calls => {
    const response = await setupWith('correct horse battery')(post('/api/setup', { code: 'any guess at all' }))
    assert.equal(response.status, 409)
    assert.equal(calls.length, 1, 'once the team exists, setup answers before any code is checked')
  })
})

test('setup code checks stop when the database says the visitor is out of attempts', async () => {
  for (const answer of [false, null, 3, 'true']) {
    await withUpstream([admins([]), attempt(answer)], async calls => {
      const response = await setupWith('correct horse battery')(post('/api/setup', { code: 'correct horse battery' }))
      assert.equal(response.status, 429, `refused for ${JSON.stringify(answer)}`)
      assert.equal(calls.length, 2, 'even the right code is refused')
    })
  }
  await withUpstream([admins([]), ['POST', /^\/rest\/v1\/rpc\/record_setup_attempt$/, () => json({ code: 'PGRST202', message: 'Could not find the function' }, 404)]], async () => {
    const response = await setupWith('correct horse battery')(post('/api/setup', { code: 'guess' }))
    assert.equal(response.status, 503, 'before migrations run, no code is checked at all')
  })
})

test('attempts are counted per visitor without storing their address', async () => {
  const clients = []
  await withUpstream([admins([]), ['POST', /^\/rest\/v1\/rpc\/record_setup_attempt$/, call => { clients.push(call.body.p_client); return json(true) }]], async () => {
    const handle = setupWith('correct horse battery')
    for (const address of ['203.0.113.7', '203.0.113.7', '198.51.100.20']) await handle(post('/api/setup', { code: 'guess' }, SITE, undefined, address))
  })
  assert.equal(clients[0], clients[1])
  assert.notEqual(clients[0], clients[2])
  assert.ok(clients.every(client => /^[0-9a-f]{64}$/.test(client) && !client.includes('203.0.113.7')))
})

test('setup status reports a missing or short setup code', async () => {
  for (const [code, state] of [['', 'missing'], ['eleven char', 'too-short']]) {
    await withUpstream([admins([])], async () => {
      const body = await (await setupWith(code)(new Request(`${SITE}/api/setup`))).json()
      assert.equal(body.setupCode, state)
      assert.equal(JSON.stringify(body).includes(code || '\u0000'), false, 'the code itself is never returned')
    })
  }
})

const owner = { code: 'correct horse battery', team_name: 'Riverside FC', sport_mode: 'soccer', timezone: 'America/New_York', name: 'Alex Rivera', email: 'Alex@Example.test', password: 'a long enough password' }
const newOwnerId = '10000000-0000-0000-0000-000000000009'
const find = (method, pattern) => calls => calls.find(call => call.method === method && pattern.test(call.path))

test('setup creates the team settings, owner account, and administrator membership', async () => {
  await withUpstream([
    admins([]),
    attempt(),
    ['PATCH', /^\/rest\/v1\/team_settings\?id=eq\.1$/, () => json(null, 204)],
    ['POST', /^\/rest\/v1\/rpc\/find_invitation_user$/, () => json(null)],
    ['POST', /^\/auth\/v1\/admin\/users$/, () => json({ id: ownerId })],
    ['POST', /^\/rest\/v1\/rpc\/bootstrap_owner$/, () => json({ id: 'member' })],
  ], async calls => {
    const response = await setupWith('correct horse battery')(post('/api/setup', owner))
    assert.equal(response.status, 200)
    assert.deepEqual(find('PATCH', /team_settings/)(calls).body, { name: 'Riverside FC', sport_mode: 'soccer', timezone: 'America/New_York', season: String(new Date().getFullYear()), scores_enabled: true })
    assert.deepEqual(find('POST', /admin\/users$/)(calls).body, { email: 'alex@example.test', password: 'a long enough password', email_confirm: true, user_metadata: { name: 'Alex Rivera' } })
    assert.deepEqual(find('POST', /bootstrap_owner/)(calls).body, { p_user_id: ownerId, p_email: 'alex@example.test', p_name: 'Alex Rivera' })
    for (const call of calls) assert.equal(call.headers.has('Authorization'), false)
  })
})

test('setup replaces an account OpenSport did not create, keeps a team member, and cleans up failures', async () => {
  // Someone registered the owner's address through an open sign-up first.
  await withUpstream([
    admins([]),
    attempt(),
    ['PATCH', /^\/rest\/v1\/team_settings/, () => json(null, 204)],
    ['POST', /^\/rest\/v1\/rpc\/find_invitation_user$/, () => json({ id: ownerId, email_confirmed_at: '2026-01-01' })],
    memberOf(ownerId, []),
    ['DELETE', new RegExp(`^/auth/v1/admin/users/${ownerId}$`), () => json(null, 200)],
    ['POST', /^\/auth\/v1\/admin\/users$/, () => json({ id: newOwnerId })],
    ['POST', /^\/rest\/v1\/rpc\/bootstrap_owner$/, () => json({ id: 'member' })],
  ], async calls => {
    assert.equal((await setupWith('correct horse battery')(post('/api/setup', owner))).status, 200)
    const removed = calls.findIndex(call => call.method === 'DELETE')
    const created = calls.findIndex(call => call.method === 'POST' && call.path === '/auth/v1/admin/users')
    assert.ok(removed >= 0 && removed < created, 'the earlier account is removed before a fresh one is created')
    assert.equal(find('POST', /bootstrap_owner/)(calls).body.p_user_id, newOwnerId)
  })
  // An account that already belongs to the team is kept, with the chosen password.
  await withUpstream([
    admins([]),
    attempt(),
    ['PATCH', /^\/rest\/v1\/team_settings/, () => json(null, 204)],
    ['POST', /^\/rest\/v1\/rpc\/find_invitation_user$/, () => json({ id: ownerId })],
    memberOf(ownerId, [{ id: 'member', user_id: ownerId, name: 'Alex Rivera', role: 'player', active: false }]),
    ['PUT', new RegExp(`^/auth/v1/admin/users/${ownerId}$`), () => json({ id: ownerId })],
    ['POST', /^\/rest\/v1\/rpc\/bootstrap_owner$/, () => json({ id: 'member' })],
  ], async calls => {
    assert.equal((await setupWith('correct horse battery')(post('/api/setup', owner))).status, 200)
    assert.equal(find('PUT', /admin\/users/)(calls).body.password, 'a long enough password')
    assert.equal(calls.some(call => call.method === 'DELETE'), false)
  })
  await withUpstream([
    admins([]),
    attempt(),
    ['PATCH', /^\/rest\/v1\/team_settings/, () => json(null, 204)],
    ['POST', /^\/rest\/v1\/rpc\/find_invitation_user$/, () => json(null)],
    ['POST', /^\/auth\/v1\/admin\/users$/, () => json({ id: ownerId })],
    ['POST', /^\/rest\/v1\/rpc\/bootstrap_owner$/, () => json({ message: 'database unavailable' }, 500)],
    ['DELETE', new RegExp(`^/auth/v1/admin/users/${ownerId}$`), () => json(null, 200)],
  ], async calls => {
    assert.equal((await setupWith('correct horse battery')(post('/api/setup', owner))).status, 502)
    assert.ok(calls.some(call => call.method === 'DELETE'), 'the partially created account is removed')
  })
})

const recover = { action: 'recover-owner', code: 'correct horse battery', email: 'alex@example.test' }

test('owner recovery is off until the owner turns it on in Vercel', async () => {
  await withUpstream([], async calls => {
    const response = await setupWith('correct horse battery')(post('/api/setup', recover))
    assert.equal(response.status, 403)
    assert.match((await response.json()).error, /OPENSPORT_ALLOW_OWNER_RECOVERY/)
    assert.equal(calls.length, 0, 'no code is checked and nothing is counted')
  })
})

test('owner recovery restores a team member and returns a private link, but never promotes an outsider', async () => {
  await withUpstream([
    attempt(),
    ['POST', /^\/rest\/v1\/rpc\/find_invitation_user$/, () => json({ id: ownerId })],
    memberOf(ownerId, [{ id: 'member', user_id: ownerId, name: 'Alex Rivera', role: 'player', active: false }]),
    ['POST', /^\/auth\/v1\/admin\/generate_link$/, () => json({ hashed_token: 'recovery-token-hash' })],
    ['POST', /^\/rest\/v1\/rpc\/bootstrap_owner$/, () => json({ id: 'member' })],
  ], async calls => {
    const response = await setupWith('correct horse battery', { ownerRecovery: true })(post('/api/setup', recover))
    assert.equal(response.status, 200)
    assert.equal((await response.json()).link, `${SITE}/?auth=recovery#token_hash=recovery-token-hash&type=recovery`)
    assert.equal(calls.at(-1).body.p_name, 'Alex Rivera')
  })
  await withUpstream([
    attempt(),
    ['POST', /^\/rest\/v1\/rpc\/find_invitation_user$/, () => json({ id: ownerId })],
    memberOf(ownerId, []),
  ], async calls => {
    const response = await setupWith('correct horse battery', { ownerRecovery: true })(post('/api/setup', recover))
    assert.equal(response.status, 404)
    assert.equal(calls.some(call => /generate_link|bootstrap_owner/.test(call.path)), false)
  })
})

test('an invitation replaces an account that was registered before OpenSport invited it', async () => {
  const squatterId = '10000000-0000-0000-0000-000000000007'
  const invitedId = '10000000-0000-0000-0000-000000000008'
  await withUpstream([
    ['GET', /^\/auth\/v1\/user$/, () => json({ id: ownerId })],
    memberOf(ownerId, [{ id: ownerId, user_id: ownerId, role: 'admin', active: true, onboarding_completed_at: '2026-01-01' }]),
    ['POST', /^\/rest\/v1\/rpc\/find_invitation_user$/, () => json({ id: squatterId, email_confirmed_at: '2026-01-01' })],
    memberOf(squatterId, []),
    ['DELETE', new RegExp(`^/auth/v1/admin/users/${squatterId}$`), () => json(null, 200)],
    ['POST', /^\/auth\/v1\/admin\/generate_link$/, () => json({ id: invitedId, hashed_token: 'invite-token-hash-long-enough' })],
    ['POST', /^\/rest\/v1\/rpc\/issue_invitation$/, () => json({ id: '50000000-0000-0000-0000-000000000001', expires_at: '2026-10-14T18:00:00Z' })],
  ], async calls => {
    const response = await createTeamAdminHandler(() => env)(post('/api/team-admin', { action: 'invite', email: 'sam@example.test', name: 'Sam' }, SITE, 'user-session-jwt'))
    assert.equal(response.status, 200)
    assert.ok(calls.some(call => call.method === 'DELETE'), 'the earlier account is removed')
    assert.equal(find('POST', /generate_link/)(calls).body.type, 'invite', 'a fresh invitation, not a recovery link for the old account')
    assert.equal(find('POST', /issue_invitation/)(calls).body.p_user_id, invitedId)
  })
})

test('migration runner applies new files, skips finished ones, and refuses edited ones', async () => {
  const journal = new Map()
  const executed = []
  const client = {
    async query(sql, params = []) {
      if (sql.startsWith('SELECT checksum')) return { rows: journal.has(params[0]) ? [{ checksum: journal.get(params[0]) }] : [] }
      if (sql.startsWith('INSERT INTO opensport_internal.migrations')) journal.set(params[0], params[1])
      executed.push(sql)
      return { rows: [] }
    },
  }
  const migrations = await readMigrations()
  assert.deepEqual(migrations.map(item => item.name), ['20261012000100_single_team.sql', '20261012000200_invitation_password_gate.sql', '20261012000300_confirmed_password_setup.sql', '20261014000100_cloud_setup_attempts.sql'])
  const log = []
  await migrate(client, migrations, line => log.push(line))
  assert.deepEqual(log, migrations.map(item => `Applied: ${item.name}`))
  assert.ok(executed.includes("NOTIFY pgrst, 'reload schema'"))
  log.length = 0
  await migrate(client, migrations, line => log.push(line))
  assert.deepEqual(log, migrations.map(item => `Already applied: ${item.name}`))
  await assert.rejects(migrate(client, [{ ...migrations[0], sql: `${migrations[0].sql}\n-- edited` }], () => {}), /Changed applied migration/)
})

// Fake pg clients: each address answers with a scripted sequence of connect results.
function scriptedClients(script) {
  const opened = []
  return {
    opened,
    connect: url => ({
      async connect() {
        opened.push(url)
        const outcome = script[url].shift()
        if (outcome instanceof Error) throw outcome
      },
      async end() {},
    }),
  }
}
const failure = (code, message = code) => Object.assign(new Error(message), { code })

test('migration connection falls back to the pooler and waits for a new database', async () => {
  const direct = 'postgres://direct.example.test/postgres'
  const pooler = 'postgres://pooler.example.test/postgres'
  const fallback = scriptedClients({ [direct]: [failure('ENETUNREACH')], [pooler]: [null] })
  await connectWhenReady([direct, pooler], { connect: fallback.connect, sleep: async () => {}, log: () => {} })
  assert.deepEqual(fallback.opened, [direct, pooler], 'an unreachable direct address falls back to the pooler')

  const waits = []
  const starting = scriptedClients({ [pooler]: [failure('XX000', 'Tenant or user not found'), failure('57P03', 'the database system is starting up'), null] })
  await connectWhenReady([pooler], { connect: starting.connect, sleep: async ms => { waits.push(ms) }, log: () => {} })
  assert.equal(starting.opened.length, 3, 'keeps trying while the new project starts')
  assert.deepEqual(waits, [5000, 10000])
})

test('migration connection tries every address before failing', async () => {
  const direct = 'postgres://direct.example.test/postgres'
  const pooler = 'postgres://pooler.example.test/postgres'
  const clients = scriptedClients({ [direct]: [failure('DEPTH_ZERO_SELF_SIGNED_CERT', 'self-signed certificate')], [pooler]: [null] })
  await connectWhenReady([direct, pooler], { connect: clients.connect, sleep: async () => {}, log: () => {} })
  assert.deepEqual(clients.opened, [direct, pooler])
})

test('migration connection gives up on real errors and after the wait', async () => {
  const pooler = 'postgres://pooler.example.test/postgres'
  const denied = scriptedClients({ [pooler]: [failure('42501', 'permission denied')] })
  await assert.rejects(connectWhenReady([pooler], { connect: denied.connect, sleep: async () => {}, log: () => {} }), /permission denied/)
  assert.equal(denied.opened.length, 1, 'errors that waiting cannot fix fail immediately')

  const down = scriptedClients({ [pooler]: Array(5).fill(failure('ECONNREFUSED', 'connect ECONNREFUSED')) })
  await assert.rejects(connectWhenReady([pooler], { connect: down.connect, waitMs: 0, sleep: async () => {}, log: () => {} }), /ECONNREFUSED/)
})
