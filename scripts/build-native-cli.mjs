import { createHash } from 'node:crypto'
import { spawn } from 'node:child_process'
import { chmod, cp, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const digest = bytes => createHash('sha256').update(bytes).digest('hex')
const run = (command, args, cwd = root, capture = false) => new Promise((resolve, reject) => {
  const child = spawn(command, args, { cwd, stdio: capture ? ['ignore', 'pipe', 'pipe'] : 'inherit', env: process.env })
  let stdout = '', stderr = ''
  child.stdout?.on('data', chunk => { stdout += chunk })
  child.stderr?.on('data', chunk => { stderr += chunk })
  child.on('error', reject)
  child.on('exit', code => code === 0 ? resolve(stdout.trim()) : reject(new Error(`${command} failed (${code})${capture ? `: ${stderr}` : ''}`)))
})

async function downloadVerified(url, filename, expected) {
  let bytes
  try { bytes = await readFile(filename) } catch { /* first build */ }
  if (bytes && digest(bytes) === expected) return
  const response = await fetch(url, { signal: AbortSignal.timeout(300000) })
  if (!response.ok) throw new Error(`Pinned build input download failed (${response.status}): ${url}`)
  bytes = Buffer.from(await response.arrayBuffer())
  if (digest(bytes) !== expected) throw new Error(`Checksum mismatch for ${url}. No build input was installed.`)
  await writeFile(`${filename}.partial`, bytes)
  await rename(`${filename}.partial`, filename)
}

export async function prepareNativeLauncher(resources) {
  if (process.platform !== 'darwin' || process.arch !== 'arm64') throw new Error('The pinned native launcher builds on Apple silicon macOS.')
  const lock = JSON.parse(await readFile(path.join(root, 'desktop/runtime-lock.json'), 'utf8'))
  const config = lock.sourceBuild
  const patch = await readFile(path.join(root, config.patch))
  if (digest(patch) !== config.patchSha256) throw new Error('Native launcher source patch does not match runtime-lock.json.')
  const buildScript = await readFile(path.join(root, 'desktop/patches/build-cli.mjs'))
  const checkScript = await readFile(path.join(root, 'desktop/patches/check-config.mjs'))
  const identity = { buildId: config.buildId, upstreamVersion: lock.version, upstreamCommit: config.commit, patchSha256: config.patchSha256 }
  const builderSha256 = digest(Buffer.concat([await readFile(fileURLToPath(import.meta.url)), buildScript, checkScript, Buffer.from(JSON.stringify(config))]))
  const cache = path.join(root, '.context', 'opensport-native-cli-build')
  const native = path.join(resources, 'native')
  await mkdir(cache, { recursive: true })
  await mkdir(native, { recursive: true })
  const binary = path.join(native, 'supabase')
  const manifestPath = path.join(native, 'opensport-build.json')
  let cached = false
  try {
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8'))
    cached = manifest.builderSha256 === builderSha256 && manifest.binarySha256 === digest(await readFile(binary))
      && Object.entries(identity).every(([key, value]) => manifest[key] === value)
      && JSON.stringify(JSON.parse(await run(binary, ['--opensport-build-info'], root, true))) === JSON.stringify(identity)
  } catch { /* rebuild absent or stale output */ }
  if (!cached) {
    console.log('Building the pinned OpenSport native launcher from reviewed source…')
    const sourceArchive = path.join(cache, 'source.tar.gz')
    const bunArchive = path.join(cache, 'bun.zip')
    const pnpmArchive = path.join(cache, 'pnpm-native.tgz')
    await Promise.all([
      downloadVerified(config.sourceUrl, sourceArchive, config.sourceSha256),
      downloadVerified(config.bun.url, bunArchive, config.bun.sha256),
      downloadVerified(config.pnpm.url, pnpmArchive, config.pnpm.sha256),
    ])
    const source = path.join(cache, 'source')
    const toolchain = path.join(cache, 'toolchain')
    await rm(source, { recursive: true, force: true })
    await mkdir(source, { recursive: true })
    await mkdir(path.join(toolchain, 'pnpm'), { recursive: true })
    await run('/usr/bin/tar', ['-xzf', sourceArchive, '-C', source, '--strip-components=1'])
    await run('/usr/bin/unzip', ['-qo', bunArchive, '-d', toolchain])
    await run('/usr/bin/tar', ['-xzf', pnpmArchive, '-C', path.join(toolchain, 'pnpm'), '--strip-components=1'])
    const bun = path.join(toolchain, 'bun-darwin-aarch64/bun')
    const pnpm = path.join(toolchain, 'pnpm/pnpm')
    if (await run(bun, ['--version'], root, true) !== config.bun.version || await run(pnpm, ['--version'], root, true) !== config.pnpm.version) {
      throw new Error('Native launcher toolchain version mismatch.')
    }
    await run('/usr/bin/patch', ['--batch', '--forward', '--fuzz=0', '-p1', '-i', path.join(root, config.patch)], source)
    // Frozen upstream lock includes package integrity and upstream dependency patches.
    // No third-party install/prepare scripts run as part of compiling this launcher.
    await run(pnpm, ['--filter', 'supabase...', '--filter', '!@supabase/root', 'install', '--frozen-lockfile', '--ignore-scripts', '--cpu', 'arm64', '--os', 'darwin', '--store-dir', path.join(cache, 'pnpm-store')], source)
    await writeFile(path.join(source, 'apps/cli/scripts/opensport-build.mjs'), buildScript)
    await writeFile(path.join(source, 'apps/cli/scripts/opensport-config-check.mjs'), checkScript)
    await run(bun, ['scripts/opensport-config-check.mjs'], path.join(source, 'apps/cli'))
    const identityPath = path.join(cache, 'build-identity.json')
    await writeFile(identityPath, `${JSON.stringify(identity, null, 2)}\n`)
    await run(bun, ['scripts/opensport-build.mjs', identityPath], path.join(source, 'apps/cli'))
    const compiled = path.join(source, 'apps/cli/dist/supabase')
    // Replace the compiler's linker signature; macOS 26 rejects that signature.
    await run('/usr/bin/codesign', ['--force', '--sign', '-', '--identifier', 'org.opensport.supabase-cli', '--timestamp=none', compiled])
    await run('/usr/bin/codesign', ['--verify', '--strict', compiled])
    const reported = JSON.parse(await run(compiled, ['--opensport-build-info'], root, true))
    if (JSON.stringify(reported) !== JSON.stringify(identity) || await run(compiled, ['--version'], root, true) !== lock.version) {
      throw new Error('The compiled native launcher did not report its pinned source identity.')
    }
    await cp(compiled, `${binary}.partial`)
    await chmod(`${binary}.partial`, 0o755)
    await rename(`${binary}.partial`, binary)
    await writeFile(manifestPath, `${JSON.stringify({ ...identity, builderSha256, binarySha256: digest(await readFile(binary)) }, null, 2)}\n`)
    await cp(path.join(source, 'apps/cli-go/LICENSE'), path.join(native, 'Supabase-CLI-LICENSE'))
  }
  // Keep the official Go compatibility sidecar; native stack execution uses the
  // source-built Bun launcher above. Never install the upstream Bun executable.
  const officialArchive = path.join(cache, 'supabase-official.tar.gz')
  await downloadVerified(lock.url, officialArchive, lock.sha256)
  await run('/usr/bin/tar', ['-xzf', officialArchive, '-C', native, 'supabase-go'])
  await chmod(path.join(native, 'supabase-go'), 0o755)
  await cp(path.join(root, config.patch), path.join(native, path.basename(config.patch)))
  await cp(path.join(root, 'desktop/patches/build-cli.mjs'), path.join(native, 'build-cli.mjs'))
  return identity
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await prepareNativeLauncher(path.join(root, 'desktop/resources'))
}
