import { createHmac, randomBytes, createHash } from 'node:crypto'
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, renameSync, chmodSync, chownSync, openSync, readSync, closeSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { join } from 'node:path'

const [command, ...args] = process.argv.slice(2)
const state = process.env.OPENSPORT_CONTAINER_STATE || '/state'
const secret = (bytes = 32) => randomBytes(bytes).toString('hex')
const encode = (value) => Buffer.from(JSON.stringify(value)).toString('base64url')
const jwt = (key, role) => {
  const head = encode({ alg: 'HS256', typ: 'JWT' })
  const now = Math.floor(Date.now() / 1000)
  const body = encode({ role, iss: 'supabase', iat: now, exp: now + 10 * 365 * 86400 })
  return `${head}.${body}.${createHmac('sha256', key).update(`${head}.${body}`).digest('base64url')}`
}
const stdin = async () => { let value = ''; for await (const chunk of process.stdin) value += chunk; return value.replace(/\r?\n$/, '').split('\n') }
const digest = (path) => {
  const hash = createHash('sha256'); const buffer = Buffer.alloc(1024 * 1024); const descriptor = openSync(path, 'r')
  try { let bytes; while ((bytes = readSync(descriptor, buffer, 0, buffer.length, null)) > 0) hash.update(buffer.subarray(0, bytes)); return hash.digest('hex') }
  finally { closeSync(descriptor) }
}
const api = async (path, body, method = 'POST') => {
  const response = await fetch(`${process.env.SUPABASE_URL}${path}`, {
    method,
    headers: { Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`, apikey: process.env.SUPABASE_SERVICE_ROLE_KEY, 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const data = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(`${path}: ${data.msg || data.message || data.error_description || response.status}`)
  return data
}
const checkArchive = (path) => {
  if (!existsSync(path) || !existsSync(`${path}.sha256`)) throw new Error('Backup archive and its .sha256 file are both required.')
  if (digest(path) !== readFileSync(`${path}.sha256`, 'utf8').trim().split(/\s+/)[0]) throw new Error('Backup checksum does not match.')
  const names = execFileSync('tar', ['-tzf', path], { encoding: 'utf8' }).trim().split('\n')
  for (const name of names) {
    if (name.includes('..') || name.startsWith('/') || !/^volumes\/(postgres|storage|db-config|caddy-data)(\/|$)|^deployment(\/|$)|^state\/(\.env|backup-manifest\.json)$/.test(name)) throw new Error(`Invalid archive member: ${name}`)
  }
  const manifest = JSON.parse(execFileSync('tar', ['-xOzf', path, 'state/backup-manifest.json'], { encoding: 'utf8' }))
  if (manifest.format !== 1 || manifest.upstream !== 'self-hosted/v0.8.2' || manifest.arch !== process.arch) throw new Error('Restore requires the same Supabase release and CPU architecture as this backup.')
  return manifest
}

try {
  if (command === 'init') {
    if (existsSync(join(state, '.env'))) throw new Error('This installation is already initialized. Existing secrets were not changed.')
    const url = new URL(args[0] || 'http://localhost:8080')
    if (url.hostname === '[::1]') throw new Error('Use localhost or 127.0.0.1 for the local installation origin.')
    const local = ['localhost', '127.0.0.1'].includes(url.hostname)
    if (!['http:', 'https:'].includes(url.protocol) || url.pathname !== '/' || url.search || url.hash || url.username || url.password || (!local && url.protocol !== 'https:')) throw new Error('Use a local http://localhost:PORT origin or public https://team.example.org origin, without a path.')
    if (url.protocol === 'https:' && url.port) throw new Error('Public HTTPS requires standard ports 80 and 443; omit the port.')
    if (url.protocol === 'http:' && url.port && (Number(url.port) < 1 || Number(url.port) > 65534)) throw new Error('Choose a local HTTP port between 1 and 65534.')
    const publicUrl = url.origin
    const key = secret()
    const values = {
      PUBLIC_URL: publicUrl, CADDY_SITE: url.protocol === 'http:' ? 'http://:80' : publicUrl,
      BIND_ADDRESS: local ? '127.0.0.1' : '0.0.0.0', HTTP_PORT: url.protocol === 'http:' ? (url.port || '80') : '80', HTTPS_PORT: url.protocol === 'http:' ? String(Number(url.port || 8080) + 1) : '443',
      POSTGRES_PASSWORD: secret(), JWT_SECRET: key, ANON_KEY: jwt(key, 'anon'), SERVICE_ROLE_KEY: jwt(key, 'service_role'),
      SECRET_KEY_BASE: secret(64), REALTIME_DB_ENC_KEY: secret(8), DASHBOARD_USERNAME: 'opensport', DASHBOARD_PASSWORD: secret(),
      S3_PROTOCOL_ACCESS_KEY_ID: secret(16), S3_PROTOCOL_ACCESS_KEY_SECRET: secret(),
      POSTGRES_HOST: 'db', POSTGRES_PORT: '5432', POSTGRES_DB: 'postgres', JWT_EXPIRY: '3600', PGRST_DB_SCHEMAS: 'public',
      SITE_URL: publicUrl, API_EXTERNAL_URL: `${publicUrl}/api/auth/v1`, SUPABASE_PUBLIC_URL: `${publicUrl}/api`, ADDITIONAL_REDIRECT_URLS: publicUrl,
      DISABLE_SIGNUP: 'true', ENABLE_EMAIL_SIGNUP: 'true', ENABLE_EMAIL_AUTOCONFIRM: 'false', ENABLE_ANONYMOUS_USERS: 'false', ENABLE_PHONE_SIGNUP: 'false', ENABLE_PHONE_AUTOCONFIRM: 'false',
      SMTP_ADMIN_EMAIL: 'noreply@localhost', SMTP_HOST: '', SMTP_PORT: '587', SMTP_USER: '', SMTP_PASS: '', SMTP_SENDER_NAME: 'OpenSport',
      MAILER_URLPATHS_INVITE: '/verify', MAILER_URLPATHS_CONFIRMATION: '/verify', MAILER_URLPATHS_RECOVERY: '/verify', MAILER_URLPATHS_EMAIL_CHANGE: '/verify',
      FUNCTIONS_VERIFY_JWT: 'true', GLOBAL_S3_BUCKET: 'opensport', STORAGE_TENANT_ID: 'opensport', REGION: 'local', IMGPROXY_AUTO_WEBP: 'true',
    }
    mkdirSync(state, { recursive: true, mode: 0o700 })
    writeFileSync(join(state, '.env'), Object.entries(values).map(([k, v]) => `${k}=${v}`).join('\n') + '\n', { mode: 0o600, flag: 'wx' })
    console.log(`Initialized ${publicUrl}. Secrets are stored privately in the installation .env.`)
  } else if (command === 'bootstrap') {
    const [email, name, password] = await stdin()
    if (!email?.includes('@') || !name || typeof password !== 'string' || password.length < 12) throw new Error('Email, name, and a password with at least 12 characters are required.')
    const users = await api('/rest/v1/soccer_members?role=in.(admin,coach)&active=eq.true&select=id&limit=1', undefined, 'GET')
    if (users.length) throw new Error('An administrator already exists. Use recover for host-controlled recovery.')
    const user = await api('/auth/v1/admin/users', { email, password, email_confirm: true })
    try { await api('/rest/v1/rpc/bootstrap_owner', { p_user_id: user.id, p_email: email, p_name: name }) }
    catch (error) { await api(`/auth/v1/admin/users/${user.id}`, undefined, 'DELETE').catch(() => {}); throw error }
    console.log('First administrator created. Sign in with the password you entered.')
  } else if (command === 'recover') {
    const [email] = await stdin()
    if (!email?.includes('@')) throw new Error('An account email is required.')
    const result = await api('/auth/v1/admin/generate_link', { type: 'recovery', email, redirect_to: process.env.PUBLIC_URL })
    const user = result
    if (!user?.id || !result.hashed_token) throw new Error('Recovery link generation did not return a usable token.')
    // This command is host-only and explicitly restores administrator access.
    await api('/rest/v1/rpc/bootstrap_owner', { p_user_id: user.id, p_email: email, p_name: user.user_metadata?.name || email.split('@')[0] })
    console.log('Private one-use administrator recovery link (expires in one hour):')
    console.log(`${process.env.PUBLIC_URL}/?auth=recovery#token_hash=${encodeURIComponent(result.hashed_token)}&type=recovery`)
  } else if (command === 'backup') {
    if (!existsSync('/volumes/postgres/PG_VERSION')) throw new Error('No initialized database volume found. Start this installation successfully before backing it up.')
    const archive = join(state, 'backups', args[0])
    mkdirSync(join(state, 'backups'), { recursive: true, mode: 0o700 })
    const manifest = { format: 1, upstream: 'self-hosted/v0.8.2', arch: process.arch, createdAt: new Date().toISOString(), method: 'cold-volume-snapshot' }
    writeFileSync(join(state, 'backup-manifest.json'), JSON.stringify(manifest, null, 2), { mode: 0o600 })
    execFileSync('tar', ['-czf', `${archive}.partial`, '-C', '/', 'volumes/postgres', 'volumes/db-config', 'volumes/storage', 'volumes/caddy-data', 'state/.env', 'state/backup-manifest.json', 'deployment'])
    renameSync(`${archive}.partial`, archive); chmodSync(archive, 0o600)
    writeFileSync(`${archive}.sha256`, `${digest(archive)}\n`, { mode: 0o600 })
    const uid = Number(process.env.OPENSPORT_HOST_UID); const gid = Number(process.env.OPENSPORT_HOST_GID)
    if (!Number.isInteger(uid) || !Number.isInteger(gid) || uid < 0 || gid < 0) throw new Error('Backup requires valid host UID and GID for private archive ownership.')
    for (const path of [join(state, 'backups'), archive, `${archive}.sha256`, join(state, 'backup-manifest.json')]) chownSync(path, uid, gid)
    checkArchive(archive)
    console.log(`Verified backup archive: ${args[0]}`)
  } else if (command === 'restore-env') {
    const archive = join(state, 'backups', args[0]); checkArchive(archive)
    if (existsSync(join(state, '.env'))) throw new Error('Restore requires a fresh state directory without an existing .env.')
    writeFileSync(join(state, '.env'), execFileSync('tar', ['-xOzf', archive, 'state/.env']), { mode: 0o600, flag: 'wx' })
    console.log('Backup configuration validated and loaded.')
  } else if (command === 'restore') {
    const archive = join(state, 'backups', args[0]); checkArchive(archive)
    for (const name of ['postgres', 'db-config', 'storage', 'caddy-data']) {
      if (readdirSync(join('/volumes', name)).length) throw new Error(`Restore refuses nonempty ${name} volume. Use a fresh Compose project and state directory.`)
    }
    execFileSync('tar', ['-xzf', archive, '-C', '/', 'volumes/postgres', 'volumes/db-config', 'volumes/storage', 'volumes/caddy-data'])
    console.log('Volumes restored. Run up to validate service health and migrations.')
  } else if (command === 'validate') {
    const archive = join(state, 'backups', args[0]); const manifest = checkArchive(archive)
    console.log(`Backup is intact (${manifest.createdAt}, ${manifest.arch}). A restore rehearsal is still required.`)
  } else {
    throw new Error('Unknown operator action.')
  }
} catch (error) {
  console.error(`OpenSport: ${error.message}`)
  process.exitCode = 1
}
