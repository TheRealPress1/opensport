import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash, randomBytes } from 'node:crypto'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { NativeRuntime } from '../native-runtime.mjs'
import { NATIVE_CLI_VERSION, NATIVE_SECURITY_PROFILE, validNativeSecrets } from '../native-profile.mjs'

const newSecrets = () => ({
  OPENSPORT_NATIVE_DATABASE_PASSWORD: randomBytes(32).toString('hex'),
  OPENSPORT_NATIVE_POSTGRES_ROOT_KEY: randomBytes(32).toString('hex'),
  OPENSPORT_NATIVE_JWT_SECRET: randomBytes(32).toString('hex'),
  OPENSPORT_NATIVE_SECRET_KEY: `sb_secret_${randomBytes(32).toString('base64url')}`,
  OPENSPORT_NATIVE_PUBLISHABLE_KEY: `sb_publishable_${randomBytes(32).toString('base64url')}`,
})
async function fixture(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'opensport-profile-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const runtime = new NativeRuntime({ dataDir: path.join(root, 'team'), resourcesDir: path.join(root, 'resources') })
  await mkdir(runtime.root, { recursive: true })
  return runtime
}

test('database credential validation rejects public defaults, missing fields and coerced nonstrings', () => {
  const secrets = newSecrets()
  assert.ok(validNativeSecrets(secrets))
  for (const invalid of ['postgres', '', null, [secrets.OPENSPORT_NATIVE_DATABASE_PASSWORD]]) {
    assert.ok(!validNativeSecrets({ ...secrets, OPENSPORT_NATIVE_DATABASE_PASSWORD: invalid }))
  }
  assert.ok(!validNativeSecrets({ ...secrets, ignored: 'unexpected' }))
  delete secrets.OPENSPORT_NATIVE_POSTGRES_ROOT_KEY
  assert.ok(!validNativeSecrets(secrets))
})

test('legacy and damaged profiles are blocked without changing saved files', async t => {
  const runtime = await fixture(t)
  assert.deepEqual(await runtime.compatibility(), { supported: true })
  const saved = JSON.stringify({ format: 1, cliVersion: NATIVE_CLI_VERSION, stackId: 'a'.repeat(64), dataRoot: runtime.dataDir })
  await writeFile(runtime.manifestPath, saved)
  const legacy = await runtime.compatibility()
  assert.equal(legacy.supported, false)
  assert.equal(legacy.reason, 'legacy-preview')
  assert.equal(await readFile(runtime.manifestPath, 'utf8'), saved)
  await writeFile(runtime.manifestPath, '{ damaged')
  assert.equal((await runtime.compatibility()).reason, 'invalid-state')
  assert.equal(await readFile(runtime.manifestPath, 'utf8'), '{ damaged')
})

test('a protected saved stack requires its complete credentials; relocated backups are supported', async t => {
  const runtime = await fixture(t)
  await writeFile(runtime.manifestPath, JSON.stringify({ format: 2, securityProfile: NATIVE_SECURITY_PROFILE, cliVersion: NATIVE_CLI_VERSION, stackId: 'a'.repeat(64), dataRoot: path.join(os.tmpdir(), 'previous team') }))
  assert.equal((await runtime.compatibility()).supported, false)
  await writeFile(path.join(runtime.root, 'secrets.json'), JSON.stringify(newSecrets()))
  assert.deepEqual(await runtime.compatibility(), { supported: true })
})

test('launcher verification rejects replaced binaries and false build identities before executing them', async t => {
  const runtime = await fixture(t)
  await mkdir(path.dirname(runtime.cliPath), { recursive: true })
  const binary = 'synthetic test launcher; never executed'
  const identity = { buildId: NATIVE_SECURITY_PROFILE, upstreamVersion: NATIVE_CLI_VERSION, upstreamCommit: 'b'.repeat(40), patchSha256: 'c'.repeat(64) }
  const built = { ...identity, binarySha256: createHash('sha256').update(binary).digest('hex') }
  await writeFile(runtime.cliPath, binary)
  await writeFile(path.join(runtime.resourcesDir, 'native', 'opensport-build.json'), JSON.stringify(built))
  await writeFile(path.join(runtime.resourcesDir, 'runtime-lock.json'), JSON.stringify({ sourceBuild: { buildId: identity.buildId, commit: identity.upstreamCommit, patchSha256: identity.patchSha256 } }))
  let executed = 0
  runtime.run = async args => { assert.deepEqual(args, ['--opensport-build-info']); executed++; return JSON.stringify(identity) }
  await runtime.verifyLauncher()
  assert.equal(executed, 1)
  assert.equal(runtime.launcherVerified, true)
  await writeFile(runtime.cliPath, 'replaced')
  await assert.rejects(runtime.verifyLauncher(), /launcher has changed/)
  assert.equal(runtime.launcherVerified, false)
  assert.equal(executed, 1)
  runtime.manifest = { stackId: 'a'.repeat(64) }
  await assert.rejects(runtime.stopInternal(), /launcher has changed/)
  assert.equal(executed, 1, 'Cleanup must not execute a previously rejected binary')
  await writeFile(runtime.cliPath, binary)
  runtime.run = async () => JSON.stringify({ ...identity, buildId: 'unprotected' })
  await assert.rejects(runtime.verifyLauncher(), /unsupported database protection/)
})

test('startup failure always attempts owned cleanup and does not claim a failed shutdown succeeded', async t => {
  const runtime = await fixture(t)
  const failure = new Error('Synthetic invalid startup response')
  let stopped = 0
  runtime.startInternal = async () => { throw failure }
  runtime.stopInternal = async () => { stopped++ }
  await assert.rejects(runtime.start({ publicUrl: 'http://127.0.0.1:18991' }), error => error === failure)
  assert.equal(stopped, 1)
  assert.equal(runtime.operation, null)
  assert.equal(runtime.phase, 'error')
  runtime.stopInternal = async () => { throw new Error('Synthetic shutdown failure') }
  await assert.rejects(runtime.start({ publicUrl: 'http://127.0.0.1:18991' }), /could not start or confirm that its local server stopped/)
})

async function savedPrepareFixture(t) {
  const runtime = await fixture(t)
  const original = new Map([
    [path.join(runtime.projectDir, 'supabase/functions/previous.ts'), 'previous function'],
    [path.join(runtime.projectDir, 'supabase/migrations/previous.sql'), 'previous migration'],
    [path.join(runtime.projectDir, 'supabase/config.toml'), 'previous project config'],
    [path.join(runtime.projectDir, '.env'), 'previous environment'],
    [runtime.manifestPath, JSON.stringify({ format: 2, securityProfile: NATIVE_SECURITY_PROFILE, cliVersion: NATIVE_CLI_VERSION, stackId: 'a'.repeat(64), dataRoot: runtime.dataDir })],
    [path.join(runtime.root, 'secrets.json'), JSON.stringify(newSecrets())],
  ])
  for (const [file, content] of original) {
    await mkdir(path.dirname(file), { recursive: true })
    await writeFile(file, content)
  }
  await mkdir(path.dirname(runtime.cliPath), { recursive: true })
  await writeFile(runtime.cliPath, 'not executed')
  for (const [directory, file] of [['functions', 'current.ts'], ['migrations', 'current.sql']]) {
    const destination = path.join(runtime.resourcesDir, 'supabase', directory, file)
    await mkdir(path.dirname(destination), { recursive: true })
    await writeFile(destination, 'current bundled source')
  }
  runtime.verifyLauncher = async () => {}
  runtime.run = async args => { assert.deepEqual(args, ['--version']); return NATIVE_CLI_VERSION }
  const unchanged = async () => {
    for (const [file, content] of original) assert.equal(await readFile(file, 'utf8'), content, `File changed before stopping: ${path.basename(file)}`)
  }
  return { runtime, unchanged, original }
}

const supportsNativePrepare = process.platform === 'darwin' && process.arch === 'arm64' && Number(os.release().split('.')[0]) >= 23

test('saved daemon stops before functions, migrations, config, or credentials are rewritten', { skip: !supportsNativePrepare }, async t => {
  const { runtime, unchanged, original } = await savedPrepareFixture(t)
  let stopped = false
  runtime.stopInternal = async () => { await unchanged(); stopped = true }
  await runtime.prepare('http://127.0.0.1:18991')
  assert.equal(stopped, true)
  assert.equal(await readFile(path.join(runtime.projectDir, 'supabase/functions/current.ts'), 'utf8'), 'current bundled source')
  assert.match(await readFile(path.join(runtime.projectDir, 'supabase/config.toml'), 'utf8'), /http:\/\/127\.0\.0\.1:18991/)
  assert.equal(await readFile(path.join(runtime.root, 'secrets.json'), 'utf8'), original.get(path.join(runtime.root, 'secrets.json')), 'Restart retains the installation credentials')
})

test('failed owned-daemon stop aborts preparation without rewriting saved files', { skip: !supportsNativePrepare }, async t => {
  const { runtime, unchanged } = await savedPrepareFixture(t)
  runtime.stopInternal = async () => { throw new Error('Synthetic owned-daemon stop failure') }
  await assert.rejects(runtime.prepare('http://127.0.0.1:18991'), /owned-daemon stop failure/)
  await unchanged()
})

test('cold shell reclamation stops a legacy stack without starting it or requiring old credentials', async t => {
  const runtime = await fixture(t)
  const legacy = JSON.stringify({ format: 1, cliVersion: NATIVE_CLI_VERSION, stackId: 'a'.repeat(64), dataRoot: runtime.dataDir })
  await writeFile(runtime.manifestPath, legacy)
  const calls = []
  runtime.verifyLauncher = async () => { calls.push('verify') }
  runtime.run = async args => { calls.push(args) }
  await runtime.stop()
  assert.deepEqual(calls, ['verify', ['stack', 'stop', '--stack-id', 'a'.repeat(64), '--output-format', 'json', '--workdir', runtime.projectDir]])
  assert.equal(runtime.status().running, false)
  assert.equal(runtime.status().phase, 'stopped')
  assert.equal(await readFile(runtime.manifestPath, 'utf8'), legacy)
  assert.equal(runtime.secrets, undefined)
  assert.equal(Object.keys(runtime.environment()).some(name => name.startsWith('OPENSPORT_NATIVE_')), false)

  runtime.run = async () => { throw new Error('Synthetic reclamation failure') }
  await assert.rejects(runtime.stop(), /reclamation failure/)
  assert.notEqual(runtime.status().phase, 'stopped', 'A failed reclamation cannot report a confirmed stop')
})
