// Team administration shared by both hosts: the self-hosted Edge Runtime (Deno)
// and one-click cloud installs on Vercel (Node). Never import it into Vite.
// Built-in fetch keeps the production runtime independent of package registries.

export class ApiError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

export const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Opaque Supabase keys (sb_publishable_…, sb_secret_…) are rejected in the
// Authorization header, so they travel as apikey only. Legacy JWT keys and user
// session tokens keep the Authorization header the self-hosted gateways expect.
export async function supabaseApi(env, path, body, token = env.serviceKey, method = body === undefined ? 'GET' : 'POST') {
  const headers = { apikey: token === env.serviceKey ? env.serviceKey : env.anonKey, 'Content-Type': 'application/json' };
  if (!token.startsWith('sb_')) headers.Authorization = `Bearer ${token}`;
  const response = await fetch(`${env.url}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(15000),
  });
  const text = await response.text();
  let result = null;
  try { result = text ? JSON.parse(text) : null; } catch { /* report a safe error below */ }
  if (!response.ok) {
    const message = String(result?.msg || result?.message || result?.error_description || 'The request could not be completed');
    const error = new ApiError(response.status >= 500 ? 502 : response.status, message);
    error.code = result?.code || result?.error_code;
    throw error;
  }
  return result;
}

export async function oneMember(env, column, value) {
  if (!uuidPattern.test(value)) throw new ApiError(400, 'Invalid member');
  const rows = await supabaseApi(env, `/rest/v1/soccer_members?${column}=eq.${value}&select=id,user_id,name,role,active,onboarding_completed_at&limit=1`);
  return rows[0] || null;
}

export function accessLink(env, mode, type, token, invitationId) {
  const url = new URL(env.siteUrl);
  url.searchParams.set('auth', mode);
  const hash = new URLSearchParams({ token_hash: token, type });
  if (invitationId) hash.set('invitation_id', invitationId);
  url.hash = hash.toString();
  return url.toString();
}

export function requireEnvironment(env) {
  const url = env?.url?.replace(/\/$/, '');
  const siteUrl = env?.siteUrl?.replace(/\/$/, '');
  if (!url || !env.serviceKey || !env.anonKey || !siteUrl) throw new ApiError(503, 'Team administration is not configured');
  return { ...env, url, siteUrl };
}

// Serializes requests for each email within one server instance, avoiding two
// simultaneous invite clicks leaving the DB digest and Auth token out of sync.
// Cloud installs can run several instances; a clash there only spoils both links,
// and the administrator creates a new one.
const invitationLocks = new Map();
async function invite(env, email, name) {
  const previous = invitationLocks.get(email) || Promise.resolve();
  const task = previous.catch(() => {}).then(async () => {
    let existing = await supabaseApi(env, '/rest/v1/rpc/find_invitation_user', { p_email: email });
    if (existing) {
      const member = await oneMember(env, 'user_id', String(existing.id));
      if (member?.onboarding_completed_at) throw new ApiError(409, 'This person already has a membership. Use recovery or change their access instead.');
      // Every OpenSport invitation creates a membership, so an account without one was
      // registered some other way, such as an open Supabase sign-up. Replace it so
      // whoever claimed this address first keeps no password or session.
      if (!member) {
        await supabaseApi(env, `/auth/v1/admin/users/${existing.id}`, undefined, env.serviceKey, 'DELETE');
        existing = null;
      }
    }
    // A person who verified an earlier link but left before completing their
    // profile needs a recovery token; Auth rejects a fresh invite for that user.
    const type = existing?.email_confirmed_at ? 'recovery' : 'invite';
    const generated = await supabaseApi(env, '/auth/v1/admin/generate_link', { type, email });
    if (!uuidPattern.test(String(generated.id)) || typeof generated.hashed_token !== 'string') throw new ApiError(502, 'Auth did not return a valid invitation');
    const invitation = await supabaseApi(env, '/rest/v1/rpc/issue_invitation', {
      p_user_id: generated.id, p_email: email, p_name: name, p_token_hash: generated.hashed_token,
    });
    return {
      link: accessLink(env, 'invite', type, generated.hashed_token, String(invitation.id)),
      invitation,
      expires_at: invitation.expires_at,
    };
  });
  invitationLocks.set(email, task);
  try { return await task; } finally { if (invitationLocks.get(email) === task) invitationLocks.delete(email); }
}

export function jsonHeaders() {
  return new Headers({ 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'Vary': 'Origin' });
}

export function errorResponse(error, headers) {
  // Errors contain neither action links nor service credentials.
  const status = error instanceof ApiError ? error.status : 503;
  const message = error instanceof ApiError ? error.message : 'Team administration is temporarily unavailable. Please retry.';
  return new Response(JSON.stringify({ error: message }), { status, headers });
}

export async function readJson(request) {
  if (Number(request.headers.get('Content-Length')) > 16384) throw new ApiError(413, 'Request is too large');
  const raw = await request.text();
  if (raw.length > 16384) throw new ApiError(413, 'Request is too large');
  let body;
  try { body = JSON.parse(raw); } catch { throw new ApiError(400, 'Invalid JSON'); }
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new ApiError(400, 'Invalid request');
  return body;
}

// Browsers may call from the configured site, or from the very address that
// serves this function (a cloud install opened at another of its domains).
export function originAllowed(request, allowedOrigins) {
  const origin = request.headers.get('Origin');
  return !origin || origin === new URL(request.url).origin || allowedOrigins.includes(origin);
}

// readEnvironment returns { url, serviceKey, anonKey, siteUrl, allowedOrigins? }.
export function createTeamAdminHandler(readEnvironment) {
  return async function handleTeamAdmin(request) {
    const headers = jsonHeaders();
    try {
      const env = requireEnvironment(readEnvironment());
      const allowedOrigins = env.allowedOrigins?.length ? env.allowedOrigins : [new URL(env.siteUrl).origin];
      if (!originAllowed(request, allowedOrigins)) throw new ApiError(403, 'This origin is not allowed');
      const origin = request.headers.get('Origin');
      if (origin) headers.set('Access-Control-Allow-Origin', origin);
      headers.set('Access-Control-Allow-Headers', 'authorization, apikey, content-type, x-client-info');
      headers.set('Access-Control-Allow-Methods', 'POST, OPTIONS');
      if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers });
      if (request.method !== 'POST') throw new ApiError(405, 'Use POST');
      const authorization = request.headers.get('Authorization') || '';
      if (!/^Bearer \S+$/i.test(authorization)) throw new ApiError(401, 'Sign in to continue');
      const token = authorization.slice(7);
      // Do not trust browser-supplied roles or an unverified JWT payload.
      const user = await supabaseApi(env, '/auth/v1/user', undefined, token);
      const caller = await oneMember(env, 'user_id', String(user.id));
      if (!caller?.active || !caller.onboarding_completed_at || !['admin', 'coach'].includes(String(caller.role))) throw new ApiError(403, 'Administrator access required');
      const body = await readJson(request);
      let result;
      switch (body.action) {
        case 'invite': {
          const email = String(body.email || '').trim().toLowerCase();
          if (email.length > 320 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new ApiError(400, 'Enter a valid email address');
          const name = String(body.name || email.split('@')[0]).trim();
          if (!name || name.length > 100) throw new ApiError(400, 'Name must contain 1 to 100 characters');
          result = await invite(env, email, name);
          break;
        }
        case 'recovery': {
          const member = await oneMember(env, 'id', String(body.member_id || ''));
          if (!member?.active || !member.onboarding_completed_at) throw new ApiError(404, 'Active member not found');
          const authUser = await supabaseApi(env, `/auth/v1/admin/users/${member.user_id}`);
          const generated = await supabaseApi(env, '/auth/v1/admin/generate_link', { type: 'recovery', email: authUser.email });
          if (typeof generated.hashed_token !== 'string') throw new ApiError(502, 'Auth did not return a recovery link');
          result = { link: accessLink(env, 'recovery', 'recovery', generated.hashed_token), expires_at: new Date(Date.now() + 3600000).toISOString() };
          break;
        }
        case 'revoke-invite': {
          if (!uuidPattern.test(String(body.invitation_id))) throw new ApiError(400, 'Invalid invitation');
          // Invoke using the caller's token: the RPC rechecks live membership.
          await supabaseApi(env, '/rest/v1/rpc/revoke_invitation', { p_invitation_id: body.invitation_id }, token);
          result = { ok: true };
          break;
        }
        default: throw new ApiError(400, 'Unknown action');
      }
      return new Response(JSON.stringify(result), { status: 200, headers });
    } catch (error) {
      return errorResponse(error, headers);
    }
  };
}
