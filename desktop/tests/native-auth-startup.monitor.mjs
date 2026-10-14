// Test-only observer. It never starts/stops services and only probes sockets
// owned by PostgreSQL binaries inside the explicitly selected test fixture.
import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { readFile, realpath } from 'node:fs/promises'
import path from 'node:path'
import { promisify } from 'node:util'
import pg from 'pg'

const execute = promisify(execFile)
const authenticationDenied = new Set(['28P01', '28000'])
const transient = new Set(['ECONNREFUSED', 'ENOENT', 'ECONNRESET', '57P03', '57P01', 'CLIENT_ERROR'])
const pause = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds))

export function ownedPostgresPids(output, cacheRoot) {
  return output.split('\n').flatMap(line => {
    const match = line.match(/^\s*(\d+)\s+(.+?)\s*$/)
    return match && match[2].startsWith(`${cacheRoot}${path.sep}`) && /\/bin\/(?:postgres|\.postgres-wrapped)$/.test(match[2]) ? [Number(match[1])] : []
  })
}

export function postgresSocketPaths(output) {
  return [...new Set(output.split('\n').filter(line => line.startsWith('n')).map(line => line.slice(1)))].flatMap(socket => {
    const match = socket.match(/^\/(?:private\/)?tmp\/supabase-pg([.-])[^/]+\/\.s\.PGSQL\.5432$/)
    return match ? [{ socket, kind: match[1] === '.' ? 'temporary' : 'final' }] : []
  })
}

function errorCode(error) { return typeof error?.code === 'string' ? error.code : 'CLIENT_ERROR' }

async function probeSocket(socket, password) {
  const options = { host: path.dirname(socket), port: 5432, database: 'postgres', user: 'supabase_admin', connectionTimeoutMillis: 1200, query_timeout: 1200, application_name: 'opensport-startup-auth-audit' }
  const correct = new pg.Client({ ...options, password })
  try {
    await correct.connect()
    await correct.query('BEGIN READ ONLY')
    const identity = await correct.query('SELECT current_user AS role')
    assert.equal(identity.rows[0]?.role, 'supabase_admin', 'The owned startup socket authenticated an unexpected role')
    const hba = (await correct.query('SELECT auth_method, error IS NOT NULL AS invalid FROM pg_hba_file_rules')).rows
    assert.ok(hba.length > 0 && hba.every(rule => !rule.invalid && rule.auth_method === 'scram-sha-256'), 'An owned PostgreSQL startup socket permitted a non-SCRAM authentication method')
    await correct.query('ROLLBACK')
  } catch (error) {
    if (transient.has(errorCode(error)) && error.name !== 'AssertionError') return false
    throw new Error('The startup monitor could not verify the configured database credential and SCRAM rules.')
  } finally { await correct.end().catch(() => {}) }

  for (const invalid of [`opensport-startup-invalid-${randomBytes(32).toString('hex')}`, 'postgres']) {
    const client = new pg.Client({ ...options, password: invalid })
    let accepted = false
    try { await client.connect(); accepted = true }
    catch (error) {
      if (authenticationDenied.has(errorCode(error))) continue
      if (transient.has(errorCode(error))) return false
      throw new Error('The startup authentication rejection probe could not complete.')
    } finally { await client.end().catch(() => {}) }
    if (accepted) throw new Error('An owned PostgreSQL startup socket accepted an incorrect or public-default password.')
  }
  return true
}

export async function startNativeAuthenticationMonitor({ dataDir, requireTemporary, timeoutMs = 25 * 60 * 1000 }) {
  const root = await realpath(dataDir)
  const context = await realpath('.context')
  if (!root.startsWith(`${context}${path.sep}`)) throw new Error('The startup monitor only accepts a disposable .context fixture.')
  const cacheRoot = path.join(root, 'runtime/home/cache')
  const startedAt = performance.now()
  let stopped = false, problem
  const observed = new Map()
  const task = (async () => {
    while (!stopped) {
      if (performance.now() - startedAt > timeoutMs) throw new Error('The native startup authentication monitor timed out.')
      const processList = await execute('/bin/ps', ['-ww', '-Ao', 'pid=,comm='], { timeout: 2000, maxBuffer: 4 * 1024 * 1024 })
      for (const pid of ownedPostgresPids(processList.stdout, cacheRoot)) {
        let sockets
        try { sockets = await execute('/usr/sbin/lsof', ['-nP', '-a', '-p', String(pid), '-U', '-Fn'], { timeout: 2000, maxBuffer: 1024 * 1024 }) }
        catch (error) { if (error.code === 1) continue; throw new Error('The monitor could not inspect an owned PostgreSQL socket.') }
        for (const { socket, kind } of postgresSocketPaths(sockets.stdout)) {
          const identity = `${pid}:${socket}`
          if (observed.has(identity)) continue
          const secrets = JSON.parse(await readFile(path.join(root, 'runtime/secrets.json'), 'utf8'))
          const password = secrets.OPENSPORT_NATIVE_DATABASE_PASSWORD
          if (!/^[a-f0-9]{64}$/.test(password)) throw new Error('The startup test fixture has no installation database credential.')
          if (await probeSocket(socket, password)) observed.set(identity, { pid, kind, observedAt: performance.now(), validCredential: true, rejectedPasswords: 2 })
        }
      }
      await pause(75)
    }
  })().catch(error => { problem = error })
  return {
    async finish({ readyAt = performance.now() } = {}) {
      stopped = true
      await task
      if (problem) throw problem
      const beforeReady = [...observed.values()].filter(observation => observation.observedAt < readyAt)
      assert.ok(beforeReady.some(observation => observation.kind === 'final'), 'The monitor missed authenticated rejections on the final server before readiness; this is not a pass')
      if (requireTemporary) assert.ok(beforeReady.some(observation => observation.kind === 'temporary'), 'The monitor missed authenticated rejections on the temporary bootstrap server before readiness; this is not a pass')
      return { temporaryObserved: beforeReady.some(observation => observation.kind === 'temporary'), finalObserved: true, servers: beforeReady.map(({ pid, kind, validCredential, rejectedPasswords }) => ({ pid, kind, validCredential, rejectedPasswords })) }
    },
    async stop() { stopped = true; await task },
  }
}
