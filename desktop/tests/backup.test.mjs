import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, readdir, readlink, rm, stat, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { gunzipSync, gzipSync } from 'node:zlib'
import { createHash } from 'node:crypto'
import { createBackup, restoreBackup, NATIVE_BACKUP_VERSION } from '../backup.mjs'
import { NATIVE_CLI_VERSION, NATIVE_MANIFEST_FORMAT, NATIVE_SECURITY_PROFILE } from '../native-profile.mjs'

const fixtureSecrets = {
  OPENSPORT_NATIVE_JWT_SECRET: 'a'.repeat(64),
  OPENSPORT_NATIVE_SECRET_KEY: `sb_secret_${'s'.repeat(43)}`,
  OPENSPORT_NATIVE_PUBLISHABLE_KEY: `sb_publishable_${'p'.repeat(43)}`,
  OPENSPORT_NATIVE_DATABASE_PASSWORD: 'b'.repeat(64),
  OPENSPORT_NATIVE_POSTGRES_ROOT_KEY: 'c'.repeat(64),
}

async function fixture(t) {
  const parent = await mkdtemp(join(tmpdir(), 'opensport-native-backup-'))
  t.after(() => rm(parent, { recursive: true, force: true }))
  const source = join(parent, 'source'); const target = join(parent, 'target'); const archive = join(parent, 'team.opensport')
  await mkdir(join(source, 'runtime', 'home', 'stacks', 'one', 'data', 'empty'), { recursive: true })
  await mkdir(join(source, 'runtime', 'home', 'cache'), { recursive: true })
  await mkdir(join(source, 'runtime', 'project', 'supabase', '.temp', 'stack-uploads', 'one'), { recursive: true })
  await mkdir(join(source, 'window'), { recursive: true })
  await writeFile(join(source, 'team-setup.json'), JSON.stringify({ format: 1, phase: 'complete', email: 'owner@example.test', nonce: 'checkpoint', team: { name: 'Harbor' } }), { mode: 0o600 })
  await writeFile(join(source, 'desktop.json'), JSON.stringify({ port: 18888 }), { mode: 0o600 })
  await writeFile(join(source, 'runtime', 'secrets.json'), JSON.stringify(fixtureSecrets), { mode: 0o600 })
  await writeFile(join(source, 'runtime', 'manifest.json'), JSON.stringify({ format: NATIVE_MANIFEST_FORMAT, securityProfile: NATIVE_SECURITY_PROFILE, cliVersion: NATIVE_CLI_VERSION, stackId: 'd'.repeat(64), dataRoot: source, localOnly: true }), { mode: 0o600 })
  await writeFile(join(source, 'runtime', 'home', 'stacks', 'one', 'data', 'auth.db'), Buffer.alloc(150000, 13), { mode: 0o600 })
  await writeFile(join(source, 'runtime', 'project', 'supabase', '.temp', 'stack-uploads', 'one', 'avatar.png'), Buffer.from([0, 1, 255, 128, 7]))
  await writeFile(join(source, 'runtime', 'home', 'cache', 'download.bin'), 'Exclude replaceable cache')
  await writeFile(join(source, 'window', 'session'), 'Exclude Electron state')
  await writeFile(join(source, 'runtime', 'native-diagnostics.log'), 'Exclude diagnostics')
  await writeFile(join(source, 'runtime', 'home', 'stacks', 'one', 'owner.json'), '{}')
  await writeFile(join(source, 'runtime', 'home', 'stacks', 'one', 'data', 'postmaster.pid'), '0')
  await symlink('auth.db', join(source, 'runtime', 'home', 'stacks', 'one', 'data', 'internal-link'))
  await mkdir(target)
  return { parent, source, target, archive }
}

// Rewrite test archives with valid TAR and record checksums. This ensures the
// compatibility checks reject unsupported payloads, not merely corrupt bytes.
async function rewriteArchive(archive, change) {
  const bytes = gunzipSync(await readFile(archive))
  const entries = []
  for (let offset = 0; !bytes.subarray(offset, offset + 512).every(byte => byte === 0);) {
    const header = Buffer.from(bytes.subarray(offset, offset + 512))
    const field = (start, length) => header.toString('utf8', start, start + length).replace(/\0.*$/su, '')
    const size = Number.parseInt(field(124, 12).trim(), 8)
    const prefix = field(345, 155)
    entries.push({ name: `${prefix ? `${prefix}/` : ''}${field(0, 100)}`, header, body: Buffer.from(bytes.subarray(offset + 512, offset + 512 + size)) })
    offset += 512 + Math.ceil(size / 512) * 512
  }
  const manifest = JSON.parse(entries[0].body.toString())
  const payload = new Map(entries.slice(1).map(entry => [entry.name.replace(/^payload\//, ''), entry]))
  change(manifest, payload)
  for (const file of manifest.files) if (file.type === 'file' && payload.has(file.path)) {
    const body = payload.get(file.path).body
    file.size = body.length
    file.sha256 = createHash('sha256').update(body).digest('hex')
  }
  entries[0].body = Buffer.from(JSON.stringify(manifest))
  const output = []
  for (const entry of entries) {
    if (entry.removed) continue
    entry.header.write(entry.body.length.toString(8).padStart(11, '0') + '\0', 124, 12)
    entry.header.fill(32, 148, 156)
    entry.header.write(entry.header.reduce((sum, byte) => sum + byte, 0).toString(8).padStart(6, '0') + '\0 ', 148, 8)
    output.push(entry.header, entry.body)
    if (entry.body.length % 512) output.push(Buffer.alloc(512 - entry.body.length % 512))
  }
  output.push(Buffer.alloc(1024))
  await writeFile(archive, gzipSync(Buffer.concat(output)))
}

function updatePayloadJson(payload, name, change) {
  const entry = payload.get(name)
  const value = JSON.parse(entry.body.toString())
  change(value)
  entry.body = Buffer.from(JSON.stringify(value))
}

async function assertUntouchedRestore(f, pattern) {
  await writeFile(join(f.target, 'desktop.json'), 'Original preferences')
  await assert.rejects(restoreBackup({ dataDir: f.target, archivePath: f.archive }), pattern)
  assert.deepEqual(await readdir(f.target), ['desktop.json'])
  assert.equal(await readFile(join(f.target, 'desktop.json'), 'utf8'), 'Original preferences')
  assert.ok(!(await readdir(f.parent)).some(name => name.startsWith('.opensport-restore-')))
}

test('cold native snapshot restores exact records, avatar bytes, private secrets, empty directories, and internal links to a fresh path', async t => {
  const f = await fixture(t)
  const result = await createBackup({ dataDir: f.source, archivePath: f.archive })
  assert.equal(result.path, f.archive)
  assert.equal((await stat(f.archive)).mode & 0o777, 0o600)
  await mkdir(join(f.target, 'window')); await writeFile(join(f.target, 'window', 'open-session'), 'Keep existing window')
  await mkdir(join(f.target, 'runtime')) // NativeRuntime.stop on a fresh install may create this empty directory.
  await writeFile(join(f.target, 'desktop.json'), '{}')
  const restored = await restoreBackup({ dataDir: f.target, archivePath: f.archive })
  assert.equal(restored.restored, true)
  assert.equal(restored.originalRoot, f.source)
  for (const name of ['runtime/manifest.json', 'runtime/secrets.json', 'runtime/home/stacks/one/data/auth.db', 'runtime/project/supabase/.temp/stack-uploads/one/avatar.png', 'team-setup.json', 'desktop.json']) assert.deepEqual(await readFile(join(f.target, name)), await readFile(join(f.source, name)))
  assert.equal((await stat(join(f.target, 'runtime', 'secrets.json'))).mode & 0o777, 0o600)
  assert.deepEqual(await readdir(join(f.target, 'runtime', 'home', 'stacks', 'one', 'data', 'empty')), [])
  assert.equal(await readlink(join(f.target, 'runtime', 'home', 'stacks', 'one', 'data', 'internal-link')), 'auth.db')
  assert.equal(await readFile(join(f.target, 'window', 'open-session'), 'utf8'), 'Keep existing window')
  for (const name of ['runtime/home/cache', 'runtime/native-diagnostics.log', 'runtime/home/stacks/one/owner.json', 'runtime/home/stacks/one/data/postmaster.pid']) await assert.rejects(stat(join(f.target, name)), { code: 'ENOENT' })
  const manifest = JSON.parse(await readFile(join(f.target, '.opensport-backup.json'), 'utf8'))
  assert.equal(manifest.originalRoot, f.source)
  assert.equal(manifest.cliVersion, '2.120.0')
  assert.equal(manifest.version, NATIVE_BACKUP_VERSION)
  assert.equal(manifest.securityProfile, NATIVE_SECURITY_PROFILE)
})

test('restore refuses existing team or native database without changing it', async t => {
  const f = await fixture(t)
  await createBackup({ dataDir: f.source, archivePath: f.archive })
  await mkdir(join(f.target, 'runtime')); await writeFile(join(f.target, 'runtime', 'existing-record'), 'Preserve this team')
  await assert.rejects(restoreBackup({ dataDir: f.target, archivePath: f.archive }), /fresh installation/)
  assert.equal(await readFile(join(f.target, 'runtime', 'existing-record'), 'utf8'), 'Preserve this team')
  await assert.rejects(restoreBackup({ dataDir: f.source, archivePath: f.archive }), /fresh installation/)
})

test('corrupted record data fails checksum validation before target state changes', async t => {
  const f = await fixture(t)
  await createBackup({ dataDir: f.source, archivePath: f.archive })
  const unpacked = gunzipSync(await readFile(f.archive))
  const content = unpacked.indexOf(fixtureSecrets.OPENSPORT_NATIVE_DATABASE_PASSWORD)
  assert.ok(content > 0)
  unpacked[content] ^= 1
  await writeFile(f.archive, gzipSync(unpacked))
  await writeFile(join(f.target, 'desktop.json'), 'Original preferences')
  await assert.rejects(restoreBackup({ dataDir: f.target, archivePath: f.archive }), /checksum/)
  assert.deepEqual(await readdir(f.target), ['desktop.json'])
  assert.equal(await readFile(join(f.target, 'desktop.json'), 'utf8'), 'Original preferences')
  assert.ok(!(await readdir(f.parent)).some(name => name.startsWith('.opensport-restore-')))
})

test('unsafe archive path is rejected before extraction and backup excludes no outside files', async t => {
  const f = await fixture(t)
  await createBackup({ dataDir: f.source, archivePath: f.archive })
  const unpacked = gunzipSync(await readFile(f.archive))
  unpacked.fill(0, 0, 100); unpacked.write('../outside.txt', 0)
  unpacked.fill(32, 148, 156)
  const sum = unpacked.subarray(0, 512).reduce((total, value) => total + value, 0)
  unpacked.write(sum.toString(8).padStart(6, '0') + '\0 ', 148, 8)
  await writeFile(f.archive, gzipSync(unpacked))
  await assert.rejects(restoreBackup({ dataDir: f.target, archivePath: f.archive }), /unsafe file entry/)
  await assert.rejects(stat(join(f.parent, 'outside.txt')), { code: 'ENOENT' })
  assert.deepEqual(await readdir(f.target), [])
  await symlink(join(f.parent, 'outside'), join(f.source, 'runtime', 'external-link'))
  await assert.rejects(createBackup({ dataDir: f.source, archivePath: f.archive }), /outside its private directory/)
})

test('snapshot requires complete setup and a destination outside live private state', async t => {
  const f = await fixture(t)
  await assert.rejects(createBackup({ dataDir: f.source, archivePath: join(f.source, 'team.opensport') }), /outside the private team directory/)
  await writeFile(join(f.source, 'team-setup.json'), JSON.stringify({ phase: 'owner-created' }))
  await assert.rejects(createBackup({ dataDir: f.source, archivePath: f.archive }), /Create your team/)
  await assert.rejects(stat(f.archive), { code: 'ENOENT' })
})

test('legacy backup headers are rejected without importing files', async t => {
  const f = await fixture(t)
  await createBackup({ dataDir: f.source, archivePath: f.archive })
  await rewriteArchive(f.archive, manifest => { manifest.version = 1; delete manifest.securityProfile })
  await assertUntouchedRestore(f, /older Mac preview.*files have not been changed/)
})

test('a current backup header requires the supported security profile', async t => {
  const f = await fixture(t)
  await createBackup({ dataDir: f.source, archivePath: f.archive })
  await rewriteArchive(f.archive, manifest => { delete manifest.securityProfile })
  await assertUntouchedRestore(f, /unsupported.*security profile.*files have not been changed/)
})

test('a relabeled legacy runtime is rejected even with valid archive checksums', async t => {
  const f = await fixture(t)
  await createBackup({ dataDir: f.source, archivePath: f.archive })
  await rewriteArchive(f.archive, (_manifest, payload) => updatePayloadJson(payload, 'runtime/manifest.json', runtime => { runtime.format = 1; delete runtime.securityProfile }))
  await assertUntouchedRestore(f, /older Mac preview.*files have not been changed/)
})

test('missing, malformed, and unexpected database credentials are rejected before installation', async t => {
  for (const [label, change] of [
    ['missing database password', secrets => { delete secrets.OPENSPORT_NATIVE_DATABASE_PASSWORD }],
    ['development password', secrets => { secrets.OPENSPORT_NATIVE_DATABASE_PASSWORD = 'postgres' }],
    ['missing root key', secrets => { delete secrets.OPENSPORT_NATIVE_POSTGRES_ROOT_KEY }],
    ['non-string credential', secrets => { secrets.OPENSPORT_NATIVE_DATABASE_PASSWORD = [fixtureSecrets.OPENSPORT_NATIVE_DATABASE_PASSWORD] }],
    ['unexpected credential', secrets => { secrets.extra = 'unexpected' }],
  ]) await t.test(label, async subtest => {
    const f = await fixture(subtest)
    await createBackup({ dataDir: f.source, archivePath: f.archive })
    await rewriteArchive(f.archive, (_manifest, payload) => updatePayloadJson(payload, 'runtime/secrets.json', change))
    await assertUntouchedRestore(f, /valid private database credentials.*files have not been changed/)
  })
})

test('a missing runtime security record is rejected before extraction', async t => {
  const f = await fixture(t)
  await createBackup({ dataDir: f.source, archivePath: f.archive })
  await rewriteArchive(f.archive, (manifest, payload) => {
    manifest.files = manifest.files.filter(file => file.path !== 'runtime/manifest.json')
    payload.get('runtime/manifest.json').removed = true
  })
  await assertUntouchedRestore(f, /missing.*security records.*files have not been changed/)
})

test('unreadable security records fail without exposing their contents', async t => {
  const f = await fixture(t)
  await createBackup({ dataDir: f.source, archivePath: f.archive })
  const privateContents = 'PRIVATE-SYNTHETIC-CREDENTIAL-CONTENTS'
  await rewriteArchive(f.archive, (_manifest, payload) => { payload.get('runtime/secrets.json').body = Buffer.from(privateContents) })
  await assertUntouchedRestore(f, error => /unreadable.*security records.*files have not been changed/.test(error.message) && !error.message.includes(privateContents))
})

test('creating a backup refuses legacy source state and preserves an existing archive', async t => {
  const f = await fixture(t)
  await writeFile(f.archive, 'Keep previous backup')
  const file = join(f.source, 'runtime/manifest.json')
  const legacy = JSON.stringify({ format: 1, cliVersion: NATIVE_CLI_VERSION, stackId: 'd'.repeat(64), dataRoot: f.source })
  await writeFile(file, legacy)
  await assert.rejects(createBackup({ dataDir: f.source, archivePath: f.archive }), /older Mac preview.*files have not been changed/)
  assert.equal(await readFile(file, 'utf8'), legacy)
  assert.equal(await readFile(f.archive, 'utf8'), 'Keep previous backup')
  assert.ok(!(await readdir(f.parent)).some(name => name.startsWith('.opensport-backup-')))
})
