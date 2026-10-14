// State relocation for trusted, cold OpenSport backups. A PostgreSQL database
// contains executable SQL; an archive checksum does not make an unknown backup
// safe. Launch configuration and application code are nevertheless regenerated.
import { readFile, writeFile, readdir, cp, rm, realpath } from 'node:fs/promises'
import path from 'node:path'

const services = ['auth', 'database', 'functions', 'realtime', 'rest', 'storage']
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
const postgresVersion = '17.11.0.004-r1'
const quoted = value => value.replaceAll('\\', '\\\\').replaceAll("'", "''")

export async function relocateNativeState({ homeDir, projectDir, manifest, dataDir }) {
  const file = path.join(homeDir, 'stacks', manifest.stackId, 'state.json')
  const state = JSON.parse(await readFile(file, 'utf8'))
  if (state.id !== manifest.stackId || state.runtime !== 'native' || !Array.isArray(state.instances)
    || state.instances.map(instance => instance.creation?.service).sort().join(',') !== services.join(',')
    || state.instances.some(instance => !uuid.test(instance.id))) {
    throw new Error('This backup contains an unsupported native server layout.')
  }
  const oldRoot = manifest.dataRoot
  function move(value) {
    if (typeof value === 'string' && (value === oldRoot || value.startsWith(`${oldRoot}${path.sep}`))) return dataDir + value.slice(oldRoot.length)
    if (Array.isArray(value)) return value.map(move)
    if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, move(child)]))
    return value
  }
  const relocated = move(state)
  relocated.identity.projectRoot = projectDir
  for (const instance of relocated.instances) {
    const config = instance.creation.config
    if (instance.creation.service === 'database') {
      config.version = '17'
      config.settings = {}
      config.jwtExpiry = 3600
      config.healthTimeoutMs = 120000
    }
    if (instance.creation.service === 'functions') {
      config.functionsRoot = path.join(projectDir, 'supabase', 'functions')
      config.filesRoot = projectDir
      config.env = {}
      config.functions = {}
      delete config.bootstrap
    }
    if (instance.creation.service === 'storage') config.filePath = path.join(projectDir, 'supabase', '.temp', 'stack-uploads', manifest.stackId)
    if (instance.creation.service === 'auth') config.settings = {}
  }
  await writeFile(file, JSON.stringify(relocated), { mode: 0o600 })
}

export async function resetNativeDatabaseConfig({ homeDir, stackId }) {
  if (!stackId) return
  const root = path.join(homeDir, 'stacks', stackId)
  const state = JSON.parse(await readFile(path.join(root, 'state.json'), 'utf8'))
  const instance = state.instances.find(item => item.creation?.service === 'database')
  if (!uuid.test(instance?.id)) throw new Error('The native database record is invalid.')
  const data = path.join(root, 'data', instance.id, 'data')
  try { await readFile(path.join(data, 'PG_VERSION')) } catch (error) { if (error.code === 'ENOENT') return; throw error }
  if (!(await realpath(data)).startsWith(`${await realpath(root)}${path.sep}`)) throw new Error('The native database directory is outside the private application state.')
  const bundle = path.join(homeDir, 'cache', 'stack', 'slim-services', 'postgres', postgresVersion, 'darwin-arm64')
  const templates = path.join(bundle, 'share', 'supabase-cli', 'config')
  const config = await readFile(path.join(templates, 'postgresql.conf.template'), 'utf8')
  // Match the official native bootstrap's configuration staging. Never retain
  // a backup's ALTER SYSTEM settings, shell commands or include directories.
  for (const name of ['logging.conf', 'supautils.conf', 'wal-g.conf', 'read-replica.conf']) {
    await rm(path.join(data, name), { force: true })
    await cp(path.join(templates, name), path.join(data, name))
  }
  await rm(path.join(data, 'conf.d'), { recursive: true, force: true })
  await cp(path.join(templates, 'conf.d'), path.join(data, 'conf.d'), { recursive: true })
  const getkey = './opensport_getkey.sh'
  const scripts = quoted(path.join(bundle, 'share', 'supabase-cli', 'extension-custom-scripts'))
  for (const name of ['postgresql.conf', 'postgresql.auto.conf', 'pg_ident.conf']) await rm(path.join(data, name), { force: true })
  await writeFile(path.join(data, 'postgresql.conf'), `${config}\nsupautils.extension_custom_scripts_path = '${scripts}'\npgsodium.getkey_script = '${getkey}'\nvault.getkey_script = '${getkey}'\n`, { mode: 0o600 })
  await writeFile(path.join(data, 'postgresql.auto.conf'), '# Managed by the OpenSport Mac preview.\n', { mode: 0o600 })
  await cp(path.join(templates, 'pg_ident.conf.template'), path.join(data, 'pg_ident.conf'))
  // Realtime's restart does not need stale PID/socket files from a cold backup.
  for (const name of await readdir(data)) if (name === 'postmaster.pid') await rm(path.join(data, name), { force: true })
}
