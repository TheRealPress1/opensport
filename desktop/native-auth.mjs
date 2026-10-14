// Main-process only. The inspection returns authentication facts, never
// connection strings, passwords, password verifiers, or raw database errors.
import { randomBytes } from 'node:crypto'
import pg from 'pg'

const FAILURE = 'OpenSport could not verify private database authentication. The local server has been stopped.'
const INCOMPLETE = 'OpenSport could not complete its private database authentication check.'
const denied = new Set(['28P01', '28000'])
const connectionOptions = { connectionTimeoutMillis: 5000, query_timeout: 5000 }

function endpointFor(dbUrl) {
  try {
    const endpoint = new URL(dbUrl)
    if (!['postgres:', 'postgresql:'].includes(endpoint.protocol)
      || !['127.0.0.1', 'localhost', '[::1]'].includes(endpoint.hostname)
      || !endpoint.password || !endpoint.port || endpoint.search || endpoint.hash) throw new Error()
    return endpoint
  } catch { throw new Error(INCOMPLETE) }
}

function errorCode(error) {
  return /^[A-Z0-9]{5}$/.test(error?.code || '') ? error.code : 'CLIENT_ERROR'
}

export async function inspectNativeDatabaseAuthentication(dbUrl, { Client = pg.Client } = {}) {
  const endpoint = endpointFor(dbUrl)
  const adminEndpoint = new URL(endpoint)
  adminEndpoint.username = 'supabase_admin'
  const administrator = new Client({ ...connectionOptions, connectionString: adminEndpoint.toString() })
  let roles, hbaRules
  try {
    await administrator.connect()
    await administrator.query('BEGIN READ ONLY')
    const identity = await administrator.query('SELECT current_user AS role')
    if (identity.rows[0]?.role !== 'supabase_admin') throw new Error(INCOMPLETE)
    // Inspect verifier format inside PostgreSQL; no verifier leaves the DB.
    roles = (await administrator.query("SELECT rolname AS role, rolsuper AS superuser, CASE WHEN rolpassword IS NULL THEN 'none' WHEN rolpassword LIKE 'SCRAM-SHA-256$%' THEN 'scram' ELSE 'other' END AS password_format FROM pg_authid WHERE rolcanlogin ORDER BY rolname")).rows
    hbaRules = (await administrator.query('SELECT type, database, user_name, address, auth_method, error IS NOT NULL AS invalid FROM pg_hba_file_rules ORDER BY line_number')).rows
    await administrator.query('ROLLBACK')
    if (!roles.some(role => role.role === 'supabase_admin' && role.superuser)) throw new Error(INCOMPLETE)
  } catch { throw new Error(INCOMPLETE) }
  finally { await administrator.end().catch(() => {}) }

  const incorrect = `opensport-incorrect-${randomBytes(32).toString('hex')}`
  let unknownRole = 'opensport_nonexistent_audit_role'
  while (roles.some(role => role.role === unknownRole)) unknownRole = `opensport_unknown_${randomBytes(12).toString('hex')}`
  const cases = [
    ...roles.flatMap(({ role }) => [
      { role, probeKind: 'incorrect-password', password: incorrect },
      // The public upstream development default must fail independently of
      // random-password probes; SCRAM alone does not make that value private.
      { role, probeKind: 'public-development-default', password: 'postgres' },
    ]),
    { role: unknownRole, probeKind: 'unknown-role', password: incorrect },
  ]
  const probes = []
  for (const { role, probeKind, password } of cases) {
    const client = new Client({
      ...connectionOptions, host: endpoint.hostname === '[::1]' ? '::1' : endpoint.hostname,
      port: Number(endpoint.port), database: decodeURIComponent(endpoint.pathname.slice(1)), user: role, password,
    })
    let connected = false
    try {
      await client.connect()
      connected = true
      await client.query('BEGIN READ ONLY')
      await client.query('SELECT current_user')
      await client.query('ROLLBACK')
      probes.push({ role, probeKind, passwordAccepted: true })
    } catch (error) {
      const code = errorCode(error)
      // Connection failures/timeouts do not prove credential rejection.
      if (!connected && !denied.has(code)) throw new Error(INCOMPLETE)
      probes.push({ role, probeKind, passwordAccepted: connected, code })
    } finally { await client.end().catch(() => {}) }
  }
  return {
    validCredentialsAuthenticated: true,
    productionDatabaseAuthenticationPassed: hbaRules.length > 0
      && hbaRules.every(rule => !rule.invalid && rule.auth_method === 'scram-sha-256')
      && roles.every(role => role.password_format === 'none' || role.password_format === 'scram')
      && probes.every(probe => !probe.passwordAccepted),
    roles, hbaRules, probes,
  }
}

export async function assertNativeDatabaseAuthentication(dbUrl, options) {
  let report
  try { report = await inspectNativeDatabaseAuthentication(dbUrl, options) } catch { throw new Error(FAILURE) }
  if (!report.productionDatabaseAuthenticationPassed) throw new Error(FAILURE)
  return report
}
