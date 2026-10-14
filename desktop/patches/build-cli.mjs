/* global Bun */
// Copied into the pinned source's apps/cli/scripts directory by build-native-cli.mjs.
// Use the upstream compiler options, stack protocol digest, and embedded function template.
import { Effect } from 'effect'
import { bundleServeMainTemplate } from '../src/shared/functions/serve-main-bundler.ts'
import { compileOptions, stackReleaseDefine } from './compile-options.ts'

const identity = await Bun.file(process.argv[2]).json()
const result = await Bun.build({
  ...compileOptions,
  entrypoints: ['src/main.ts'],
  compile: { target: 'bun-darwin-arm64', outfile: 'dist/supabase' },
  define: {
    SUPABASE_CLI_VERSION: JSON.stringify(identity.upstreamVersion),
    OPENSPORT_NATIVE_BUILD_INFO: JSON.stringify(JSON.stringify(identity)),
    ...(await stackReleaseDefine()),
    SUPABASE_FUNCTIONS_SERVE_MAIN_TEMPLATE: JSON.stringify(await Effect.runPromise(bundleServeMainTemplate())),
    SUPABASE_CLI_POSTHOG_KEY: JSON.stringify(''),
    SUPABASE_CLI_POSTHOG_HOST: JSON.stringify(''),
    'process.env.MSGPACKR_NATIVE_ACCELERATION_DISABLED': JSON.stringify('true'),
  },
})
for (const log of result.logs) console.warn(log)
if (!result.success) throw new Error('Compiling the OpenSport native launcher failed.')
