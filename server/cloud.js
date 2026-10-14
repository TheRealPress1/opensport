// One-click cloud installs (Vercel + Supabase) read the variables that Supabase's
// Vercel Marketplace integration syncs into the project. Server-side only.
export function cloudEnvironment(env = process.env) {
  const production = env.VERCEL_PROJECT_PRODUCTION_URL;
  const siteUrl = (env.OPENSPORT_SITE_URL || (production ? `https://${production}` : '')).replace(/\/$/, '');
  // The production address plus this deployment's own URLs, so a team can also
  // manage itself from a Vercel deployment link.
  const origins = [siteUrl, env.VERCEL_URL && `https://${env.VERCEL_URL}`, env.VERCEL_BRANCH_URL && `https://${env.VERCEL_BRANCH_URL}`];
  return {
    url: env.SUPABASE_URL || env.NEXT_PUBLIC_SUPABASE_URL,
    serviceKey: env.SUPABASE_SECRET_KEY || env.SUPABASE_SERVICE_ROLE_KEY,
    anonKey: env.SUPABASE_PUBLISHABLE_KEY || env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || env.SUPABASE_ANON_KEY || env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    siteUrl,
    allowedOrigins: [...new Set(origins.filter(Boolean).map(value => new URL(value).origin))],
  };
}

export const setupCode = (env = process.env) => env.OPENSPORT_SETUP_CODE || '';
// Owner recovery stays off until the owner proves control of the Vercel project
// by setting this variable and redeploying, like the self-hosted host command.
export const ownerRecoveryEnabled = (env = process.env) => env.OPENSPORT_ALLOW_OWNER_RECOVERY === '1';
