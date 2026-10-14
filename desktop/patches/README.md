# OpenSport native launcher build

The Mac preview uses a small source patch to Supabase CLI 2.120.0. The official native launcher permits a passwordless administrative database connection and otherwise uses development credentials. The OpenSport patch requires authenticated connections and explicit installation secrets. Do not replace this executable with the upstream release binary.

## Maintainer build

On an Apple silicon Mac with Node.js and the repository's npm dependencies installed:

```sh
node scripts/build-native-cli.mjs
# Or prepare the complete desktop resources and frontend:
npm run desktop:prepare
# Package the application and local-preview DMG:
npm run desktop:build
```

The organizer receives the packaged app and does not run these commands. Building from source requires internet access for the pinned toolchain and dependencies. First launch separately downloads the pinned native services.

The builder downloads and verifies every top-level build input listed under `sourceBuild` in [runtime-lock.json](../runtime-lock.json):

- Supabase CLI commit `753520fa7202ed5f8b25883a4c0aa7e5e9ad1fc4` (tag `v2.120.0`), using an immutable commit archive and SHA-256.
- Bun `1.4.2`, matching the upstream `.bun-version`, using a pinned Apple silicon release archive and SHA-256.
- pnpm `12.8.1`, matching the upstream package-manager version, using a pinned native package archive and SHA-256.
- The checked-in source patch, with its own SHA-256.

It extracts source into the ignored `.context/opensport-native-cli-build/source` directory and applies the patch with zero fuzz. A frozen upstream dependency lock preserves package integrity and upstream dependency patches. Installation scripts are disabled, and optional platform dependencies are limited to macOS ARM64. No globally installed Bun or pnpm is required.

The config-only smoke test runs before compilation. It checks that config loading remains possible without credentials, missing/malformed secrets are rejected by composition creation, and generated secrets reach the database configuration as redacted values. It starts no native services.

Compilation uses upstream Bun `compileOptions`, the source-derived stack protocol identity, and the upstream embedded Functions bootstrap template. Telemetry build keys are empty. The resulting executable receives an ad-hoc macOS signature and must pass version, immutable build identity, and signature checks before installation into ignored `desktop/resources/native`. The original, checksum-verified `supabase-go` compatibility sidecar is retained; the upstream Bun executable is never installed or modified.

## Patch contract

[supabase-cli-2.120.0-opensport-auth.patch](supabase-cli-2.120.0-opensport-auth.patch) changes three source files:

1. `Database.ts` writes only `local all all scram-sha-256` into the native running database's HBA file, before the database starts.
2. `stack-config.ts` requires `OPENSPORT_NATIVE_DATABASE_PASSWORD` and `OPENSPORT_NATIVE_POSTGRES_ROOT_KEY` when creating the stack composition. Each must contain exactly 64 lowercase hexadecimal characters. Values are passed through the existing redacted credential interfaces. A conflicting configured root key fails closed. Config loading, status, and stop do not require these environment variables.
3. `main.ts` supports `--opensport-build-info`, returning immutable JSON containing `buildId`, `upstreamVersion`, `upstreamCommit`, and `patchSha256`. Normal `--version` remains `2.120.0` for upstream compatibility.

OpenSport's main process generates separate random secrets for each installation and retains them in private installation storage. It supplies them through the child environment, never command arguments or browser configuration. Saved-stack credential reconciliation rejects mismatches; this patch does not provide password rotation or conversion of legacy development stacks.

The source patch is only one part of the protection. [native-isolation.mjs](../native-isolation.mjs) also replaces the exact-hash-verified PostgreSQL bootstrap HBA template before the temporary initialization server starts, applies loopback bindings, and audits listeners. The runtime verifies installation format, launcher identity, and database authentication. A successful source build alone does not prove those runtime checks pass.

## Identity and repeatability

`native/opensport-build.json` records source identity, builder/input digest, and executable SHA-256. Cached output is reused only when those fields, the executable bytes, and `--opensport-build-info` agree. The app repeats the identity and executable checks before hosting. Electron packaging can replace the nested executable's signature, so the packager records the final binary digest and then re-seals the outer app.

Two consecutive compilations from the same pinned inputs on the development Mac produced identical ad-hoc-signed executable bytes. This is evidence of local repeatability, not a guarantee across macOS signing/toolchain environments. Developer ID signing or notarization is a separate distribution step and changes release artifacts.

When updating the upstream version, review and refresh the patch, source/toolchain checksums, service versions, bootstrap overlays, and config smoke tests. Rebuild from a fresh source extraction, run the native authentication gate and full lifecycle/restore tests in a disposable installation, and verify the final packaged app. Do not claim compatibility with an unreviewed upstream release or silently fall back to its executable.

## Notices and scope

Supabase CLI is MIT licensed; the source archive's `apps/cli-go/LICENSE` accompanies the compiled launcher. Bun includes JavaScriptCore and other components with additional notices and relinking instructions; see [Bun-LICENSE.md](../licenses/Bun-LICENSE.md). The app bundles source provenance and patch references in `THIRD-PARTY-NOTICES.txt`.

The native backend remains experimental and the preview remains loopback-only. Database authentication does not isolate data from software running with the organizer's own account or from a Mac administrator who can access installation files. Public distribution still requires the release acceptance checks, signing, and notarization.
