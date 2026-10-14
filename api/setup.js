// Vercel Function for one-click cloud installs: first-run team creation and
// owner recovery, both gated by the setup code chosen while deploying.
import { cloudEnvironment, setupCode } from '../server/cloud.js';
import { createSetupHandler } from '../server/setup.js';

const handle = createSetupHandler(() => cloudEnvironment(), () => setupCode());

export const GET = handle;
export const POST = handle;
