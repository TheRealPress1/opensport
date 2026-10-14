import { handleTeamAdmin } from '../functions/team-admin/handler.ts';

const ownerId = '10000000-0000-0000-0000-000000000001';
const invitedId = '10000000-0000-0000-0000-000000000002';
const invitationId = '50000000-0000-0000-0000-000000000001';
const owner = { id: ownerId, user_id: ownerId, role: 'admin', active: true, onboarding_completed_at: '2026-01-01' };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
function assert(condition: unknown, message: string): asserts condition { if (!condition) throw new Error(message); }

type Fetch = typeof globalThis.fetch;
async function withApi(mock: Fetch, test: () => Promise<void>) {
  const original = globalThis.fetch;
  const values = { SUPABASE_URL: 'http://internal.test', SUPABASE_SERVICE_ROLE_KEY: 'service-only-test-key', SUPABASE_ANON_KEY: 'anon-test-key', SITE_URL: 'https://team.example.test' };
  const previous = new Map(Object.keys(values).map((key) => [key, Deno.env.get(key)]));
  Object.entries(values).forEach(([key, value]) => Deno.env.set(key, value));
  globalThis.fetch = mock;
  try { await test(); } finally {
    globalThis.fetch = original;
    for (const [key, value] of previous) { if (value === undefined) Deno.env.delete(key); else Deno.env.set(key, value); }
  }
}
function request(body: unknown, token = 'valid-user-token', origin = 'https://team.example.test') {
  return new Request('https://team.example.test/api/functions/v1/team-admin', { method: 'POST', headers: { Authorization: `Bearer ${token}`, Origin: origin, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
}

Deno.test('untrusted origin cannot invoke privileged functions', async () => {
  await withApi(() => { throw new Error('No upstream call should occur'); }, async () => {
    const response = await handleTeamAdmin(request({ action: 'invite', email: 'test@example.test' }, 'token', 'https://attacker.test'));
    assert(response.status === 403, 'foreign origin must be rejected');
    assert(!response.headers.has('Access-Control-Allow-Origin'), 'foreign origin must not receive CORS permission');
  });
});

Deno.test('Auth verifies the caller before any role or admin operation', async () => {
  let calls = 0;
  await withApi((input, init) => {
    calls++;
    assert(String(input).endsWith('/auth/v1/user'), 'first request must validate JWT with Auth');
    assert(new Headers(init?.headers).get('Authorization') === 'Bearer invalid-token', 'must forward user token');
    return Promise.resolve(json({ message: 'invalid JWT' }, 401));
  }, async () => {
    const response = await handleTeamAdmin(request({ action: 'invite', email: 'test@example.test' }, 'invalid-token'));
    assert(response.status === 401 && calls === 1, 'invalid user must not reach role or admin calls');
  });
});

for (const state of [{ role: 'player', active: true }, { role: 'admin', active: false }]) {
  Deno.test(`denies ${state.active ? 'player' : 'deactivated administrator'} even with a valid session`, async () => {
    let calls = 0;
    await withApi((input) => {
      calls++;
      if (String(input).endsWith('/auth/v1/user')) return Promise.resolve(json({ id: ownerId }));
      assert(String(input).includes('/soccer_members?user_id='), 'only live DB membership lookup is allowed');
      return Promise.resolve(json([{ ...owner, ...state }]));
    }, async () => {
      const response = await handleTeamAdmin(request({ action: 'recovery', member_id: invitedId }));
      assert(response.status === 403 && calls === 2, 'must reject before generating recovery token');
    });
  });
}

for (const confirmed of [false, true]) {
  Deno.test(`creates an invitation without SMTP${confirmed ? ' after interrupted onboarding' : ''}`, async () => {
    let generated = false;
    let persisted = false;
    await withApi((input, init) => {
      const path = String(input);
      const body = init?.body ? JSON.parse(String(init.body)) : {};
      if (path.endsWith('/auth/v1/user')) return Promise.resolve(json({ id: ownerId }));
      if (path.includes(`soccer_members?user_id=eq.${ownerId}`)) return Promise.resolve(json([owner]));
      if (path.endsWith('/rpc/find_invitation_user')) return Promise.resolve(json(confirmed ? { id: invitedId, email_confirmed_at: '2026-01-01' } : null));
      if (path.includes(`soccer_members?user_id=eq.${invitedId}`)) return Promise.resolve(json([{ id: invitedId, active: false, onboarding_completed_at: null }]));
      if (path.endsWith('/auth/v1/admin/generate_link')) {
        assert(body.type === (confirmed ? 'recovery' : 'invite'), 'must choose compatible native Auth token type');
        generated = true;
        return Promise.resolve(json({ id: invitedId, hashed_token: 'secret-native-hash-value', verification_type: body.type }));
      }
      if (path.endsWith('/rpc/issue_invitation')) {
        assert(body.p_user_id === invitedId && body.p_token_hash === 'secret-native-hash-value', 'must bind membership to returned Auth user and token');
        persisted = true;
        return Promise.resolve(json({ id: invitationId, user_id: invitedId, expires_at: '2026-10-12T18:00:00Z' }));
      }
      throw new Error(`Unexpected upstream request: ${path}`);
    }, async () => {
      const response = await handleTeamAdmin(request({ action: 'invite', email: 'Player@Example.test', name: 'New player' }));
      const result = await response.json();
      assert(response.status === 200 && generated && persisted, 'must create and persist invitation');
      const url = new URL(result.link);
      const fragment = new URLSearchParams(url.hash.slice(1));
      assert(url.origin === 'https://team.example.test' && url.searchParams.get('auth') === 'invite', 'link must use configured public app origin');
      assert(!url.searchParams.has('token_hash'), 'token must stay out of request query strings');
      assert(fragment.get('token_hash') === 'secret-native-hash-value' && fragment.get('invitation_id') === invitationId, 'fragment must preserve acceptance credentials');
      assert(!JSON.stringify(result).includes('service-only-test-key'), 'service key must never appear in response');
    });
  });
}

Deno.test('completed members cannot be reset through the invitation path', async () => {
  await withApi((input) => {
    const path = String(input);
    if (path.endsWith('/auth/v1/user')) return Promise.resolve(json({ id: ownerId }));
    if (path.includes(`soccer_members?user_id=eq.${ownerId}`)) return Promise.resolve(json([owner]));
    if (path.endsWith('/rpc/find_invitation_user')) return Promise.resolve(json({ id: invitedId, email_confirmed_at: '2026-01-01' }));
    if (path.includes(`soccer_members?user_id=eq.${invitedId}`)) return Promise.resolve(json([{ ...owner, id: invitedId, user_id: invitedId }]));
    throw new Error('Existing membership must block native token generation');
  }, async () => {
    const response = await handleTeamAdmin(request({ action: 'invite', email: 'player@example.test' }));
    assert(response.status === 409, 'completed memberships require explicit recovery/access flow');
  });
});

Deno.test('revocation RPC receives user credentials and rechecks current role', async () => {
  let revoked = false;
  await withApi((input, init) => {
    const path = String(input);
    if (path.endsWith('/auth/v1/user')) return Promise.resolve(json({ id: ownerId }));
    if (path.includes('/soccer_members?user_id=')) return Promise.resolve(json([owner]));
    assert(path.endsWith('/rpc/revoke_invitation'), 'only revocation RPC should follow admin check');
    assert(new Headers(init?.headers).get('Authorization') === 'Bearer valid-user-token', 'RPC must authenticate caller rather than bypass with service key');
    assert(JSON.parse(String(init?.body)).p_invitation_id === invitationId, 'must revoke the requested invite');
    revoked = true;
    return Promise.resolve(json(null));
  }, async () => {
    const response = await handleTeamAdmin(request({ action: 'revoke-invite', invitation_id: invitationId }));
    assert(response.status === 200 && revoked, 'admin revocation should succeed');
  });
});
