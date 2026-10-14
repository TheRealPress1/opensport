// OpenSport's local-only overlay for the exact Supabase CLI 2.120.0 artifacts.
// The CLI verifies official archives before this runs. We alter only launcher
// scripts and generated configuration, never Mach-O
// binaries. Upstream files and license notices remain in each service archive.
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { createHash } from 'node:crypto'
import { readFile, writeFile, chmod, realpath } from 'node:fs/promises'
import path from 'node:path'

const execute = promisify(execFile)
const hash = value => createHash('sha256').update(value).digest('hex')
const loopback = /^(?:127\.0\.0\.1:\d+|\[::1\]:\d+)$/
const SHELL_MARKER = '# OpenSport local-only native isolation v1\n'
const BOOTSTRAP_HBA_SHA256 = '34da06958b20e0080af90d865aad2a8f93ca94755c6c99dd2d8b8e7405688a9c'

export function nativeBootstrapHba(source) {
  // The fresh-boot temporary server uses this template, before the CLI's
  // managed HBA file takes over for the long-lived server. Both must require
  // authentication; a later readiness check cannot close an earlier gap.
  if (hash(source) !== BOOTSTRAP_HBA_SHA256) throw new Error('The PostgreSQL bootstrap authentication template is not recognized. OpenSport has not started it.')
  const header = source.slice(0, source.indexOf('# TYPE  DATABASE'))
  return `${header}# OpenSport native authentication v1: require the installation credential\n# during initial migrations as well as normal server operation.\nlocal all all scram-sha-256\nhost all all 127.0.0.1/32 scram-sha-256\nhost all all ::1/128 scram-sha-256\n`
}

// PostgreSQL configuration paths need their own escaping, including apostrophes.
export const NATIVE_PATH_HELPERS = String.raw`
# OpenSport native path quoting v1
opensport_pg_escape() {
  sed -e 's/\\/\\\\/g' -e "s/'/''/g"
}
`

export const NATIVE_OVERLAYS = [
  { service: 'postgres', version: '17.11.0.004-r1', file: 'bin/supabase-postgres-start', sha256: '9c3b39b4cca9f0403d0ca4851cba553d705e4ee0ba16bb9d180bcebd2cccbe22',
    source: 'https://github.com/supabase/slim-services/releases/tag/postgres-17.11.0.004-r1' },
  { service: 'postgres', version: '17.11.0.004-r1', file: 'share/supabase-cli/bin/supabase-postgres-init.sh', sha256: '94a4eae12ac84512ab3bd0458ecfa47712b7c2289427e966a5731831bbd520c9',
    source: 'https://github.com/supabase/slim-services/releases/tag/postgres-17.11.0.004-r1' },
  { service: 'postgres', version: '17.11.0.004-r1', file: 'share/supabase-cli/bin/stage-shared-config.sh', sha256: 'b3498a9360cccceee6beb154f8c07aec9ac495326b725284691ff4eb725222e8',
    source: 'https://github.com/supabase/slim-services/releases/tag/postgres-17.11.0.004-r1' },
  { service: 'postgres', version: '17.11.0.004-r1', file: 'share/supabase-cli/config/pg_hba.conf.template', sha256: BOOTSTRAP_HBA_SHA256,
    source: 'https://github.com/supabase/slim-services/releases/tag/postgres-17.11.0.004-r1' },
  { service: 'postgrest', version: 'v16.4-r0', file: 'bin/postgrest', sha256: '5ad4c1b59bfa74dcd9ed37038c18f7ce1b091990e1930fc367b6d77a56463af9',
    source: 'https://github.com/supabase/slim-services/releases/tag/postgrest-v16.4-r0',
    insert: 'export PGRST_SERVER_HOST=127.0.0.1\n' },
  { service: 'storage', version: 'v1.79.36-r0', file: 'bin/storage', sha256: '02cc98ec465728a1521b6e4351bfd6cb2ef8282e0503ef1f3b40f81457fd4e47',
    source: 'https://github.com/supabase/slim-services/releases/tag/storage-v1.79.36-r0',
    insert: 'export SERVER_HOST=127.0.0.1\n' },
  { service: 'edge-runtime', version: 'v1.77.4-r0', file: 'bin/edge-runtime', sha256: '9524c18de3cea6de81c1b6545e5f02ebaccefaac373547d7a3adc1e41d6554bf',
    source: 'https://github.com/supabase/slim-services/releases/tag/edge-runtime-v1.77.4-r0',
    insert: 'if [ "$1" = "start" ]; then\n  shift\n  set -- start --ip=127.0.0.1 "$@"\nfi\n' },
  { service: 'realtime', version: 'v2.140.10-r0', file: 'releases/2.140.10/runtime.exs', sha256: 'b67316a8c4207bf6b37f43911e310d9d8e3afeea479d935bfb29857a89a9d4a2',
    source: 'https://github.com/supabase/slim-services/releases/tag/realtime-v2.140.10-r0' },
]

function patched(source, overlay) {
  if (overlay.service === 'postgres') {
    if (overlay.file.endsWith('/pg_hba.conf.template')) return nativeBootstrapHba(source)
    let next = source.replace('\n', `\n${NATIVE_PATH_HELPERS}`)
    if (overlay.file === 'bin/supabase-postgres-start') {
      // pgsodium performs access(path) and popen(path) on the same string.
      // A quoted absolute path fails access(); an unquoted one fails popen().
      // PostgreSQL runs in PGDATA, so a freshly copied, fixed basename works
      // for both checks and never executes a script supplied by a backup.
      next = next.replace('getkey_script="$bundle_dir/share/supabase-cli/config/pgsodium_getkey.sh"', 'getkey_script=./opensport_getkey.sh')
      const copyKey = 'rm -f "$PGDATA/opensport_getkey.sh"\ncp "$bundle_dir/share/supabase-cli/config/pgsodium_getkey.sh" "$PGDATA/opensport_getkey.sh"\nchmod 700 "$PGDATA/opensport_getkey.sh"\n'
      next = next.replace('start_temp_server() {\n', `start_temp_server() {\n${copyKey}`)
      next = next.replace('echo "supabase-postgres: starting server"', `${copyKey}echo "supabase-postgres: starting server"`)
      next = next.replace('"$bin_dir/postgres" -D "$PGDATA" \\\n', '"$bin_dir/postgres" -D "$PGDATA" \\\n    -c "pgsodium.getkey_script=$getkey_script" -c "vault.getkey_script=$getkey_script" \\\n')
    } else if (overlay.file.endsWith('supabase-postgres-init.sh')) {
      next = next.replaceAll("getkey_script = '$GETKEY_SCRIPT'", "getkey_script = './opensport_getkey.sh'")
    } else {
      next = next.replace('cat >>"$PGDATA/postgresql.conf" <<EOF', 'OPENSPORT_SCRIPTS_CONFIG=$(printf \'%s\' "$BUNDLE_DIR/share/supabase-cli/extension-custom-scripts" | opensport_pg_escape)\ncat >>"$PGDATA/postgresql.conf" <<EOF')
      next = next.replace("supautils.extension_custom_scripts_path = '$BUNDLE_DIR/share/supabase-cli/extension-custom-scripts'", "supautils.extension_custom_scripts_path = '$OPENSPORT_SCRIPTS_CONFIG'")
    }
    return next
  }
  if (overlay.insert) return source.replace('#!/bin/sh\n', `#!/bin/sh\n${SHELL_MARKER}${overlay.insert}`)
  const needle = 'socket_opts: [realtime_ip_version]'
  if (source.split(needle).length !== 2) throw new Error('The bundled Realtime network configuration is not recognized.')
  return source.replace(needle, 'socket_opts: [:inet, {:ip, {127, 0, 0, 1}}] # OpenSport local-only native isolation v1')
}

export async function isolateNativeArtifacts(homeDir) {
  const cache = path.join(homeDir, 'cache', 'stack', 'slim-services')
  const verified = []
  for (const overlay of NATIVE_OVERLAYS) {
    const file = path.join(cache, overlay.service, overlay.version, 'darwin-arm64', overlay.file)
    let current, original
    try {
      const canonical = await realpath(file)
      if (!canonical.startsWith(`${await realpath(cache)}${path.sep}`)) throw new Error('Outside service cache')
      current = await readFile(file, 'utf8')
      try { original = await readFile(`${file}.opensport-original`, 'utf8') } catch (error) {
        if (error.code !== 'ENOENT') throw error
        original = current
      }
    } catch { throw new Error('Verified native service files are missing. OpenSport cannot start safely; prepare the matching server download again.') }
    if (hash(original) !== overlay.sha256) throw new Error(`The ${overlay.service} download does not match this preview's verified network configuration. OpenSport has not started it.`)
    const next = patched(original, overlay)
    if (current !== original && current !== next) throw new Error(`The ${overlay.service} launcher has changed unexpectedly. OpenSport has not started it.`)
    verified.push({ file, original, next, overlay })
  }
  // Check every input first. A mismatch never leaves a partially accepted set.
  for (const { file, original, next, overlay } of verified) {
    await writeFile(`${file}.opensport-original`, original, { mode: 0o600 })
    await chmod(file, 0o700)
    await writeFile(file, next)
    if (overlay.file.endsWith('.exs') || overlay.file.endsWith('.template')) await chmod(file, 0o600)
  }
  return verified.map(({ overlay, next }) => ({ service: overlay.service, version: overlay.version, originalSha256: overlay.sha256, patchedSha256: hash(next), source: overlay.source }))
}

export function parseListenerAudit(output) {
  let pid
  const listeners = []
  for (const line of output.split('\n')) {
    if (line.startsWith('p')) pid = Number(line.slice(1))
    if (line.startsWith('n')) listeners.push({ pid, address: line.slice(1), loopback: loopback.test(line.slice(1)) })
  }
  return listeners
}

export async function auditNativeListeners({ homeDir, stackId }) {
  const owner = JSON.parse(await readFile(path.join(homeDir, 'stacks', stackId, 'owner.json'), 'utf8'))
  if (!Number.isInteger(owner.pid) || owner.pid < 2) throw new Error('The local server owner could not be verified.')
  const { stdout } = await execute('/bin/ps', ['-Ao', 'pid=,ppid=,comm='], { maxBuffer: 4 * 1024 * 1024 })
  const processes = stdout.split('\n').map(line => line.trim().match(/^(\d+)\s+(\d+)\s+(.+)$/)).filter(Boolean)
  const pids = new Set([owner.pid])
  for (const match of processes) if (match[3].startsWith(`${homeDir}${path.sep}`)) pids.add(Number(match[1]))
  let changed
  do {
    changed = false
    for (const match of processes) if (pids.has(Number(match[2])) && !pids.has(Number(match[1]))) { pids.add(Number(match[1])); changed = true }
  } while (changed)
  let report
  try {
    report = await execute('/usr/sbin/lsof', ['-nP', '-a', '-p', [...pids].join(','), '-iTCP', '-sTCP:LISTEN', '-Fpn'], { maxBuffer: 1024 * 1024 })
  } catch { throw new Error('OpenSport could not verify that its native server is private to this Mac.') }
  const listeners = parseListenerAudit(report.stdout)
  if (!listeners.length || listeners.some(listener => !listener.loopback)) throw new Error('A native service tried to listen outside this Mac. OpenSport stopped hosting to keep your team private.')
  return { processCount: pids.size, listeners }
}
