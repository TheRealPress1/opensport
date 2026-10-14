// Main-process only. The native CLI is a pinned, experimental local runtime.
// Never expose its privileged config, diagnostic output, or ports to a renderer.
import { spawn } from 'node:child_process'
import { createHash, randomBytes } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { access, chmod, cp, mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import pg from 'pg'
import { createClient } from '@supabase/supabase-js'
import WebSocket from 'ws'
import { auditNativeListeners, isolateNativeArtifacts } from './native-isolation.mjs'
import { relocateNativeState, resetNativeDatabaseConfig } from './native-state.mjs'
import { NATIVE_CLI_VERSION, NATIVE_SECURITY_PROFILE, NATIVE_MANIFEST_FORMAT, validNativeSecrets } from './native-profile.mjs'
import { assertNativeDatabaseAuthentication } from './native-auth.mjs'

export { NATIVE_CLI_VERSION } from './native-profile.mjs'
const EXCLUDED_SERVICES = 'studio,mail,analytics,pooler'
const safeEnvironmentNames = ['PATH', 'HOME', 'USER', 'LOGNAME', 'TMPDIR', 'SHELL', 'LANG', 'LC_ALL', 'LC_CTYPE']

async function privateJson(file, value) {
  await writeFile(`${file}.tmp`, JSON.stringify(value, null, 2), { mode: 0o600 })
  await chmod(`${file}.tmp`, 0o600)
  await rename(`${file}.tmp`, file)
}

async function maybeJson(file) {
  try { return JSON.parse(await readFile(file, 'utf8')) } catch (error) {
    if (error.code === 'ENOENT') return null
    throw new Error('OpenSport could not read its saved runtime settings. Restore a backup before changing these files.')
  }
}

export function localOrigin(value) {
  let url
  try { url = new URL(value) } catch { throw new Error('A local OpenSport address is required.') }
  if (url.protocol !== 'http:' || !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
    || url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
    throw new Error('Mac hosting preview accepts only a loopback HTTP address.')
  }
  return url.origin
}

export function nativeConfig(publicUrl) {
  const origin = localOrigin(publicUrl)
  return `project_id = "opensport-desktop"
[experimental]
stack = true
[api]
enabled = true
schemas = ["public"]
extra_search_path = ["public", "extensions"]
[db]
major_version = 17
health_timeout = "120s"
[db.migrations]
enabled = false
[db.seed]
enabled = false
[db.pooler]
enabled = false
[studio]
enabled = false
[local_smtp]
enabled = false
[analytics]
enabled = false
[auth]
enabled = true
site_url = ${JSON.stringify(origin)}
additional_redirect_urls = [${JSON.stringify(origin)}]
enable_signup = false
enable_anonymous_sign_ins = false
minimum_password_length = 12
jwt_expiry = 3600
jwt_secret = "env(OPENSPORT_NATIVE_JWT_SECRET)"
secret_key = "env(OPENSPORT_NATIVE_SECRET_KEY)"
publishable_key = "env(OPENSPORT_NATIVE_PUBLISHABLE_KEY)"
[auth.email]
enable_signup = true
enable_confirmations = true
otp_expiry = 3600
[storage]
enabled = true
file_size_limit = "5MiB"
[storage.s3_protocol]
enabled = false
[storage.image_transformation]
enabled = false
[functions.team-admin]
verify_jwt = false
[functions.team-admin.env]
SITE_URL = "env(OPENSPORT_NATIVE_SITE_URL)"
`
}

export class NativeRuntime {
  constructor({ dataDir, resourcesDir, onProgress = () => {}, cliPath }) {
    if (!dataDir || !resourcesDir) throw new Error('Native runtime requires application data and resource directories.')
    this.dataDir = path.resolve(dataDir)
    this.resourcesDir = path.resolve(resourcesDir)
    this.root = path.join(this.dataDir, 'runtime')
    this.projectDir = path.join(this.root, 'project')
    this.homeDir = path.join(this.root, 'home')
    this.cliPath = cliPath || path.join(this.resourcesDir, 'native', 'supabase')
    this.onProgress = onProgress
    this.manifestPath = path.join(this.root, 'manifest.json')
    this.config = null
    this.phase = 'stopped'
    this.operation = null
    this.startingProcess = null
  }

  status() { return { running: Boolean(this.config), phase: this.phase, localOnly: true, cliVersion: NATIVE_CLI_VERSION } }

  async compatibility() {
    try {
      const [manifest, secrets] = await Promise.all([maybeJson(this.manifestPath), maybeJson(path.join(this.root, 'secrets.json'))])
      if ((manifest && (manifest.format !== NATIVE_MANIFEST_FORMAT || manifest.securityProfile !== NATIVE_SECURITY_PROFILE))
        || (secrets && !validNativeSecrets(secrets))) {
        return { supported: false, reason: 'legacy-preview', message: 'This older preview cannot start with the new database protection. Your saved team files are preserved. Keep this folder until a reviewed migration is available.' }
      }
      if (manifest && (!secrets || manifest.cliVersion !== NATIVE_CLI_VERSION || !/^[a-f0-9]{64}$/.test(manifest.stackId)
        || typeof manifest.dataRoot !== 'string' || !path.isAbsolute(manifest.dataRoot))) throw new Error('Invalid record')
      if (!secrets) {
        try { if ((await readdir(path.join(this.homeDir, 'stacks'))).length) throw new Error('Missing credentials') }
        catch (error) { if (error.code !== 'ENOENT') throw error }
      }
      return { supported: true }
    } catch {
      return { supported: false, reason: 'invalid-state', message: 'The saved server settings are incomplete or damaged. Your team files are preserved. Restore a compatible backup into an empty installation before hosting.' }
    }
  }

  progress(phase, message) {
    this.phase = phase
    this.onProgress({ phase, message })
  }

  environment() {
    return {
      ...Object.fromEntries(safeEnvironmentNames.filter(name => process.env[name] !== undefined).map(name => [name, process.env[name]])),
      SUPABASE_HOME: this.homeDir,
      SUPABASE_EXPERIMENTAL_STACK: '1',
      DO_NOT_TRACK: '1',
      ...(this.secrets || {}),
    }
  }

  async run(args, { timeout = 180000, label = 'runtime command', starting = false } = {}) {
    const logPath = path.join(this.root, 'native-diagnostics.log')
    return new Promise((resolve, reject) => {
      const child = spawn(this.cliPath, args, { cwd: this.projectDir, env: this.environment(), stdio: ['ignore', 'pipe', 'pipe'] })
      if (starting) this.startingProcess = child
      let stdout = '', stderr = '', timedOut = false
      const timer = setTimeout(() => { timedOut = true; child.kill('SIGTERM') }, timeout)
      const collect = (previous, chunk) => (previous + chunk.toString()).slice(-2 * 1024 * 1024)
      child.stdout.on('data', chunk => { stdout = collect(stdout, chunk) })
      child.stderr.on('data', chunk => { stderr = collect(stderr, chunk) })
      child.on('error', () => {
        clearTimeout(timer)
        if (this.startingProcess === child) this.startingProcess = null
        reject(new Error('The bundled OpenSport server could not run. Reinstall this Mac preview.'))
      })
      child.on('close', async code => {
        clearTimeout(timer)
        if (this.startingProcess === child) this.startingProcess = null
        // Logs may contain private server details. They stay inside the user's
        // private data directory and never become progress messages or IPC data.
        if (code !== 0 || stderr.trim()) {
          // A successful shutdown must not erase the failure it is cleaning up.
          await writeFile(logPath, `${stderr}\n${code === 0 ? '' : stdout}`, { mode: 0o600 }).catch(() => {})
        }
        if (code !== 0) return reject(new Error(timedOut
          ? 'OpenSport took too long to prepare its local server. Check your internet connection and try again.'
          : `OpenSport could not finish ${label}. Its private diagnostic log is saved in the application data folder.`))
        resolve(stdout)
      })
    })
  }

  async verifyLauncher() {
    this.launcherVerified = false
    const lock = await maybeJson(path.join(this.resourcesDir, 'runtime-lock.json'))
    const built = await maybeJson(path.join(this.resourcesDir, 'native', 'opensport-build.json'))
    const expected = lock?.sourceBuild
    if (expected?.buildId !== NATIVE_SECURITY_PROFILE || built?.buildId !== expected.buildId
      || built.upstreamVersion !== NATIVE_CLI_VERSION || built.upstreamCommit !== expected.commit
      || built.patchSha256 !== expected.patchSha256 || !/^[a-f0-9]{64}$/.test(built.binarySha256)) {
      throw new Error('This application is missing its protected database launcher. Reinstall the matching OpenSport preview.')
    }
    const hash = createHash('sha256')
    for await (const chunk of createReadStream(this.cliPath)) hash.update(chunk)
    if (hash.digest('hex') !== built.binarySha256) throw new Error('The local server launcher has changed. Reinstall OpenSport before starting your team.')
    let identity
    try { identity = JSON.parse(await this.run(['--opensport-build-info'], { label: 'checking database protection' })) }
    catch { throw new Error('The bundled server does not support protected database startup. Reinstall OpenSport.') }
    if (identity.buildId !== built.buildId || identity.upstreamVersion !== built.upstreamVersion
      || identity.upstreamCommit !== built.upstreamCommit || identity.patchSha256 !== built.patchSha256) {
      throw new Error('The bundled server has an unsupported database protection version. Reinstall OpenSport.')
    }
    this.launcherVerified = true
  }

  async prepare(publicUrl) {
    if (process.platform !== 'darwin' || process.arch !== 'arm64' || Number(os.release().split('.')[0]) < 23) {
      throw new Error('Hosting requires an Apple silicon Mac with macOS 14 or later.')
    }
    for (const directory of [this.dataDir, this.root, this.homeDir, this.projectDir]) {
      await mkdir(directory, { recursive: true, mode: 0o700 })
      await chmod(directory, 0o700)
    }
    await access(this.cliPath).catch(() => { throw new Error('The bundled local server is missing. Reinstall this Mac preview.') })
    await this.verifyLauncher()
    const version = (await this.run(['--version'], { label: 'checking the local server' })).trim()
    if (version !== NATIVE_CLI_VERSION) throw new Error('This OpenSport preview needs its matching bundled server version. Reinstall the application.')
    this.manifest = await maybeJson(this.manifestPath)
    const secretsPath = path.join(this.root, 'secrets.json')
    let secrets = await maybeJson(secretsPath)
    if (this.manifest && (this.manifest.format !== NATIVE_MANIFEST_FORMAT || this.manifest.securityProfile !== NATIVE_SECURITY_PROFILE)) {
      if (this.manifest.dataRoot === this.dataDir && /^[a-f0-9]{64}$/.test(this.manifest.stackId)) await this.stopInternal()
      throw new Error('This team was created by an older preview without database protection. This build cannot start or convert it. Keep its data folder unchanged; a reviewed migration is required.')
    }
    if (this.manifest && (this.manifest.cliVersion !== NATIVE_CLI_VERSION
      || !/^[a-f0-9]{64}$/.test(this.manifest.stackId) || typeof this.manifest.dataRoot !== 'string' || !path.isAbsolute(this.manifest.dataRoot))) {
      throw new Error('The saved local server record is not supported by this application version.')
    }
    if (!secrets) {
      let existingStacks = []
      try { existingStacks = await readdir(path.join(this.homeDir, 'stacks')) } catch (error) { if (error.code !== 'ENOENT') throw error }
      if (this.manifest || existingStacks.length) throw new Error('Saved server credentials are missing. Restore a compatible backup; OpenSport will not replace existing database credentials.')
      secrets = {
        OPENSPORT_NATIVE_DATABASE_PASSWORD: randomBytes(32).toString('hex'),
        OPENSPORT_NATIVE_POSTGRES_ROOT_KEY: randomBytes(32).toString('hex'),
        OPENSPORT_NATIVE_JWT_SECRET: randomBytes(32).toString('hex'),
        OPENSPORT_NATIVE_SECRET_KEY: `sb_secret_${randomBytes(32).toString('base64url')}`,
        OPENSPORT_NATIVE_PUBLISHABLE_KEY: `sb_publishable_${randomBytes(32).toString('base64url')}`,
      }
      await privateJson(secretsPath, secrets)
    }
    if (!validNativeSecrets(secrets)) {
      throw new Error('Saved server credentials are incomplete or belong to an older preview. Keep the data folder unchanged and restore a compatible backup before starting.')
    }
    this.secrets = secrets
    if (this.manifest?.dataRoot === this.dataDir) {
      // Stop a daemon left by an app crash before replacing functions, project
      // configuration, or any PostgreSQL launch files.
      await this.stopInternal()
    }
    const source = path.join(this.resourcesDir, 'supabase')
    for (const directory of ['migrations', 'functions']) {
      // Executable SQL/functions always come from this application, including
      // after restoring data. Never launch extra files carried by an archive.
      await rm(path.join(this.projectDir, 'supabase', directory), { recursive: true, force: true })
      await cp(path.join(source, directory), path.join(this.projectDir, 'supabase', directory), { recursive: true })
    }
    await writeFile(path.join(this.projectDir, 'supabase', 'config.toml'), nativeConfig(publicUrl), { mode: 0o600 })
    await writeFile(path.join(this.projectDir, '.env'), Object.entries({ ...secrets, OPENSPORT_NATIVE_SITE_URL: publicUrl }).map(([name, value]) => `${name}=${value}`).join('\n'), { mode: 0o600 })
    await chmod(path.join(this.projectDir, '.env'), 0o600)
    if (this.manifest?.dataRoot && this.manifest.dataRoot !== this.dataDir) {
      await relocateNativeState({ homeDir: this.homeDir, projectDir: this.projectDir, manifest: this.manifest, dataDir: this.dataDir })
      this.manifest.dataRoot = this.dataDir
      await privateJson(this.manifestPath, this.manifest)
    }
  }

  async start({ publicUrl } = {}) {
    if (this.config) return this.config
    if (this.operation) return this.operation
    const origin = localOrigin(publicUrl)
    this.operation = this.startInternal(origin).catch(async error => {
      // Even malformed startup output or a failed state write can follow a
      // successful daemon spawn. Cleanup belongs to the runtime, not callers.
      try { await this.stopInternal() }
      catch { throw new Error('OpenSport could not start or confirm that its local server stopped. Keep your saved data and reinstall the matching application before retrying.') }
      this.phase = 'error'
      throw error
    })
    try { return await this.operation } finally { this.operation = null }
  }

  async startInternal(publicUrl) {
    this.progress('preparing', 'Preparing your private local server…')
    await this.prepare(publicUrl)
    this.progress('downloading', 'Preparing verified native services. The first launch needs an internet connection…')
    const prepareArgs = ['stack', 'prepare', '--runtime', 'native', '--output-format', 'json', '--workdir', this.projectDir]
    if (this.manifest?.stackId) prepareArgs.push('--stack-id', this.manifest.stackId)
    await this.run(prepareArgs, { timeout: 20 * 60 * 1000, label: 'preparing native services', starting: true })
    await isolateNativeArtifacts(this.homeDir)
    await resetNativeDatabaseConfig({ homeDir: this.homeDir, stackId: this.manifest?.stackId })
    this.progress('starting', 'Starting the team server. The first launch downloads verified native services…')
    const args = ['stack', 'start', '--runtime', 'native', '--exclude', EXCLUDED_SERVICES, '--eager', '--output-format', 'json', '--workdir', this.projectDir]
    if (this.manifest?.stackId) args.push('--stack-id', this.manifest.stackId)
    let output
    const startupOutput = await this.run(args, { timeout: 20 * 60 * 1000, label: 'starting the team server', starting: true })
    try { output = JSON.parse(startupOutput) }
    catch { throw new Error('The local server returned an unreadable startup result. OpenSport stopped hosting.') }
    const result = output.result || output.value || output
    const env = result.env || {}
    if (result.runtime !== 'native' || !result.id || !env.API_URL || !env.ANON_KEY || !env.SERVICE_ROLE_KEY || !env.DB_URL) {
      throw new Error('The local server returned an unsupported startup result. Keep your saved data and reinstall the matching preview.')
    }
    for (const value of [env.API_URL, env.DB_URL]) {
      if (!['localhost', '127.0.0.1', '[::1]'].includes(new URL(value).hostname)) throw new Error('The Mac preview refused a nonlocal server endpoint.')
    }
    this.manifest = { format: NATIVE_MANIFEST_FORMAT, securityProfile: NATIVE_SECURITY_PROFILE, cliVersion: NATIVE_CLI_VERSION, dataRoot: this.dataDir, stackId: result.id, localOnly: true }
    await privateJson(this.manifestPath, this.manifest)
    const config = { apiUrl: env.API_URL.replace(/\/$/, ''), anonKey: env.ANON_KEY, serviceKey: env.SERVICE_ROLE_KEY, dbUrl: env.DB_URL, publicUrl, runtime: 'native', localOnly: true }
    try {
      this.progress('checking', 'Checking that the server is private to this Mac…')
      this.listenerAudit = await auditNativeListeners({ homeDir: this.homeDir, stackId: result.id })
      if (decodeURIComponent(new URL(config.dbUrl).password) !== this.secrets.OPENSPORT_NATIVE_DATABASE_PASSWORD) {
        throw new Error('The local database did not use this installation’s private credentials. Hosting was stopped.')
      }
      this.progress('checking', 'Checking database authentication…')
      this.authenticationAudit = await assertNativeDatabaseAuthentication(config.dbUrl)
      this.progress('migrating', 'Preparing your team records…')
      await this.migrate(config)
      await this.waitForDataApi(config)
      this.progress('connecting', 'Preparing live team updates…')
      await this.waitForRealtime(config)
      this.config = config
      this.progress('running', 'Your team server is running on this Mac.')
      return config
    } catch (error) {
      this.phase = 'error'
      throw error
    }
  }

  async migrate(config = this.config) {
    if (!config?.dbUrl) throw new Error('Start the local server before preparing team records.')
    const client = new pg.Client({ connectionString: config.dbUrl, connectionTimeoutMillis: 15000 })
    await client.connect()
    try {
      await client.query('BEGIN')
      await client.query('SELECT pg_advisory_xact_lock(728691)')
      await client.query('CREATE SCHEMA IF NOT EXISTS opensport_internal; REVOKE ALL ON SCHEMA opensport_internal FROM PUBLIC; CREATE TABLE IF NOT EXISTS opensport_internal.migrations(name text PRIMARY KEY, checksum text NOT NULL, applied_at timestamptz NOT NULL DEFAULT now())')
      await client.query('COMMIT')
      const directory = path.join(this.projectDir, 'supabase', 'migrations')
      const files = (await readdir(directory)).filter(name => /^[a-zA-Z0-9_-]+\.sql$/.test(name)).sort()
      if (!files.length) throw new Error('The application is missing its team database setup files.')
      for (const name of files) {
        const sql = await readFile(path.join(directory, name), 'utf8')
        const checksum = createHash('sha256').update(sql).digest('hex')
        await client.query('BEGIN')
        await client.query('SELECT pg_advisory_xact_lock(728691)')
        const previous = await client.query('SELECT checksum FROM opensport_internal.migrations WHERE name=$1', [name])
        if (previous.rows.length && previous.rows[0].checksum !== checksum) throw new Error('A previously installed database migration has changed. Keep your data and reinstall the matching application.')
        if (!previous.rows.length) {
          await client.query(sql)
          await client.query('INSERT INTO opensport_internal.migrations(name,checksum) VALUES ($1,$2)', [name, checksum])
        }
        await client.query('COMMIT')
      }
      await client.query("NOTIFY pgrst, 'reload schema'")
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {})
      if (error.message?.startsWith('A previously installed') || error.message?.startsWith('The application is missing')) throw error
      throw new Error('OpenSport could not prepare its team database. Your existing records have been preserved.')
    } finally { await client.end() }
  }

  async waitForDataApi(config) {
    // NOTIFY is asynchronous: the SQL transaction can finish before PostgREST
    // refreshes its schema cache. Do not hand a half-ready server to the wizard.
    const deadline = Date.now() + 30000
    while (Date.now() < deadline) {
      try {
        const response = await fetch(`${config.apiUrl}/rest/v1/team_settings?select=id&limit=1`, {
          headers: { apikey: config.serviceKey, Authorization: `Bearer ${config.serviceKey}` },
          signal: AbortSignal.timeout(3000),
        })
        if (response.ok) {
          const rows = await response.json()
          if (Array.isArray(rows) && rows.length === 1 && rows[0].id === 1) return
        }
      } catch { /* bounded retry while the local schema cache catches up */ }
      await new Promise(resolve => setTimeout(resolve, 250))
    }
    throw new Error('The local data service did not become ready. Your team records are safe; try starting again.')
  }

  async waitForRealtime(config) {
    // Realtime acknowledges a subscription before its first replication slot
    // finishes starting. Warm it without writing data, then verify PostgreSQL
    // is streaming before the app can create its first event or RSVP.
    const client = createClient(config.apiUrl, config.serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
      realtime: { transport: WebSocket },
    })
    const database = new pg.Client({ connectionString: config.dbUrl, connectionTimeoutMillis: 10000 })
    let ready = false
    try {
      const channel = client.channel('opensport-startup-readiness').on('postgres_changes', {
        event: 'UPDATE', schema: 'public', table: 'team_settings',
      }, () => {})
      await new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('Realtime startup timed out')), 30000)
        channel.subscribe(status => {
          if (status === 'SUBSCRIBED') { clearTimeout(timer); resolve() }
          if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') { clearTimeout(timer); reject(new Error('Realtime startup failed')) }
        })
      })
      await database.connect()
      const deadline = Date.now() + 30000
      while (Date.now() < deadline) {
        const stream = await database.query("SELECT 1 FROM pg_replication_slots WHERE slot_name = 'supabase_realtime_replication_slot' AND plugin = 'wal2json' AND active AND confirmed_flush_lsn IS NOT NULL")
        if (stream.rowCount === 1) {
          // Keep the tenant connected while the app hosts. Otherwise the
          // service can go idle and recreate this race for the next browser.
          this.realtimeClient = client
          ready = true
          return
        }
        await new Promise(resolve => setTimeout(resolve, 200))
      }
      throw new Error('Realtime database stream timed out')
    } catch {
      throw new Error('Live team updates did not become ready. Your records are safe; try starting the server again.')
    } finally {
      if (!ready) {
        await client.removeAllChannels().catch(() => {})
        client.realtime.disconnect()
      }
      await database.end().catch(() => {})
    }
  }

  async stop() {
    this.config = null
    if (this.startingProcess) this.startingProcess.kill('SIGTERM')
    if (this.operation) await this.operation.catch(() => {})
    return this.stopInternal()
  }

  async stopInternal() {
    this.config = null
    if (this.realtimeClient) {
      await this.realtimeClient.removeAllChannels().catch(() => {})
      this.realtimeClient.realtime.disconnect()
      this.realtimeClient = null
    }
    await mkdir(this.root, { recursive: true, mode: 0o700 })
    if (!await maybeJson(this.manifestPath) && !this.manifest) {
      // Startup can fail after the native daemon was created. Resolve only the
      // one app-owned stack under the app-specific SUPABASE_HOME in that case.
      try {
        const directories = (await readdir(path.join(this.homeDir, 'stacks'), { withFileTypes: true })).filter(item => item.isDirectory() && /^[a-f0-9]{64}$/.test(item.name))
        if (directories.length === 1) this.manifest = { stackId: directories[0].name }
      } catch { /* the server was never initialized */ }
    } else this.manifest = this.manifest || await maybeJson(this.manifestPath)
    if (!this.manifest?.stackId) { this.phase = 'stopped'; return }
    // Never reuse a successful hash from an earlier start: cleanup after a
    // failed verification must not execute the rejected replacement binary.
    await this.verifyLauncher()
    this.progress('stopping', 'Stopping your team server safely…')
    await this.run(['stack', 'stop', '--stack-id', this.manifest.stackId, '--output-format', 'json', '--workdir', this.projectDir], { label: 'stopping the team server' })
    this.phase = 'stopped'
  }

  getBackupPaths() {
    if (this.phase !== 'stopped' || this.operation) throw new Error('Stop the team server before saving a backup.')
    return { root: this.dataDir, include: ['runtime'], exclude: ['runtime/home/cache', 'runtime/native-diagnostics.log'], cliVersion: NATIVE_CLI_VERSION }
  }
}
