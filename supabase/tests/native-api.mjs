// Destructive only to uniquely named test fixtures on an explicitly local stack.
// The stack must already contain an owner so fixture cleanup cannot remove its
// final administrator. Never point this test at a user's deployed team.
import { readFileSync } from 'node:fs'
import { randomBytes } from 'node:crypto'

const fileArgument = process.argv.indexOf('--env-file')
const fileEnv = fileArgument < 0 ? {} : Object.fromEntries(readFileSync(process.argv[fileArgument + 1], 'utf8').split('\n').filter(line => line && !line.startsWith('#')).map(line => {
  const split = line.indexOf('=')
  return [line.slice(0, split), line.slice(split + 1)]
}))
const origin = new URL(process.env.OPENSPORT_TEST_URL || fileEnv.PUBLIC_URL || 'http://localhost:8080')
if (!['localhost', '127.0.0.1', '[::1]'].includes(origin.hostname) || origin.pathname !== '/') throw new Error('Native tests require a loopback app origin without a path')
const base = `${origin.origin}/api`
const anonKey = process.env.OPENSPORT_TEST_ANON_KEY || fileEnv.ANON_KEY
const serviceKey = process.env.OPENSPORT_TEST_SERVICE_ROLE_KEY || fileEnv.SERVICE_ROLE_KEY
if (!anonKey || !serviceKey) throw new Error('Provide the native test anon/service keys through environment variables or --env-file')
const runId = `${Date.now()}-${randomBytes(3).toString('hex')}`
const password = `OpenSport-${randomBytes(24).toString('hex')}`
const userIds = new Set()
const eventIds = new Set()
let checks = 0

async function call(path, { token = serviceKey, method = 'GET', body, status } = {}) {
  const response = await fetch(`${base}${path}`, {
    method,
    headers: { apikey: token === serviceKey ? serviceKey : anonKey, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', Prefer: 'return=representation' },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(20000),
  })
  const raw = await response.text()
  let data
  try { data = raw ? JSON.parse(raw) : null } catch { data = null }
  if (status !== undefined && response.status !== status) throw new Error(`${method} ${path.split('?')[0]}: expected status ${status}, received ${response.status} (${data?.error_code || data?.code || 'no-code'})`)
  if (status === undefined && !response.ok) throw new Error(`${method} ${path.split('?')[0]} failed with ${response.status} (${data?.error_code || data?.code || 'no-code'})`)
  return { data, status: response.status, ok: response.ok }
}
function ok(condition, label) { if (!condition) throw new Error(`FAIL: ${label}`); checks++; console.log(`ok - ${label}`) }
const rpc = async (name, body, token) => (await call(`/rest/v1/rpc/${name}`, { method: 'POST', body, token })).data
const edge = async (body, token) => (await call('/functions/v1/team-admin', { method: 'POST', body, token })).data
async function login(email, loginPassword = password) {
  return (await call('/auth/v1/token?grant_type=password', { token: anonKey, method: 'POST', body: { email, password: loginPassword } })).data
}
async function invitation(label, adminToken) {
  const issued = await edge({ action: 'invite', email: `native-${runId}-${label}@example.test`, name: `API fixture ${label}` }, adminToken)
  userIds.add(issued.invitation.user_id)
  const fragment = new URLSearchParams(new URL(issued.link).hash.slice(1))
  return { id: issued.invitation.id, userId: issued.invitation.user_id, email: `native-${runId}-${label}@example.test`, hash: fragment.get('token_hash'), type: fragment.get('type') }
}
async function verify(invite) {
  return (await call('/auth/v1/verify', { token: anonKey, method: 'POST', body: { token_hash: invite.hash, type: invite.type } })).data
}
async function setPassword(token, next = password) {
  return call('/auth/v1/user', { token, method: 'PUT', body: { password: next } })
}
function acceptance(invite) { return { p_invitation_id: invite.id, p_token_hash: invite.hash, p_name: 'Native API player', p_jersey_number: null, p_position: '', p_phone: null } }
async function rejectedCompletion(invite, token, label) {
  const result = await call('/rest/v1/rpc/complete_invitation', { token, method: 'POST', body: acceptance(invite), status: 403 })
  ok(result.data?.code === '42501', label)
}
async function privateEventCount(eventId, token) {
  return (await call(`/rest/v1/soccer_events?id=eq.${eventId}&select=id`, { token })).data.length
}

try {
  const owners = await call('/rest/v1/soccer_members?active=eq.true&role=in.(admin,coach)&select=id&limit=1')
  if (!owners.data.length) throw new Error('Bootstrap a synthetic owner before running native tests')
  const adminEmail = `native-${runId}-admin@example.test`
  const created = (await call('/auth/v1/admin/users', { method: 'POST', body: { email: adminEmail, password, email_confirm: true } })).data
  userIds.add(created.id)
  const adminMember = await rpc('bootstrap_owner', { p_user_id: created.id, p_email: adminEmail, p_name: 'Native API fixture admin' })
  const admin = await login(adminEmail)
  const adminToken = admin.access_token
  const event = (await call('/rest/v1/soccer_events', { token: adminToken, method: 'POST', body: { type: 'other', title: `Native API fixture ${runId}`, date: '2099-12-30', created_by: adminMember.id } })).data[0]
  eventIds.add(event.id)
  ok(await privateEventCount(event.id, anonKey) === 0, 'native anonymous API cannot read team events')
  const signup = await call('/auth/v1/signup', { token: anonKey, method: 'POST', body: { email: `native-${runId}-unauthorized@example.test`, password }, status: 422 })
  ok(signup.data?.error_code === 'signup_disabled', 'public Auth registration is disabled')

  const accepted = await invitation('accepted', adminToken)
  const pendingSession = await verify(accepted)
  ok(await privateEventCount(event.id, pendingSession.access_token) === 0, 'native verified invite session has no team access before acceptance')
  await rejectedCompletion(accepted, pendingSession.access_token, 'native invitation cannot complete before password setup')
  await setPassword(pendingSession.access_token)
  const playerMember = await rpc('complete_invitation', acceptance(accepted), pendingSession.access_token)
  ok(playerMember.active && playerMember.onboarding_completed_at, 'native verify/password/accept flow creates active membership without SMTP')
  ok(await privateEventCount(event.id, pendingSession.access_token) === 1, 'completed member receives team data')
  await rejectedCompletion(accepted, pendingSession.access_token, 'application acceptance token cannot be replayed')
  const nativeReplay = await call('/auth/v1/verify', { token: anonKey, method: 'POST', body: { token_hash: accepted.hash, type: accepted.type }, status: 403 })
  ok(nativeReplay.data?.error_code === 'otp_expired', 'native Auth invitation token cannot be replayed')

  const playerToken = pendingSession.access_token
  const promotion = await call(`/rest/v1/soccer_members?id=eq.${playerMember.id}`, { token: playerToken, method: 'PATCH', body: { role: 'admin' }, status: 403 })
  ok(promotion.data?.code === '42501', 'native REST rejects direct self-promotion')
  await call('/auth/v1/user', { token: playerToken, method: 'PUT', body: { data: { role: 'admin', active: true } } })
  const privilege = await call('/rest/v1/rpc/set_member_access', { token: playerToken, method: 'POST', body: { p_member_id: playerMember.id, p_role: 'admin' }, status: 403 })
  ok(privilege.data?.code === '42501', 'user-controlled Auth metadata cannot grant administrator access')
  const deniedInvite = await call('/functions/v1/team-admin', { token: playerToken, method: 'POST', body: { action: 'invite', email: `native-${runId}-attack@example.test` }, status: 403 })
  ok(deniedInvite.data?.error === 'Administrator access required', 'native Edge Function denies player invitation generation')
  const deniedWrite = await call('/rest/v1/soccer_events', { token: playerToken, method: 'POST', body: { type: 'other', title: 'Unauthorized fixture', date: '2099-12-30', created_by: playerMember.id }, status: 403 })
  ok(deniedWrite.data?.code === '42501', 'native REST rejects player event creation')
  const contacts = await call('/rest/v1/soccer_member_contacts?select=member_id,email,phone', { token: playerToken })
  ok(contacts.data.length === 1 && contacts.data[0].member_id === playerMember.id, 'native REST restricts player contacts to their own row')
  const foreignRsvp = await call('/rest/v1/soccer_rsvps', { token: playerToken, method: 'POST', body: { event_id: event.id, member_id: adminMember.id, status: 'going' }, status: 403 })
  ok(foreignRsvp.data?.code === '42501', 'native REST rejects RSVP impersonation')

  const revoked = await invitation('revoked', adminToken)
  await edge({ action: 'revoke-invite', invitation_id: revoked.id }, adminToken)
  const revokedSession = await verify(revoked)
  await setPassword(revokedSession.access_token)
  await rejectedCompletion(revoked, revokedSession.access_token, 'revoked application invite stays blocked after native Auth verification')
  ok(await privateEventCount(event.id, revokedSession.access_token) === 0, 'revoked invitation cannot read team data with its valid Auth session')

  const expired = await invitation('expired', adminToken)
  await call(`/rest/v1/team_invitations?id=eq.${expired.id}`, { method: 'PATCH', body: { expires_at: new Date(Date.now() - 60000).toISOString() } })
  const expiredSession = await verify(expired)
  await setPassword(expiredSession.access_token)
  await rejectedCompletion(expired, expiredSession.access_token, 'expired application invite stays blocked after native Auth verification')
  ok(await privateEventCount(event.id, expiredSession.access_token) === 0, 'expired invitation has no team access')

  const original = await invitation('reissued', adminToken)
  const originalSession = await verify(original)
  await setPassword(originalSession.access_token)
  const replacement = await invitation('reissued', adminToken)
  ok(replacement.type === 'recovery', 'reissuing interrupted verified onboarding uses native recovery token')
  await rejectedCompletion(original, originalSession.access_token, 'reissue invalidates prior application acceptance credential')
  const replacementSession = await verify(replacement)
  await setPassword(replacementSession.access_token, `Replacement-${randomBytes(24).toString('hex')}`)
  const replacementMember = await rpc('complete_invitation', acceptance(replacement), replacementSession.access_token)
  ok(replacementMember.active, 'replacement invitation completes successfully')

  // Password changes revoke other refresh sessions. Already-issued stateless
  // access JWTs can remain usable until expiry; membership deactivation below
  // demonstrates the immediate application-level access boundary.
  const oldSession = await login(accepted.email)
  const recovery = await edge({ action: 'recovery', member_id: playerMember.id }, adminToken)
  const recoveryParams = new URLSearchParams(new URL(recovery.link).hash.slice(1))
  const recoveredSession = await verify({ hash: recoveryParams.get('token_hash'), type: 'recovery' })
  const newPassword = `Recovered-${randomBytes(24).toString('hex')}`
  await setPassword(recoveredSession.access_token, newPassword)
  const newSession = await login(accepted.email, newPassword)
  ok(Boolean(newSession.access_token), 'native administrator-issued password recovery works without SMTP')
  const oldPassword = await call('/auth/v1/token?grant_type=password', { token: anonKey, method: 'POST', body: { email: accepted.email, password }, status: 400 })
  ok(oldPassword.data?.error_code === 'invalid_credentials', 'old password no longer signs in after recovery')
  const oldRefresh = await call('/auth/v1/token?grant_type=refresh_token', { token: anonKey, method: 'POST', body: { refresh_token: oldSession.refresh_token }, status: 400 })
  ok(['refresh_token_not_found', 'refresh_token_already_used'].includes(oldRefresh.data?.error_code), 'password recovery revokes the prior refresh session')
  const oldJwtRows = await privateEventCount(event.id, oldSession.access_token)
  console.log(`note - previously issued access JWT ${oldJwtRows ? 'remains valid until expiry' : 'is no longer accepted'} after recovery; membership checks are independent`)
  await rpc('set_member_access', { p_member_id: playerMember.id, p_active: false }, adminToken)
  ok(await privateEventCount(event.id, oldSession.access_token) === 0, 'deactivation blocks pre-recovery access JWT immediately through RLS')
  ok(await privateEventCount(event.id, newSession.access_token) === 0, 'deactivation blocks newly authenticated sessions through RLS')
  const inactiveWrite = await call('/rest/v1/soccer_rsvps', { token: newSession.access_token, method: 'POST', body: { event_id: event.id, member_id: playerMember.id, status: 'going' }, status: 403 })
  ok(inactiveWrite.data?.code === '42501', 'deactivated membership cannot write with a valid Auth session')
  console.log(`Native API acceptance passed: ${checks} checks.`)
} finally {
  // Preserve every preexisting account/event, including the browser test owner.
  for (const id of eventIds) await call(`/rest/v1/soccer_events?id=eq.${id}`, { method: 'DELETE' })
  for (const id of userIds) {
    await call(`/rest/v1/team_invitations?user_id=eq.${id}`, { method: 'DELETE' })
    await call(`/rest/v1/soccer_members?user_id=eq.${id}`, { method: 'DELETE' })
    await call(`/auth/v1/admin/users/${id}`, { method: 'DELETE' })
  }
  console.log('Native API fixtures removed; preexisting team data preserved.')
}
