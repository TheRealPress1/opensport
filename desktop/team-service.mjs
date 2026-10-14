// Main-process-only provisioning. Never expose this object or its runtime config
// to the renderer or through the browser-facing HTTP gateway.
import { randomUUID } from 'node:crypto'
import { mkdir, open, readFile, rename, rm } from 'node:fs/promises'
import { join, resolve } from 'node:path'

const operations = new Map()
const SETTINGS = 'id,name,season,timezone,sport_mode,scores_enabled,organizer_name,organizer_whatsapp'
const nonempty = (value, label, limit) => {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > limit) throw new Error(`${label} is required and must be at most ${limit} characters.`)
  return value.trim()
}
const emailAddress = value => {
  const email = nonempty(value, 'Email', 320).toLowerCase()
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(email)) throw new Error('Enter a valid email address.')
  return email
}
const localOrigin = value => {
  let url
  try { url = new URL(value) } catch { throw new Error('The local team service is not ready.') }
  if (!['http:', 'https:'].includes(url.protocol) || !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) || url.username || url.password || url.search || url.hash) throw new Error('Native setup only supports the local team service.')
  return url
}
function validateSetup(input) {
  const owner = {
    name: nonempty(input?.owner?.name, 'Administrator name', 100),
    email: emailAddress(input?.owner?.email),
    password: input?.owner?.password,
  }
  if (typeof owner.password !== 'string' || owner.password.length < 12 || owner.password.length > 1024 || !owner.password.trim()) throw new Error('Choose a password with at least 12 characters.')
  const team = {
    name: nonempty(input?.team?.name, 'Team name', 100),
    timezone: nonempty(input?.team?.timezone, 'Timezone', 100),
    sport_mode: input?.team?.sport_mode,
    season: String(input?.team?.season ?? new Date().getFullYear()),
    scores_enabled: input?.team?.scores_enabled ?? true,
    organizer_name: input?.team?.organizer_name ?? '',
    organizer_whatsapp: input?.team?.organizer_whatsapp ?? '',
  }
  try { new Intl.DateTimeFormat('en', { timeZone: team.timezone }).format() } catch { throw new Error('Choose a valid IANA timezone.') }
  if (!['general', 'soccer'].includes(team.sport_mode)) throw new Error('Choose General or Soccer mode.')
  if (team.season.length > 40 || typeof team.scores_enabled !== 'boolean' || typeof team.organizer_name !== 'string' || team.organizer_name.length > 100 || typeof team.organizer_whatsapp !== 'string' || !/^[0-9+ ()-]{0,30}$/u.test(team.organizer_whatsapp)) throw new Error('Check the season and optional organizer contact.')
  return { owner, team }
}

export class TeamService {
  #dataDir
  #getRuntimeConfig
  #getPublicUrl
  #fetch
  constructor({ dataDir, getRuntimeConfig, getPublicUrl, fetchImpl = globalThis.fetch }) {
    if (!dataDir || typeof getRuntimeConfig !== 'function') throw new Error('TeamService requires a private state directory and runtime provider.')
    this.#dataDir = resolve(dataDir)
    this.#getRuntimeConfig = getRuntimeConfig
    this.#getPublicUrl = getPublicUrl
    this.#fetch = fetchImpl
  }
  async #config() {
    const config = await this.#getRuntimeConfig()
    localOrigin(config?.apiUrl)
    if (typeof config?.serviceKey !== 'string' || !config.serviceKey) throw new Error('The local team service is not ready.')
    return config
  }
  async #request(path, { method = 'GET', body, operation = 'read the team', prefer } = {}) {
    const config = await this.#config()
    let response
    try {
      response = await this.#fetch(`${config.apiUrl.replace(/\/$/u, '')}${path}`, {
        method,
        headers: { Authorization: `Bearer ${config.serviceKey}`, apikey: config.serviceKey, 'Content-Type': 'application/json', ...(prefer ? { Prefer: prefer } : {}) },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        signal: AbortSignal.timeout(15000),
      })
    } catch { throw new Error(`Could not ${operation}. Check that the local service is running, then try again.`) }
    // Backend responses can contain private diagnostics. Only return a bounded,
    // recoverable status to the setup UI, never credentials or raw Auth bodies.
    if (!response.ok) throw new Error(`Could not ${operation} (HTTP ${response.status}). Please try again.`)
    if (response.status === 204) return null
    try { return await response.json() } catch { throw new Error(`The local service returned an invalid response while trying to ${operation}.`) }
  }
  async #checkpoint() {
    let raw
    try { raw = await readFile(join(this.#dataDir, 'team-setup.json'), 'utf8') }
    catch (error) { if (error.code === 'ENOENT') return null; throw error }
    let checkpoint
    try { checkpoint = JSON.parse(raw) } catch { throw new Error('The setup record is damaged. Restore a backup before continuing.') }
    if (checkpoint?.format !== 1 || typeof checkpoint.nonce !== 'string' || typeof checkpoint.email !== 'string' || !['prepared', 'owner-created', 'complete'].includes(checkpoint.phase)) throw new Error('The setup record is not supported. Restore a backup before continuing.')
    return checkpoint
  }
  async #save(checkpoint) {
    await mkdir(this.#dataDir, { recursive: true, mode: 0o700 })
    const temporary = join(this.#dataDir, `team-setup.${randomUUID()}.partial`)
    const file = await open(temporary, 'wx', 0o600)
    try { await file.writeFile(JSON.stringify(checkpoint, null, 2)); await file.sync() }
    finally { await file.close() }
    try { await rename(temporary, join(this.#dataDir, 'team-setup.json')) }
    finally { await rm(temporary, { force: true }) }
  }
  async #administrators() {
    return this.#request('/rest/v1/soccer_members?role=in.(admin,coach)&active=eq.true&select=id,user_id,name&limit=2')
  }
  async #settings() {
    const rows = await this.#request(`/rest/v1/team_settings?id=eq.1&select=${SETTINGS}`)
    if (!Array.isArray(rows) || rows.length !== 1) throw new Error('Team settings are unavailable. Complete the native database setup first.')
    return rows[0]
  }
  async status() {
    const checkpoint = await this.#checkpoint()
    const setupPending = !!checkpoint && checkpoint.phase !== 'complete'
    if (!await this.#getRuntimeConfig()) return {
      configured: checkpoint?.phase === 'complete', setupPending,
      ...(setupPending ? { pendingOwner: { name: checkpoint.name, email: checkpoint.email } } : {}),
      team: checkpoint?.team || null,
    }
    const [administrators, team] = await Promise.all([this.#administrators(), this.#settings()])
    return {
      configured: administrators.length > 0 && !setupPending,
      setupPending,
      ...(setupPending ? { pendingOwner: { name: checkpoint.name, email: checkpoint.email } } : {}),
      team,
    }
  }
  async setup(input) {
    const validated = validateSetup(input)
    if (operations.has(this.#dataDir)) throw new Error('Setup is already in progress. Wait for it to finish before retrying.')
    const operation = this.#setup(validated)
    operations.set(this.#dataDir, operation)
    try { return await operation } finally { operations.delete(this.#dataDir) }
  }
  async #setup({ owner, team }) {
    let checkpoint = await this.#checkpoint()
    const administrators = await this.#administrators()
    if (!checkpoint && administrators.length) throw new Error('This team already has an administrator. Sign in or use administrator recovery.')
    if (checkpoint && checkpoint.email !== owner.email) throw new Error(`Finish the existing setup for ${checkpoint.email}, or restore an empty installation.`)
    if (!checkpoint) {
      checkpoint = { format: 1, nonce: randomUUID(), email: owner.email, name: owner.name, phase: 'prepared', createdAt: new Date().toISOString() }
      await this.#save(checkpoint)
    }
    // Locate the Auth account on every retry. Creation may have succeeded before
    // the previous process lost its response; the durable nonce proves that the
    // account belongs to this setup, rather than another person's membership.
    const existing = await this.#request('/rest/v1/rpc/find_invitation_user', { method: 'POST', body: { p_email: owner.email }, operation: 'find the setup account' })
    let user
    if (existing?.id) {
      user = await this.#request(`/auth/v1/admin/users/${encodeURIComponent(existing.id)}`, { operation: 'verify the setup account' })
      if (user?.user_metadata?.opensport_setup_id !== checkpoint.nonce || user.email?.toLowerCase() !== owner.email) throw new Error('That account already exists outside this setup. Use administrator recovery instead.')
    } else {
      if (checkpoint.userId || administrators.length) throw new Error('The setup account is missing. Restore a backup or use administrator recovery.')
      user = await this.#request('/auth/v1/admin/users', { method: 'POST', body: { email: owner.email, password: owner.password, email_confirm: true, user_metadata: { name: owner.name, opensport_setup_id: checkpoint.nonce } }, operation: 'create the administrator account' })
    }
    if (!user?.id || !user.email_confirmed_at) throw new Error('The administrator account could not be confirmed. Retry setup.')
    if (administrators.some(member => member.user_id !== user.id)) throw new Error('Another administrator already manages this team. Use administrator recovery instead.')
    if (checkpoint.phase === 'complete') return { configured: true, team: await this.#settings(), owner: { id: user.id, name: checkpoint.name, email: checkpoint.email } }
    checkpoint = { ...checkpoint, userId: user.id, name: owner.name }
    await this.#save(checkpoint)
    // A retry may contain an updated password after the initial form failed.
    // Apply it explicitly so a successful wizard always accepts its final input.
    if (existing?.id) await this.#request(`/auth/v1/admin/users/${encodeURIComponent(user.id)}`, { method: 'PUT', body: { password: owner.password, email_confirm: true, user_metadata: { ...user.user_metadata, name: owner.name } }, operation: 'finish the administrator account' })
    await this.#request('/rest/v1/rpc/bootstrap_owner', { method: 'POST', body: { p_user_id: user.id, p_email: owner.email, p_name: owner.name }, operation: 'create administrator access' })
    await this.#save({ ...checkpoint, phase: 'owner-created' })
    const updated = await this.#request('/rest/v1/team_settings?id=eq.1', { method: 'PATCH', body: team, prefer: 'return=representation', operation: 'save team settings' })
    if (!Array.isArray(updated) || updated.length !== 1) throw new Error('Team settings were not saved. Retry setup to finish.')
    const savedTeam = Object.fromEntries(SETTINGS.split(',').map(key => [key, updated[0][key]]))
    await this.#save({ ...checkpoint, phase: 'complete', team: savedTeam, completedAt: new Date().toISOString() })
    return { configured: true, team: savedTeam, owner: { id: user.id, name: owner.name, email: owner.email } }
  }
  async recoverOwner(emailInput) {
    const email = emailAddress(emailInput)
    if (operations.has(this.#dataDir)) throw new Error('Finish the current setup before recovering administrator access.')
    const config = await this.#config()
    const publicUrl = localOrigin(this.#getPublicUrl ? await this.#getPublicUrl() : config.publicUrl).origin
    const result = await this.#request('/auth/v1/admin/generate_link', { method: 'POST', body: { type: 'recovery', email, redirect_to: publicUrl }, operation: 'create the recovery link' })
    if (!result?.id || !result.hashed_token || result.email?.toLowerCase() !== email) throw new Error('The recovery link was not created. Check the account email and try again.')
    await this.#request('/rest/v1/rpc/bootstrap_owner', { method: 'POST', body: { p_user_id: result.id, p_email: email, p_name: result.user_metadata?.name || email.split('@')[0] }, operation: 'restore administrator access' })
    return { link: `${publicUrl}/?auth=recovery#token_hash=${encodeURIComponent(result.hashed_token)}&type=recovery`, expiresAt: new Date(Date.now() + 3600000).toISOString() }
  }
}
