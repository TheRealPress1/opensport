import test from 'node:test'
import assert from 'node:assert/strict'
import { assertNativeDatabaseAuthentication, inspectNativeDatabaseAuthentication } from '../native-auth.mjs'

const url = 'postgresql://postgres:private-test-credential@127.0.0.1:15432/postgres'
const roles = [
  { role: 'supabase_admin', superuser: true, password_format: 'scram' },
  { role: 'pgbouncer', superuser: false, password_format: 'scram' },
  { role: 'custom_login_without_password', superuser: false, password_format: 'none' },
]
const hba = [{ type: 'local', database: ['all'], user_name: ['all'], address: null, auth_method: 'scram-sha-256', invalid: false }]

function database({ inventory = roles, rules = hba, accept = () => false, failure, queryFailure = false } = {}) {
  const calls = []
  const closed = []
  class Client {
    constructor(options) { this.options = options; calls.push(options) }
    async connect() {
      if (failure) throw Object.assign(new Error('sensitive upstream diagnostic'), { code: failure })
      if (!this.options.connectionString && !accept(this.options)) throw Object.assign(new Error('password refused'), { code: '28P01' })
    }
    async query(sql) {
      if (!this.options.connectionString && queryFailure) throw Object.assign(new Error('private relation error'), { code: '42501' })
      if (sql.includes('pg_authid')) return { rows: inventory }
      if (sql.includes('pg_hba_file_rules')) return { rows: rules }
      return { rows: [{ role: 'supabase_admin' }] }
    }
    async end() { closed.push(this) }
  }
  return { Client, calls, closed }
}

test('audit checks every LOGIN role, null-password roles and the unknown role without returning credentials', async () => {
  const db = database()
  const result = await assertNativeDatabaseAuthentication(url, db)
  assert.equal(result.productionDatabaseAuthenticationPassed, true)
  assert.equal(result.validCredentialsAuthenticated, true)
  assert.equal(result.probes.length, roles.length * 2 + 1)
  for (const role of roles) assert.equal(result.probes.filter(probe => probe.role === role.role).length, 2)
  assert.equal(result.probes.at(-1).probeKind, 'unknown-role')
  assert.equal(db.closed.length, db.calls.length)
  const serialized = JSON.stringify(result)
  assert.ok(!serialized.includes('private-test-credential'))
  assert.ok(!serialized.includes('connectionString'))
  assert.ok(!serialized.includes('rolpassword'))
})

test('successful authentication fails acceptance even when the subsequent read is forbidden', async () => {
  const db = database({ accept: options => options.user === 'pgbouncer' && options.password === 'postgres', queryFailure: true })
  const result = await inspectNativeDatabaseAuthentication(url, db)
  assert.equal(result.productionDatabaseAuthenticationPassed, false)
  const accepted = result.probes.filter(probe => probe.passwordAccepted)
  assert.deepEqual(accepted, [{ role: 'pgbouncer', probeKind: 'public-development-default', passwordAccepted: true, code: '42501' }])
  await assert.rejects(assertNativeDatabaseAuthentication(url, db), /could not verify private database authentication/)
})

test('trust rules, invalid HBA and non-SCRAM stored credentials fail despite rejected negative probes', async () => {
  for (const change of [
    { rules: [{ ...hba[0], auth_method: 'trust' }] },
    { rules: [{ ...hba[0], invalid: true }] },
    { rules: [] },
    { inventory: [...roles, { role: 'other_login', superuser: false, password_format: 'other' }] },
  ]) {
    const result = await inspectNativeDatabaseAuthentication(url, database(change))
    assert.equal(result.productionDatabaseAuthenticationPassed, false)
  }
})

test('network failures are incomplete checks, never authentication rejections, and diagnostics remain private', async () => {
  const db = database()
  const Base = db.Client
  class Client extends Base {
    async connect() {
      if (!this.options.connectionString) throw Object.assign(new Error('sensitive upstream diagnostic'), { code: 'ECONNREFUSED' })
      return super.connect()
    }
  }
  await assert.rejects(inspectNativeDatabaseAuthentication(url, { Client }), error => error.message === 'OpenSport could not complete its private database authentication check.')
  await assert.rejects(assertNativeDatabaseAuthentication(url, database({ failure: '28P01' })), error => error.message === 'OpenSport could not verify private database authentication. The local server has been stopped.')
})

test('audit rejects nonlocal database endpoints before opening any connection', async () => {
  const db = database()
  for (const invalid of ['postgresql://user:password@192.168.1.4:5432/postgres', 'not a database URL', `${url}?host=remote.example`]) {
    await assert.rejects(inspectNativeDatabaseAuthentication(invalid, db), /could not complete/)
  }
  assert.equal(db.calls.length, 0)
})
