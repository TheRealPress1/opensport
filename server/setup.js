// First-run setup and owner recovery for one-click cloud installs. The setup
// code the owner chose while deploying stands in for the self-hosted operator
// commands (bootstrap and recover), so it is the installation's master secret.
import { createHash, timingSafeEqual } from 'node:crypto';
import { ApiError, accessLink, errorResponse, jsonHeaders, oneMember, originAllowed, readJson, requireEnvironment, supabaseApi } from '../supabase/functions/team-admin/core.js';

export const MINIMUM_CODE_LENGTH = 12;
const SPORT_MODES = ['general', 'soccer'];
const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const digest = value => createHash('sha256').update(String(value)).digest();
const missingDatabaseObject = error => error.status === 404 || ['PGRST202', 'PGRST205', '42P01', '42883'].includes(error.code);

function setupCodeState(code) {
  if (!code) return 'missing';
  return code.length < MINIMUM_CODE_LENGTH ? 'too-short' : 'ok';
}

function validEmail(value) {
  const email = String(value || '').trim().toLowerCase();
  if (email.length > 320 || !emailPattern.test(email)) throw new ApiError(400, 'Enter a valid email address');
  return email;
}

function validTimezone(zone) {
  try { new Intl.DateTimeFormat('en', { timeZone: zone }); return true; } catch { return false; }
}

async function teamStatus(env) {
  try {
    const admins = await supabaseApi(env, '/rest/v1/soccer_members?select=id&role=in.(admin,coach)&active=is.true&limit=1');
    return { databaseReady: true, needsSetup: admins.length === 0 };
  } catch (error) {
    // Migrations run during the production build; until then the tables are missing.
    if (missingDatabaseObject(error)) return { databaseReady: false, needsSetup: true };
    throw error;
  }
}

// Vercel sets x-real-ip itself, so visitors can't choose their own allowance.
// Only a digest is stored, salted with the setup code.
function visitor(request, code) {
  const address = request.headers.get('x-real-ip') || request.headers.get('x-forwarded-for')?.split(',')[0].trim() || 'unknown';
  return createHash('sha256').update(`${address}|${code}`).digest('hex');
}

// Each visitor gets ten code checks an hour and everyone together fifty; the
// database decides. Anything but an explicit yes refuses the attempt.
async function attemptAllowed(env, client) {
  try { return await supabaseApi(env, '/rest/v1/rpc/record_setup_attempt', { p_client: client }) === true; }
  catch (error) {
    if (missingDatabaseObject(error)) throw new ApiError(503, 'The team database is still being prepared. Redeploy the project in Vercel, then try again.');
    throw error;
  }
}

// Removes an account that OpenSport didn't create, such as an open Supabase
// sign-up, so whoever registered the address first keeps no password or session.
async function replaceForeignAccount(env, email) {
  const existing = await supabaseApi(env, '/rest/v1/rpc/find_invitation_user', { p_email: email });
  if (!existing?.id) return null;
  const member = await oneMember(env, 'user_id', String(existing.id));
  if (member) return existing;
  await supabaseApi(env, `/auth/v1/admin/users/${existing.id}`, undefined, env.serviceKey, 'DELETE');
  return null;
}

async function createTeam(env, body) {
  const teamName = String(body.team_name || '').trim();
  const name = String(body.name || '').trim();
  const email = validEmail(body.email);
  const password = String(body.password || '');
  const sportMode = String(body.sport_mode || 'general');
  const timezone = String(body.timezone || 'UTC');
  const season = String(body.season || new Date().getFullYear()).trim();
  if (!teamName || teamName.length > 100) throw new ApiError(400, 'Team name must contain 1 to 100 characters');
  if (!name || name.length > 100) throw new ApiError(400, 'Your name must contain 1 to 100 characters');
  if (password.length < 12 || password.length > 72) throw new ApiError(400, 'Choose a password with 12 to 72 characters');
  if (!SPORT_MODES.includes(sportMode)) throw new ApiError(400, 'Choose General or Soccer');
  if (!validTimezone(timezone)) throw new ApiError(400, 'Choose a valid timezone');
  if (season.length > 40) throw new ApiError(400, 'Season label must be 40 characters or fewer');
  const status = await teamStatus(env);
  if (!status.databaseReady) throw new ApiError(503, 'The team database is still being prepared. Redeploy the project in Vercel, then try again.');
  if (!status.needsSetup) throw new ApiError(409, 'This team already has an administrator. Sign in instead.');
  // Settings first: they don't depend on the account, so a failure here leaves nothing to undo.
  await supabaseApi(env, '/rest/v1/team_settings?id=eq.1', { name: teamName, sport_mode: sportMode, timezone, season, scores_enabled: true }, env.serviceKey, 'PATCH');
  // An earlier account is kept only if it already belongs to the team; any other
  // is replaced, including one left by an interrupted setup.
  const existing = await replaceForeignAccount(env, email);
  let userId;
  let created = false;
  if (existing) {
    userId = existing.id;
    await supabaseApi(env, `/auth/v1/admin/users/${userId}`, { password, email_confirm: true, user_metadata: { name } }, env.serviceKey, 'PUT');
  } else {
    userId = (await supabaseApi(env, '/auth/v1/admin/users', { email, password, email_confirm: true, user_metadata: { name } })).id;
    created = true;
  }
  try {
    await supabaseApi(env, '/rest/v1/rpc/bootstrap_owner', { p_user_id: userId, p_email: email, p_name: name });
  } catch (error) {
    if (created) await supabaseApi(env, `/auth/v1/admin/users/${userId}`, undefined, env.serviceKey, 'DELETE').catch(() => {});
    throw error;
  }
  return { ok: true };
}

// Mirrors the self-hosted `recover` command: restores administrator access to an
// existing account and returns a one-use, one-hour password link.
async function recoverOwner(env, body) {
  const email = validEmail(body.email);
  const existing = await supabaseApi(env, '/rest/v1/rpc/find_invitation_user', { p_email: email });
  const member = existing?.id ? await oneMember(env, 'user_id', String(existing.id)) : null;
  // Only a team member can be restored; promoting any other account would hand
  // the team to whoever registered that address.
  if (!member) throw new ApiError(404, 'No team member uses that email address');
  const generated = await supabaseApi(env, '/auth/v1/admin/generate_link', { type: 'recovery', email });
  if (typeof generated.hashed_token !== 'string') throw new ApiError(502, 'Auth did not return a recovery link');
  await supabaseApi(env, '/rest/v1/rpc/bootstrap_owner', { p_user_id: existing.id, p_email: email, p_name: member.name || email.split('@')[0] });
  return { link: accessLink(env, 'recovery', 'recovery', generated.hashed_token) };
}

export function createSetupHandler(readEnvironment, readSetupCode, { failureDelay = 750, ownerRecovery = () => false } = {}) {
  return async function handleSetup(request) {
    const headers = jsonHeaders();
    try {
      const env = requireEnvironment(readEnvironment());
      if (request.method === 'GET') {
        const status = await teamStatus(env);
        return new Response(JSON.stringify({ ...status, setupCode: setupCodeState(readSetupCode()), ownerRecovery: ownerRecovery() === true }), { status: 200, headers });
      }
      if (request.method !== 'POST') throw new ApiError(405, 'Use GET or POST');
      if (!originAllowed(request, env.allowedOrigins || [])) throw new ApiError(403, 'This origin is not allowed');
      const body = await readJson(request);
      const expected = readSetupCode();
      if (setupCodeState(expected) !== 'ok') throw new ApiError(503, `Set OPENSPORT_SETUP_CODE to at least ${MINIMUM_CODE_LENGTH} characters in your Vercel project settings, then redeploy.`);
      // Outside these two moments the code can't be checked at all, so it can't be guessed.
      const recovering = body.action === 'recover-owner';
      if (recovering && ownerRecovery() !== true) throw new ApiError(403, 'Owner recovery is turned off. In your Vercel project, set OPENSPORT_ALLOW_OWNER_RECOVERY to 1 and redeploy, then try again.');
      if (!recovering) {
        const status = await teamStatus(env);
        if (!status.databaseReady) throw new ApiError(503, 'The team database is still being prepared. Redeploy the project in Vercel, then try again.');
        if (!status.needsSetup) throw new ApiError(409, 'This team already has an administrator. Sign in instead.');
      }
      if (!await attemptAllowed(env, visitor(request, expected))) throw new ApiError(429, 'Too many setup code attempts. Wait an hour, then try again.');
      if (!timingSafeEqual(digest(expected), digest(body.code ?? ''))) {
        // Slow down guessing; the code only guards setup and owner recovery.
        await new Promise(resolve => setTimeout(resolve, failureDelay));
        throw new ApiError(403, 'That setup code is not correct');
      }
      const result = recovering ? await recoverOwner(env, body) : await createTeam(env, body);
      return new Response(JSON.stringify(result), { status: 200, headers });
    } catch (error) {
      return errorResponse(error, headers);
    }
  };
}
