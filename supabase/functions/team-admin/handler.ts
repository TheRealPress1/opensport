// This endpoint runs on the installation's server. Never import it into Vite.
// Built-in fetch keeps the production runtime independent of package registries.
type Json = Record<string, unknown>;
type Env = { url: string; serviceKey: string; anonKey: string; siteUrl: string };

class ApiError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function environment(): Env {
  const url = Deno.env.get('SUPABASE_URL')?.replace(/\/$/, '');
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY');
  const siteUrl = Deno.env.get('SITE_URL')?.replace(/\/$/, '');
  if (!url || !serviceKey || !anonKey || !siteUrl) throw new ApiError(503, 'Team administration is not configured');
  return { url, serviceKey, anonKey, siteUrl };
}

async function api(env: Env, path: string, body?: Json, token = env.serviceKey): Promise<unknown> {
  const response = await fetch(`${env.url}${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: {
      apikey: token === env.serviceKey ? env.serviceKey : env.anonKey,
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(15000),
  });
  const text = await response.text();
  let result: unknown = null;
  try { result = text ? JSON.parse(text) : null; } catch { /* report a safe error below */ }
  if (!response.ok) {
    const error = result as Json | null;
    const message = String(error?.msg || error?.message || error?.error_description || 'The request could not be completed');
    throw new ApiError(response.status >= 500 ? 502 : response.status, message);
  }
  return result;
}

async function oneMember(env: Env, column: 'id' | 'user_id', value: string): Promise<Json | null> {
  if (!uuidPattern.test(value)) throw new ApiError(400, 'Invalid member');
  const rows = await api(env, `/rest/v1/soccer_members?${column}=eq.${value}&select=id,user_id,name,role,active,onboarding_completed_at&limit=1`) as Json[];
  return rows[0] || null;
}

function link(env: Env, mode: 'invite' | 'recovery', type: string, token: string, invitationId?: string): string {
  const url = new URL(env.siteUrl);
  url.searchParams.set('auth', mode);
  const hash = new URLSearchParams({ token_hash: token, type });
  if (invitationId) hash.set('invitation_id', invitationId);
  url.hash = hash.toString();
  return url.toString();
}

// The single production handler serializes requests for each email, avoiding
// two simultaneous invite clicks leaving the DB digest and Auth token out of sync.
const invitationLocks = new Map<string, Promise<unknown>>();
async function invite(env: Env, email: string, name: string): Promise<Json> {
  const previous = invitationLocks.get(email) || Promise.resolve();
  const task = previous.catch(() => {}).then(async () => {
    const existing = await api(env, '/rest/v1/rpc/find_invitation_user', { p_email: email }) as Json | null;
    if (existing) {
      const member = await oneMember(env, 'user_id', String(existing.id));
      if (member?.onboarding_completed_at) throw new ApiError(409, 'This person already has a membership. Use recovery or change their access instead.');
    }
    // A person who verified an earlier link but left before completing their
    // profile needs a recovery token; Auth rejects a fresh invite for that user.
    const type = existing?.email_confirmed_at ? 'recovery' : 'invite';
    const generated = await api(env, '/auth/v1/admin/generate_link', { type, email }) as Json;
    if (!uuidPattern.test(String(generated.id)) || typeof generated.hashed_token !== 'string') throw new ApiError(502, 'Auth did not return a valid invitation');
    const invitation = await api(env, '/rest/v1/rpc/issue_invitation', {
      p_user_id: generated.id, p_email: email, p_name: name, p_token_hash: generated.hashed_token,
    }) as Json;
    return {
      link: link(env, 'invite', type, generated.hashed_token, String(invitation.id)),
      invitation,
      expires_at: invitation.expires_at,
    };
  });
  invitationLocks.set(email, task);
  try { return await task; } finally { if (invitationLocks.get(email) === task) invitationLocks.delete(email); }
}

export async function handleTeamAdmin(request: Request): Promise<Response> {
  const headers = new Headers({ 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'Vary': 'Origin' });
  try {
    const env = environment();
    const origin = request.headers.get('Origin');
    if (origin && origin !== new URL(env.siteUrl).origin) throw new ApiError(403, 'This origin is not allowed');
    if (origin) headers.set('Access-Control-Allow-Origin', origin);
    headers.set('Access-Control-Allow-Headers', 'authorization, apikey, content-type, x-client-info');
    headers.set('Access-Control-Allow-Methods', 'POST, OPTIONS');
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers });
    if (request.method !== 'POST') throw new ApiError(405, 'Use POST');
    const authorization = request.headers.get('Authorization') || '';
    if (!/^Bearer \S+$/i.test(authorization)) throw new ApiError(401, 'Sign in to continue');
    const token = authorization.slice(7);
    // Do not trust browser-supplied roles or an unverified JWT payload.
    const user = await api(env, '/auth/v1/user', undefined, token) as Json;
    const caller = await oneMember(env, 'user_id', String(user.id));
    if (!caller?.active || !caller.onboarding_completed_at || !['admin', 'coach'].includes(String(caller.role))) throw new ApiError(403, 'Administrator access required');
    if (Number(request.headers.get('Content-Length')) > 16384) throw new ApiError(413, 'Request is too large');
    const raw = await request.text();
    if (raw.length > 16384) throw new ApiError(413, 'Request is too large');
    let body: Json;
    try { body = JSON.parse(raw); } catch { throw new ApiError(400, 'Invalid JSON'); }
    if (!body || Array.isArray(body)) throw new ApiError(400, 'Invalid request');
    let result: Json;
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
        const authUser = await api(env, `/auth/v1/admin/users/${member.user_id}`) as Json;
        const generated = await api(env, '/auth/v1/admin/generate_link', { type: 'recovery', email: authUser.email }) as Json;
        if (typeof generated.hashed_token !== 'string') throw new ApiError(502, 'Auth did not return a recovery link');
        result = { link: link(env, 'recovery', 'recovery', generated.hashed_token), expires_at: new Date(Date.now() + 3600000).toISOString() };
        break;
      }
      case 'revoke-invite': {
        if (!uuidPattern.test(String(body.invitation_id))) throw new ApiError(400, 'Invalid invitation');
        // Invoke using the caller's token: the RPC rechecks live membership.
        await api(env, '/rest/v1/rpc/revoke_invitation', { p_invitation_id: body.invitation_id }, token);
        result = { ok: true };
        break;
      }
      default: throw new ApiError(400, 'Unknown action');
    }
    return new Response(JSON.stringify(result), { status: 200, headers });
  } catch (error) {
    // Errors contain neither action links nor service credentials.
    const status = error instanceof ApiError ? error.status : 503;
    const message = error instanceof ApiError ? error.message : 'Team administration is temporarily unavailable. Please retry.';
    return new Response(JSON.stringify({ error: message }), { status, headers });
  }
}
