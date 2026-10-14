import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import http from 'node:http'
import net from 'node:net'
import { TeamGateway, publicPathAllowed } from '../gateway.mjs'

test('native gateway excludes internal administration and encoded traversal', () => {
  for (const target of ['/api/auth/v1/admin/users', '/api/pg', '/api/metadata', '/api/functions/v1/other', '/api/auth/v1/../admin', '/api/auth/v1/%61dmin/users', '/api/rest/v1/../../studio', '/api/realtime/v1/api/tenants']) assert.equal(publicPathAllowed(target), false, target)
  for (const target of ['/api/auth/v1/token?grant_type=password', '/api/rest/v1/team_settings', '/api/storage/v1/object/sign/avatars/one.png', '/api/realtime/v1/websocket', '/api/functions/v1/team-admin']) assert.equal(publicPathAllowed(target), true, target)
})
test('gateway serves only anonymous runtime configuration and rejects foreign origins and Host headers', async t => {
  const directory = await mkdtemp(path.join(tmpdir(), 'opensport-gateway-'))
  await writeFile(path.join(directory, 'index.html'), '<html><head></head><body>Team</body></html>')
  await writeFile(path.join(directory, '.private'), 'private-data')
  const gateway = new TeamGateway({ staticDir: directory, getRuntimeConfig: () => ({ apiUrl: 'http://127.0.0.1:1', anonKey: 'public-key', serviceKey: 'PRIVATE-service-key', dbUrl: 'PRIVATE-db-url' }) })
  const url = await gateway.start()
  t.after(async () => { await gateway.stop(); await rm(directory, { recursive: true, force: true }) })
  const configuration = await (await fetch(`${url}/runtime-config.js`)).text()
  assert.match(configuration, /public-key/)
  assert.doesNotMatch(configuration, /PRIVATE/)
  const page = await fetch(url)
  assert.match(await page.text(), /runtime-config\.js/)
  assert.equal(page.headers.get('x-frame-options'), 'DENY')
  assert.equal((await fetch(url, { headers: { Origin: 'https://attacker.example' } })).status, 403)
  const badHostStatus = await new Promise((resolve, reject) => {
    const request = http.get(url, { headers: { Host: 'attacker.example' } }, response => { response.resume(); resolve(response.statusCode) })
    request.on('error', reject)
  })
  assert.equal(badHostStatus, 403)
  assert.equal((await fetch(`${url}/.private`)).status, 404)
  assert.equal((await fetch(`${url}/api/auth/v1/admin/users`)).status, 404)
})
test('cold gateway fails recoverably until the runtime becomes ready', async t => {
  const gateway = new TeamGateway({ staticDir: tmpdir(), getRuntimeConfig: () => null })
  const url = await gateway.start()
  t.after(() => gateway.stop())
  assert.equal((await fetch(`${url}/api/rest/v1/team_settings`)).status, 503)
  assert.equal((await fetch(`${url}/runtime-config.js`)).status, 503)
})
test('saved port values cannot turn the HTTP listener into an arbitrary filesystem socket', async () => {
  for (const port of ['/tmp/opensport.sock', '54321', -1, 65536, 80, 3.5]) {
    const gateway = new TeamGateway({ staticDir: tmpdir(), getRuntimeConfig: () => null })
    await assert.rejects(gateway.start(port), /port is invalid/)
  }
})
test('an upgraded connection cannot stall gateway shutdown and cold backups', async t => {
  const gateway = new TeamGateway({ staticDir: tmpdir(), getRuntimeConfig: () => null })
  const url = await gateway.start()
  // Simulate an upgraded socket retained by a proxy instead of HTTP ownership.
  gateway.server.removeAllListeners('upgrade')
  gateway.server.on('upgrade', (_request, socket) => socket.write('HTTP/1.1 101 Switching Protocols\r\nConnection: Upgrade\r\nUpgrade: websocket\r\n\r\n'))
  const socket = net.connect({ host: '127.0.0.1', port: Number(new URL(url).port) })
  t.after(() => socket.destroy())
  await new Promise(resolve => socket.once('connect', resolve))
  socket.write(`GET /api/realtime/v1/websocket HTTP/1.1\r\nHost: ${new URL(url).host}\r\nConnection: Upgrade\r\nUpgrade: websocket\r\n\r\n`)
  await new Promise(resolve => socket.once('data', resolve))
  await Promise.race([gateway.stop(), new Promise((_resolve, reject) => { const timer = setTimeout(() => reject(new Error('WebSocket blocked shutdown')), 1000); timer.unref() })])
  assert.equal(gateway.server.listening, false)
})
