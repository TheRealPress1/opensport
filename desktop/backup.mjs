// Private, cold native snapshots. The caller must stop NativeRuntime before use.
// Files are staged, hashed, and restored without invoking commands from backups.
import { createHash, randomUUID } from 'node:crypto'
import { createReadStream, createWriteStream } from 'node:fs'
import { chmod, copyFile, lstat, mkdir, mkdtemp, readFile, readdir, readlink, realpath, rename, rm, symlink, writeFile } from 'node:fs/promises'
import { dirname, isAbsolute, join, relative, resolve, sep, posix } from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { createGunzip, createGzip } from 'node:zlib'
import { NATIVE_CLI_VERSION, NATIVE_MANIFEST_FORMAT, NATIVE_SECURITY_PROFILE, validNativeSecrets } from './native-profile.mjs'

export const NATIVE_BACKUP_VERSION = 2
export { NATIVE_CLI_VERSION }
const MANIFEST = '.opensport-backup.json'
const LEGACY_PREVIEW = 'Backups from the older Mac preview are not supported by this version. Your files have not been changed.'
const safeInside = (root, target) => target === root || target.startsWith(root + sep)
const unsafeText = value => [...value].some(character => character === '\\' || character.charCodeAt(0) < 32)
const validName = name => typeof name === 'string' && name.length > 0 && !isAbsolute(name) && !unsafeText(name) && name.split('/').every(part => part && part !== '.' && part !== '..')
const excluded = name => name === 'window' || name.startsWith('window/') || name === 'runtime/home/cache' || name.startsWith('runtime/home/cache/') || name === MANIFEST || /(^|\/)(owner\.json|owner\.lock|owner\.lock-journal|postmaster\.pid)$/u.test(name) || /\.log(?:\.\d+)?$/iu.test(name)
async function hashFile(path) {
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(path)) hash.update(chunk)
  return hash.digest('hex')
}
function validateLink(root, name, target) {
  if (typeof target !== 'string' || !target || isAbsolute(target) || unsafeText(target) || !safeInside(root, resolve(root, dirname(name), target))) throw new Error('A backup link points outside the private team directory.')
}
async function snapshot(root, destination, name = '', files = []) {
  for (const entry of await readdir(join(root, name), { withFileTypes: true })) {
    const path = name ? `${name}/${entry.name}` : entry.name
    if (excluded(path)) continue
    if (!validName(path)) throw new Error('The team directory contains an unsupported filename.')
    const source = join(root, path); const target = join(destination, path); const info = await lstat(source)
    if (info.isSocket()) continue
    const mode = info.mode & 0o777
    if (info.isSymbolicLink()) {
      const original = await readlink(source)
      let absolute = resolve(dirname(source), original)
      try { absolute = await realpath(absolute) } catch { /* A broken internal link can be restored unchanged. */ }
      if (!safeInside(root, absolute)) throw new Error('A team file links outside its private directory. The backup was not saved.')
      const link = relative(dirname(source), absolute).split(sep).join('/') || '.'
      files.push({ path, type: 'symlink', link, mode })
    } else if (info.isDirectory()) {
      await mkdir(target, { mode: 0o700 })
      files.push({ path, type: 'directory', mode })
      await snapshot(root, destination, path, files)
    } else if (info.isFile()) {
      await copyFile(source, target)
      await chmod(target, 0o600)
      const after = await lstat(source)
      if (info.size !== after.size || info.mtimeMs !== after.mtimeMs || info.ino !== after.ino) throw new Error('Team data changed during backup. Stop hosting and try again.')
      files.push({ path, type: 'file', size: info.size, mode, sha256: await hashFile(target) })
    } else throw new Error('The team directory contains an unsupported file type.')
  }
  return files
}
function tarHeader(name, size, mode, directory = false) {
  let prefix = ''; let shortName = name
  if (Buffer.byteLength(shortName) > 100) {
    const separators = [...name.matchAll(/\//gu)].map(match => match.index).reverse()
    const split = separators.find(index => Buffer.byteLength(name.slice(0, index)) <= 155 && Buffer.byteLength(name.slice(index + 1)) <= 100)
    if (split === undefined) throw new Error('A team file path is too long for the backup format.')
    prefix = name.slice(0, split); shortName = name.slice(split + 1)
  }
  const header = Buffer.alloc(512)
  const octal = (number, width) => {
    const value = number.toString(8)
    if (value.length >= width) throw new Error('A team file is too large for the backup format.')
    return value.padStart(width - 1, '0') + '\0'
  }
  header.write(shortName, 0, 100); header.write(octal(mode, 8), 100, 8)
  header.write(octal(0, 8), 108, 8); header.write(octal(0, 8), 116, 8)
  header.write(octal(size, 12), 124, 12); header.write(octal(Math.floor(Date.now() / 1000), 12), 136, 12)
  header.fill(32, 148, 156); header.write(directory ? '5' : '0', 156, 1)
  header.write('ustar\0', 257, 6); header.write('00', 263, 2); header.write(prefix, 345, 155)
  header.write(header.reduce((sum, value) => sum + value, 0).toString(8).padStart(6, '0') + '\0 ', 148, 8)
  return header
}
async function* archiveChunks(manifest, payload) {
  const bytes = Buffer.from(JSON.stringify(manifest))
  yield tarHeader('manifest.json', bytes.length, 0o600); yield bytes
  if (bytes.length % 512) yield Buffer.alloc(512 - bytes.length % 512)
  yield tarHeader('payload', 0, 0o700, true)
  for (const file of manifest.files) {
    if (file.type === 'symlink') continue // Links are recreated only after all ordinary files have been verified.
    yield tarHeader(`payload/${file.path}`, file.type === 'file' ? file.size : 0, file.mode, file.type === 'directory')
    if (file.type === 'file') {
      for await (const chunk of createReadStream(join(payload, file.path))) yield chunk
      if (file.size % 512) yield Buffer.alloc(512 - file.size % 512)
    }
  }
  yield Buffer.alloc(1024)
}
class ArchiveReader {
  constructor(stream) { this.stream = stream; this.iterator = stream[Symbol.asyncIterator](); this.buffer = Buffer.alloc(0) }
  async read(length, eof = false) {
    while (this.buffer.length < length) {
      const next = await this.iterator.next()
      if (next.done) {
        if (eof && this.buffer.length === 0) return null
        throw new Error('The backup archive is incomplete.')
      }
      this.buffer = Buffer.concat([this.buffer, next.value])
    }
    const result = this.buffer.subarray(0, length); this.buffer = this.buffer.subarray(length); return result
  }
  async header() {
    const bytes = await this.read(512)
    if (bytes.every(byte => byte === 0)) {
      const second = await this.read(512)
      if (!second.every(byte => byte === 0)) throw new Error('The backup has an invalid end marker.')
      let tail
      while ((tail = await this.read(512, true))) if (!tail.every(byte => byte === 0)) throw new Error('The backup contains unexpected trailing data.')
      return null
    }
    const string = (start, length) => bytes.toString('utf8', start, start + length).replace(/\0.*$/su, '')
    const number = (start, length) => {
      const value = string(start, length).trim()
      if (!/^[0-7]+$/u.test(value)) throw new Error('The backup has invalid file metadata.')
      const parsed = Number.parseInt(value, 8)
      if (!Number.isSafeInteger(parsed)) throw new Error('The backup contains an unsupported file size.')
      return parsed
    }
    const checksum = number(148, 8)
    const actual = bytes.reduce((sum, value, index) => sum + (index >= 148 && index < 156 ? 32 : value), 0)
    if (checksum !== actual || string(257, 6) !== 'ustar') throw new Error('The backup archive header is damaged.')
    const prefix = string(345, 155); const name = `${prefix ? prefix + '/' : ''}${string(0, 100)}`
    const type = string(156, 1)
    if (!validName(name) || !['0', '5'].includes(type)) throw new Error('The backup contains an unsafe file entry.')
    const size = number(124, 12)
    if (type === '5' && size !== 0) throw new Error('The backup contains an invalid directory.')
    return { name, type: type === '5' ? 'directory' : 'file', size }
  }
  async data(size, consume) {
    for (let left = size; left > 0;) { const chunk = await this.read(Math.min(left, 64 * 1024)); await consume(chunk); left -= chunk.length }
    if (size % 512) await this.read(512 - size % 512)
  }
}
function validateManifest(value) {
  if (value?.format === 'opensport-native' && value.version === 1) throw new Error(LEGACY_PREVIEW)
  if (value?.format !== 'opensport-native' || value.version !== NATIVE_BACKUP_VERSION || value.cliVersion !== NATIVE_CLI_VERSION) throw new Error('This backup requires a different OpenSport native runtime version.')
  if (value.securityProfile !== NATIVE_SECURITY_PROFILE) throw new Error('This backup uses an unsupported Mac preview security profile. Your files have not been changed.')
  if (value.platform !== process.platform || value.arch !== process.arch) throw new Error('Restore this native backup on the same operating system and CPU architecture.')
  if (typeof value.originalRoot !== 'string' || !isAbsolute(value.originalRoot) || !Array.isArray(value.files) || value.files.length > 250000) throw new Error('The backup manifest is invalid.')
  const names = new Map()
  for (const file of value.files) {
    if (!validName(file.path) || excluded(file.path) || names.has(file.path) || !['file', 'directory', 'symlink'].includes(file.type) || !Number.isInteger(file.mode) || file.mode < 0 || file.mode > 0o777) throw new Error('The backup manifest contains an unsafe entry.')
    if (file.type === 'file' && (!Number.isSafeInteger(file.size) || file.size < 0 || !/^[a-f0-9]{64}$/u.test(file.sha256))) throw new Error('The backup file checksum is invalid.')
    if (file.type === 'symlink') validateLink('/opensport-private', file.path, file.link)
    names.set(file.path, file)
  }
  for (const file of value.files) {
    for (let parent = posix.dirname(file.path); parent !== '.'; parent = posix.dirname(parent)) if (names.get(parent)?.type !== 'directory') throw new Error('The backup is missing a safe parent directory.')
  }
  if (names.get('team-setup.json')?.type !== 'file' || names.get('runtime')?.type !== 'directory') throw new Error('This archive does not contain a configured native team.')
  for (const name of ['runtime/manifest.json', 'runtime/secrets.json']) {
    if (names.get(name)?.type !== 'file') throw new Error('This backup is missing its private Mac server security records. Your files have not been changed.')
  }
  return names
}

async function validateNativePayload(payload) {
  let runtime, secrets
  try {
    runtime = JSON.parse(await readFile(join(payload, 'runtime/manifest.json'), 'utf8'))
    secrets = JSON.parse(await readFile(join(payload, 'runtime/secrets.json'), 'utf8'))
  } catch {
    throw new Error('This backup has unreadable Mac server security records. Your files have not been changed.')
  }
  if (runtime?.format === 1) throw new Error(LEGACY_PREVIEW)
  if (runtime?.format !== NATIVE_MANIFEST_FORMAT || runtime.securityProfile !== NATIVE_SECURITY_PROFILE
    || runtime.cliVersion !== NATIVE_CLI_VERSION || typeof runtime.dataRoot !== 'string' || !isAbsolute(runtime.dataRoot)
    || typeof runtime.stackId !== 'string' || !/^[a-f0-9]{64}$/.test(runtime.stackId)) {
    throw new Error('This backup has incompatible Mac server security records. Your files have not been changed.')
  }
  if (!validNativeSecrets(secrets)) throw new Error('This backup is missing valid private database credentials for this Mac preview. Your files have not been changed.')
  // Compatibility is not proof of database safety. NativeRuntime must still
  // regenerate trusted launch configuration and verify authentication at start.
}

async function unpack(archivePath, stage) {
  const source = createReadStream(archivePath); const unzip = createGunzip()
  source.on('error', error => unzip.destroy(error)); source.pipe(unzip)
  const reader = new ArchiveReader(unzip)
  try {
    const first = await reader.header()
    if (!first || first.name !== 'manifest.json' || first.type !== 'file' || first.size > 16 * 1024 * 1024) throw new Error('This is not an OpenSport native backup.')
    const chunks = []; await reader.data(first.size, chunk => chunks.push(chunk))
    let manifest
    try { manifest = JSON.parse(Buffer.concat(chunks).toString('utf8')) } catch { throw new Error('The backup manifest is damaged.') }
    const remaining = validateManifest(manifest)
    const payload = join(stage, 'payload'); await mkdir(payload, { mode: 0o700 })
    let header; let seenRoot = false
    while ((header = await reader.header())) {
      if (header.name === 'payload' && header.type === 'directory' && !seenRoot) { seenRoot = true; continue }
      const name = header.name.startsWith('payload/') ? header.name.slice(8) : ''
      const expected = remaining.get(name)
      if (!seenRoot || !expected || expected.type !== header.type || expected.type === 'symlink' || (expected.type === 'file' && expected.size !== header.size)) throw new Error('The archive does not match its manifest.')
      const target = join(payload, name)
      if (header.type === 'directory') await mkdir(target, { mode: 0o700 })
      else {
        const handle = await import('node:fs/promises').then(fs => fs.open(target, 'wx', 0o600))
        const hash = createHash('sha256')
        try { await reader.data(header.size, async chunk => { hash.update(chunk); await handle.writeFile(chunk) }) } finally { await handle.close() }
        if (hash.digest('hex') !== expected.sha256) throw new Error('A backup file checksum does not match. Your current data has not changed.')
        await chmod(target, expected.mode)
      }
      remaining.delete(name)
    }
    for (const file of remaining.values()) {
      if (file.type !== 'symlink') throw new Error('The backup is missing a file.')
      validateLink(payload, file.path, file.link)
      await symlink(file.link, join(payload, file.path))
    }
    // Apply directory modes last so restrictive archived modes cannot interfere
    // with validation or write a file through a symbolic link during extraction.
    for (const file of [...manifest.files].reverse()) if (file.type === 'directory') await chmod(join(payload, file.path), file.mode)
    const checkpoint = JSON.parse(await readFile(join(payload, 'team-setup.json'), 'utf8'))
    if (checkpoint.phase !== 'complete') throw new Error('This backup does not contain a completed team setup.')
    await validateNativePayload(payload)
    await writeFile(join(payload, MANIFEST), JSON.stringify(manifest, null, 2), { mode: 0o600, flag: 'wx' })
    return { manifest, payload }
  } finally { source.destroy(); unzip.destroy() }
}
async function requireEmpty(dataDir) {
  for (const entry of await readdir(dataDir, { withFileTypes: true })) {
    // Electron keeps its window files open; preserve them instead of replacing
    // the whole directory. A fresh shell may also have saved a preferred port.
    if (entry.name === 'window' && entry.isDirectory()) continue
    if (entry.name === 'desktop.json' && entry.isFile()) continue
    if (entry.name === 'runtime' && entry.isDirectory() && (await readdir(join(dataDir, entry.name))).length === 0) continue
    throw new Error('Restore requires a fresh installation without an existing team or native database. Your current data has not changed.')
  }
}
export async function createBackup({ dataDir, archivePath }) {
  const root = await realpath(dataDir)
  const target = join(await realpath(dirname(resolve(archivePath))), resolve(archivePath).split(sep).at(-1))
  if (safeInside(root, target)) throw new Error('Save the backup outside the private team directory.')
  const checkpoint = JSON.parse(await readFile(join(root, 'team-setup.json'), 'utf8'))
  if (checkpoint.phase !== 'complete') throw new Error('Create your team before saving a backup.')
  const stage = await mkdtemp(join(dirname(root), '.opensport-backup-'))
  const temporary = `${target}.${randomUUID()}.partial`
  try {
    const payload = join(stage, 'payload'); await mkdir(payload, { mode: 0o700 })
    const files = await snapshot(root, payload)
    const manifest = { format: 'opensport-native', version: NATIVE_BACKUP_VERSION, securityProfile: NATIVE_SECURITY_PROFILE, cliVersion: NATIVE_CLI_VERSION, platform: process.platform, arch: process.arch, originalRoot: resolve(dataDir), createdAt: new Date().toISOString(), files }
    validateManifest(manifest)
    await validateNativePayload(payload)
    await pipeline(Readable.from(archiveChunks(manifest, payload)), createGzip(), createWriteStream(temporary, { flags: 'wx', mode: 0o600 }))
    // Re-read the complete archive and verify every entry before publishing it.
    const validation = join(stage, 'validation'); await mkdir(validation, { mode: 0o700 }); await unpack(temporary, validation)
    await rename(temporary, target)
    return { path: archivePath, createdAt: manifest.createdAt, files: files.length }
  } finally { await rm(temporary, { force: true }); await rm(stage, { recursive: true, force: true }) }
}
export async function restoreBackup({ dataDir, archivePath }) {
  await mkdir(dataDir, { recursive: true, mode: 0o700 })
  const root = await realpath(dataDir)
  await requireEmpty(root)
  const stage = await mkdtemp(join(dirname(root), '.opensport-restore-'))
  const imported = []; let oldPreferences = false
  try {
    const { manifest, payload } = await unpack(resolve(archivePath), stage)
    await requireEmpty(root) // Recheck immediately before installing anything.
    const entries = await readdir(payload)
    if (entries.includes('desktop.json')) {
      try { await rename(join(root, 'desktop.json'), join(stage, 'old-desktop.json')); oldPreferences = true }
      catch (error) { if (error.code !== 'ENOENT') throw error }
    }
    try {
      for (const name of entries) { await rename(join(payload, name), join(root, name)); imported.push(name) }
    } catch (error) {
      for (const name of imported.reverse()) await rename(join(root, name), join(payload, name))
      if (oldPreferences) await rename(join(stage, 'old-desktop.json'), join(root, 'desktop.json'))
      throw error
    }
    return { restored: true, createdAt: manifest.createdAt, originalRoot: manifest.originalRoot }
  } finally { await rm(stage, { recursive: true, force: true }) }
}
