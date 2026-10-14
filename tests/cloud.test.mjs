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

const post = (path, body, origin = SITE, token) => new Request(`${SITE}${path}`, { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(body) })
const setupWith = code => createSetupHandler(() => env, () => code, { failureDelay: 0 })

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

test('setup status reports a missing owner, missing tables, and open sign-ups', async () => {
  const handle = setupWith('correct horse battery')
  await withUpstream([
    ['GET', /^\/rest\/v1\/soccer_members/, () => json([])],
    ['GET', /^\/auth\/v1\/settings$/, () => json({ disable_signup: false })],
  ], async () => {
    const body = await (await handle(new Request(`${SITE}/api/setup`))).json()
    assert.deepEqual(body, { databaseReady: true, needsSetup: true, setupCode: 'ok', signupsDisabled: false, authSettingsUrl: 'https://supabase.com/dashboard/project/abcdefgh/auth/providers' })
  })
  await withUpstream([
    ['GET', /^\/rest\/v1\/soccer_members/, () => json({ code: 'PGRST205', message: 'Could not find the table' }, 404)],
    ['GET', /^\/auth\/v1\/settings$/, () => json({ disable_signup: true })],
  ], async () => {
    const body = await (await handle(new Request(`${SITE}/api/setup`))).json()
    assert.equal(body.databaseReady, false)
    assert.equal(body.signupsDisabled, true)
  })
})

// Every code check is counted first; the database reports attempts in the past hour.
const attempt = (count = 1) => ['POST', /^\/rest\/v1\/rpc\/record_setup_attempt$/, () => json(count)]

test('setup refuses a wrong code, a short or missing configured code, and a second owner', async () => {
  await withUpstream([attempt()], async calls => {
    const wrong = await setupWith('correct horse battery')(post('/api/setup', { code: 'guess' }))
    assert.equal(wrong.status, 403)
    assert.deepEqual(calls.map(call => call.path), ['/rest/v1/rpc/record_setup_attempt'], 'a wrong code is counted and touches nothing else')
  })
  await withUpstream([], async calls => {
    const short = await setupWith('eleven char')(post('/api/setup', { code: 'eleven char' }))
    assert.equal(short.status, 503)
    assert.match((await short.json()).error, /at least 12 characters/)
    assert.equal((await setupWith('')(post('/api/setup', { code: '' }))).status, 503)
    assert.equal(calls.length, 0, 'nothing is counted or changed while the code is misconfigured')
  })
  await withUpstream([attempt(), ['GET', /^\/rest\/v1\/soccer_members/, () => json([{ id: ownerId }])]], async () => {
    const response = await setupWith('correct horse battery')(post('/api/setup', { code: 'correct horse battery', team_name: 'Riverside FC', name: 'Alex', email: 'alex@example.test', password: 'a long enough password' }))
    assert.equal(response.status, 409)
  })
})

test('setup stops checking codes after ten attempts in an hour', async () => {
  await withUpstream([attempt(11)], async calls => {
    const response = await setupWith('correct horse battery')(post('/api/setup', { code: 'correct horse battery', action: 'recover-owner', email: 'alex@example.test' }))
    assert.equal(response.status, 429)
    assert.equal(calls.length, 1, 'even the right code is refused until the hour passes')
  })
  await withUpstream([['POST', /^\/rest\/v1\/rpc\/record_setup_attempt$/, () => json({ code: 'PGRST202', message: 'Could not find the function' }, 404)]], async () => {
    const response = await setupWith('correct horse battery')(post('/api/setup', { code: 'guess' }))
    assert.equal(response.status, 503, 'before migrations run, no code is checked at all')
  })
})

test('setup status reports a missing or short setup code', async () => {
  for (const [code, state] of [['', 'missing'], ['eleven char', 'too-short']]) {
    await withUpstream([
      ['GET', /^\/rest\/v1\/soccer_members/, () => json([])],
      ['GET', /^\/auth\/v1\/settings$/, () => json({ disable_signup: true })],
    ], async () => {
      const body = await (await setupWith(code)(new Request(`${SITE}/api/setup`))).json()
      assert.equal(body.setupCode, state)
      assert.equal(JSON.stringify(body).includes(code || '\u0000'), false, 'the code itself is never returned')
    })
  }
})

const owner = { code: 'correct horse battery', team_name: 'Riverside FC', sport_mode: 'soccer', timezone: 'America/New_York', name: 'Alex Rivera', email: 'Alex@Example.test', password: 'a long enough password' }

test('setup creates the team settings, owner account, and administrator membership', async () => {
  await withUpstream([
    attempt(),
    ['GET', /^\/rest\/v1\/soccer_members/, () => json([])],
    ['PATCH', /^\/rest\/v1\/team_settings\?id=eq\.1$/, () => json(null, 204)],
    ['POST', /^\/auth\/v1\/admin\/users$/, () => json({ id: ownerId })],
    ['POST', /^\/rest\/v1\/rpc\/bootstrap_owner$/, () => json({ id: 'member' })],
  ], async calls => {
    const response = await setupWith('correct horse battery')(post('/api/setup', owner))
    assert.equal(response.status, 200)
    const [, , settings, account, membership] = calls
    assert.deepEqual(settings.body, { name: 'Riverside FC', sport_mode: 'soccer', timezone: 'America/New_York', season: String(new Date().getFullYear()), scores_enabled: true })
    assert.deepEqual(account.body, { email: 'alex@example.test', password: 'a long enough password', email_confirm: true, user_metadata: { name: 'Alex Rivera' } })
    assert.deepEqual(membership.body, { p_user_id: ownerId, p_email: 'alex@example.test', p_name: 'Alex Rivera' })
    for (const call of calls) assert.equal(call.headers.has('Authorization'), false)
  })
})

test('setup resumes with an existing account and removes a new one if membership fails', async () => {
  await withUpstream([
    attempt(),
    ['GET', /^\/rest\/v1\/soccer_members/, () => json([])],
    ['PATCH', /^\/rest\/v1\/team_settings/, () => json(null, 204)],
    ['POST', /^\/auth\/v1\/admin\/users$/, () => json({ code: 'email_exists', msg: 'already registered' }, 422)],
    ['POST', /^\/rest\/v1\/rpc\/find_invitation_user$/, () => json({ id: ownerId })],
    ['PUT', new RegExp(`^/auth/v1/admin/users/${ownerId}$`), () => json({ id: ownerId })],
    ['POST', /^\/rest\/v1\/rpc\/bootstrap_owner$/, () => json({ id: 'member' })],
  ], async calls => {
    assert.equal((await setupWith('correct horse battery')(post('/api/setup', owner))).status, 200)
    assert.equal(calls.find(call => call.method === 'PUT').body.password, 'a long enough password')
  })
  await withUpstream([
    attempt(),
    ['GET', /^\/rest\/v1\/soccer_members/, () => json([])],
    ['PATCH', /^\/rest\/v1\/team_settings/, () => json(null, 204)],
    ['POST', /^\/auth\/v1\/admin\/users$/, () => json({ id: ownerId })],
    ['POST', /^\/rest\/v1\/rpc\/bootstrap_owner$/, () => json({ message: 'database unavailable' }, 500)],
    ['DELETE', new RegExp(`^/auth/v1/admin/users/${ownerId}$`), () => json(null, 200)],
  ], async calls => {
    assert.equal((await setupWith('correct horse battery')(post('/api/setup', owner))).status, 502)
    assert.ok(calls.some(call => call.method === 'DELETE'), 'the partially created account is removed')
  })
})

test('owner recovery restores administrator access and returns a private link', async () => {
  await withUpstream([
    attempt(),
    ['POST', /^\/rest\/v1\/rpc\/find_invitation_user$/, () => json({ id: ownerId })],
    ['GET', /^\/rest\/v1\/soccer_members/, () => json([{ id: 'member', user_id: ownerId, name: 'Alex Rivera', role: 'player', active: false }])],
    ['POST', /^\/auth\/v1\/admin\/generate_link$/, () => json({ hashed_token: 'recovery-token-hash' })],
    ['POST', /^\/rest\/v1\/rpc\/bootstrap_owner$/, () => json({ id: 'member' })],
  ], async calls => {
    const response = await setupWith('correct horse battery')(post('/api/setup', { action: 'recover-owner', code: 'correct horse battery', email: 'alex@example.test' }))
    assert.equal(response.status, 200)
    assert.equal((await response.json()).link, `${SITE}/?auth=recovery#token_hash=recovery-token-hash&type=recovery`)
    assert.equal(calls.at(-1).body.p_name, 'Alex Rivera')
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

test('migration connection gives up on real errors and after the wait', async () => {
  const pooler = 'postgres://pooler.example.test/postgres'
  const denied = scriptedClients({ [pooler]: [failure('42501', 'permission denied')] })
  await assert.rejects(connectWhenReady([pooler], { connect: denied.connect, sleep: async () => {}, log: () => {} }), /permission denied/)
  assert.equal(denied.opened.length, 1, 'errors that waiting cannot fix fail immediately')

  const down = scriptedClients({ [pooler]: Array(5).fill(failure('ECONNREFUSED', 'connect ECONNREFUSED')) })
  await assert.rejects(connectWhenReady([pooler], { connect: down.connect, waitMs: 0, sleep: async () => {}, log: () => {} }), /ECONNREFUSED/)
})
