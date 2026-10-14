// Entry for the self-hosted Edge Runtime. The logic lives in core.js, which
// one-click cloud installs also run as a Vercel Function. Never import into Vite.
import { createTeamAdminHandler } from './core.js';

export const handleTeamAdmin: (request: Request) => Promise<Response> = createTeamAdminHandler(() => ({
  url: Deno.env.get('SUPABASE_URL'),
  serviceKey: Deno.env.get('SUPABASE_SERVICE_ROLE_KEY'),
  anonKey: Deno.env.get('SUPABASE_ANON_KEY'),
  siteUrl: Deno.env.get('SITE_URL'),
}));
