// Vercel Function for one-click cloud installs: invitations, recovery links, and
// revocations. Self-hosted installs run the same core as a Supabase Edge Function.
import { createTeamAdminHandler } from '../supabase/functions/team-admin/core.js';
import { cloudEnvironment } from '../server/cloud.js';

const handle = createTeamAdminHandler(() => cloudEnvironment());

export const POST = handle;
export const OPTIONS = handle;
