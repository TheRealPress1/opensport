// Opt-in security acceptance audit. Exit 2 means the native runtime accepted a
// deliberately incorrect database password; this is a release blocker, not a
// passing regression expectation. Never point this at a real team.
import assert from 'node:assert/strict'
import { readFile, realpath, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { NativeRuntime, NATIVE_CLI_VERSION } from '../native-runtime.mjs'
import { auditNativeListeners } from '../native-isolation.mjs'
import { inspectNativeDatabaseAuthentication } from '../native-auth.mjs'

if (process.env.OPENSPORT_NATIVE_SECURITY_AUDIT !== '1') throw new Error('Set OPENSPORT_NATIVE_SECURITY_AUDIT=1 to run this isolated security audit.')
const requestedDir = process.env.OPENSPORT_NATIVE_TEST_DATA_DIR
if (!requestedDir) throw new Error('Choose an existing disposable native fixture inside .context.')
const dataDir = await realpath(path.resolve(requestedDir))
const contextDir = await realpath('.context')
if (!dataDir.startsWith(`${contextDir}${path.sep}`)) throw new Error('The security audit only accepts a fixture inside this repository’s .context directory.')
const fixture = JSON.parse(await readFile(path.join(dataDir, 'native-test-credentials.json'), 'utf8'))
if (!fixture.email?.endsWith('@example.test')) throw new Error('This directory is not a synthetic native integration fixture.')

const keepRunning = process.env.OPENSPORT_NATIVE_AUDIT_KEEP_RUNNING === '1'
const reuseRunning = process.env.OPENSPORT_NATIVE_AUDIT_REUSE_RUNNING === '1'
if (keepRunning && reuseRunning) throw new Error('Choose either to retain a new audit server or reuse an existing one.')
let release
const shutdown = new Promise(resolve => { release = resolve })
process.once('SIGTERM', () => release())
process.once('SIGINT', () => release())
const runtime = new NativeRuntime({
  dataDir,
  resourcesDir: path.resolve(process.env.OPENSPORT_NATIVE_TEST_RESOURCES || 'desktop/resources'),
  onProgress: ({ phase }) => console.log(`native phase: ${phase}`),
})

try {
  const runtimeFile = path.join(dataDir, 'native-security-audit-runtime.json')
  const config = reuseRunning ? JSON.parse(await readFile(runtimeFile, 'utf8')) : await runtime.start({ publicUrl: 'http://127.0.0.1:18991' })
  for (const value of [config.dbUrl, config.apiUrl]) assert.ok(['127.0.0.1', 'localhost', '[::1]'].includes(new URL(value).hostname), 'Audit endpoints must remain local')
  const manifest = JSON.parse(await readFile(path.join(dataDir, 'runtime/manifest.json'), 'utf8'))
  assert.match(manifest.stackId, /^[a-f0-9]{64}$/)
  const listenerAudit = reuseRunning ? await auditNativeListeners({ homeDir: path.join(dataDir, 'runtime/home'), stackId: manifest.stackId }) : runtime.listenerAudit
  assert.ok(listenerAudit.listeners.every(listener => listener.loopback))
  if (!reuseRunning) await writeFile(runtimeFile, JSON.stringify(config), { mode: 0o600 })
  const authentication = await inspectNativeDatabaseAuthentication(config.dbUrl)
  for (const { role, probeKind, passwordAccepted, code } of authentication.probes) {
    console.log(`${passwordAccepted ? 'UNSAFE: password accepted' : 'rejected'}: ${role}, ${probeKind}${code ? ` (${code})` : ''}`)
  }
  const previous = reuseRunning ? JSON.parse(await readFile(path.join(dataDir, 'native-security-audit.json'), 'utf8')) : null
  const report = {
    createdAt: new Date().toISOString(), cliVersion: NATIVE_CLI_VERSION, runnerPid: previous?.runnerPid || process.pid,
    listenerCount: listenerAudit.listeners.length, allListenersLoopback: true,
    ...authentication,
  }
  await writeFile(path.join(dataDir, 'native-security-audit.json'), JSON.stringify(report, null, 2), { mode: 0o600 })
  console.log(`Database authentication acceptance: ${report.productionDatabaseAuthenticationPassed ? 'PASS' : 'BLOCKED'}.`)
  if (!report.productionDatabaseAuthenticationPassed) process.exitCode = 2
  if (keepRunning) {
    console.log('Synthetic server retained for coordinated browser checks. Send SIGTERM to this audit process after those checks finish.')
    await shutdown
  }
} finally {
  if (!reuseRunning) await runtime.stop()
}
