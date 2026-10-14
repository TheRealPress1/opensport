import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import { createHmac } from 'node:crypto'

const tool = resolve('scripts/ops.mjs')
function fixture(t) {
  const path = mkdtempSync(join(tmpdir(), 'opensport-ops-'))
  t.after(() => rmSync(path, { recursive: true, force: true }))
  return { path, run: (...args) => spawnSync(process.execPath, [tool, ...args], { env: { ...process.env, OPENSPORT_CONTAINER_STATE: path }, encoding: 'utf8' }) }
}
function readEnv(path) { return Object.fromEntries(readFileSync(join(path, '.env'), 'utf8').trim().split('\n').map((line) => [line.slice(0, line.indexOf('=')), line.slice(line.indexOf('=') + 1)])) }

test('initialization generates independent secrets, signed least-privilege keys, and private configuration', (t) => {
  const a = fixture(t); const b = fixture(t)
  assert.equal(a.run('init').status, 0); assert.equal(b.run('init').status, 0)
  const av = readEnv(a.path); const bv = readEnv(b.path)
  for (const name of ['POSTGRES_PASSWORD', 'JWT_SECRET', 'SECRET_KEY_BASE', 'REALTIME_DB_ENC_KEY', 'SERVICE_ROLE_KEY']) assert.notEqual(av[name], bv[name])
  for (const [key, role] of [['ANON_KEY', 'anon'], ['SERVICE_ROLE_KEY', 'service_role']]) {
    const [head, body, signature] = av[key].split('.')
    assert.equal(JSON.parse(Buffer.from(body, 'base64url')).role, role)
    assert.equal(signature, createHmac('sha256', av.JWT_SECRET).update(`${head}.${body}`).digest('base64url'))
  }
  assert.equal(statSync(join(a.path, '.env')).mode & 0o777, 0o600)
  assert.equal(av.DISABLE_SIGNUP, 'true'); assert.equal(av.BIND_ADDRESS, '127.0.0.1')
  const before = readFileSync(join(a.path, '.env'), 'utf8')
  assert.notEqual(a.run('init').status, 0)
  assert.equal(readFileSync(join(a.path, '.env'), 'utf8'), before)
})

test('remote setup requires HTTPS origin and local ports map consistently', (t) => {
  for (const url of ['http://team.example.org', 'https://example.org/path', 'https://user:pass@example.org', 'https://example.org:8443']) {
    const f = fixture(t); assert.notEqual(f.run('init', url).status, 0)
  }
  const remote = fixture(t); assert.equal(remote.run('init', 'https://team.example.org').status, 0)
  const env = readEnv(remote.path)
  assert.equal(env.CADDY_SITE, 'https://team.example.org'); assert.equal(env.HTTP_PORT, '80'); assert.equal(env.HTTPS_PORT, '443')
  assert.equal(env.API_EXTERNAL_URL, 'https://team.example.org/api/auth/v1')
  const local = fixture(t); assert.equal(local.run('init', 'http://localhost:18880').status, 0)
  assert.equal(readEnv(local.path).HTTP_PORT, '18880'); assert.equal(readEnv(local.path).CADDY_SITE, 'http://:80')
})

async function runWithApi(t, command, input, handler) {
  const { createServer } = await import('node:http')
  const { spawn } = await import('node:child_process')
  const server = createServer(async (request, response) => {
    let body = ''; for await (const chunk of request) body += chunk
    const result = handler(request.url, body ? JSON.parse(body) : undefined, request.method)
    response.writeHead(result.status || 200, { 'Content-Type': 'application/json' }); response.end(JSON.stringify(result.body))
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  t.after(() => server.close())
  const child = spawn(process.execPath, [tool, command], { env: { ...process.env, SUPABASE_URL: `http://127.0.0.1:${server.address().port}`, SUPABASE_SERVICE_ROLE_KEY: 'operator-test-key', PUBLIC_URL: 'https://team.example.org' } })
  let output = ''; child.stdout.on('data', (chunk) => { output += chunk }); child.stderr.on('data', (chunk) => { output += chunk })
  child.stdin.end(input)
  const status = await new Promise((resolve) => child.on('close', resolve))
  return { status, output }
}

test('host recovery handles raw Auth response and restores administrator before returning the link', async (t) => {
  const calls = []
  const result = await runWithApi(t, 'recover', 'owner@example.org\n', (url, body) => {
    calls.push({ url, body })
    if (url === '/auth/v1/admin/generate_link') return { body: { id: 'user-123', email: 'owner@example.org', hashed_token: 'private-token', user_metadata: { name: 'Owner' } } }
    return { body: {} }
  })
  assert.equal(result.status, 0)
  assert.equal(calls[1].url, '/rest/v1/rpc/bootstrap_owner')
  assert.deepEqual(calls[1].body, { p_user_id: 'user-123', p_email: 'owner@example.org', p_name: 'Owner' })
  assert.match(result.output, /https:\/\/team.example.org\/\?auth=recovery#token_hash=private-token&type=recovery/)
  assert.doesNotMatch(result.output, /operator-test-key/)
})

test('failed first-admin provisioning removes the partial Auth account and never prints a password', async (t) => {
  const calls = []
  const result = await runWithApi(t, 'bootstrap', 'owner@example.org\nOwner\nprivate-password-123\n', (url, body, method) => {
    calls.push({ url, method })
    if (url.startsWith('/rest/v1/soccer_members?')) return { body: [] }
    if (url === '/auth/v1/admin/users') return { body: { id: 'user-123' } }
    if (url === '/rest/v1/rpc/bootstrap_owner') return { status: 500, body: { message: 'Database unavailable' } }
    return { body: {} }
  })
  assert.notEqual(result.status, 0)
  assert.deepEqual(calls.at(-1), { url: '/auth/v1/admin/users/user-123', method: 'DELETE' })
  assert.doesNotMatch(result.output, /private-password-123/)
})
