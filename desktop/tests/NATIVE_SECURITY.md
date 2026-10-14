# Native database authentication acceptance

This is an opt-in production acceptance gate, separate from the preview's normal test suite. It uses only a synthetic integration fixture inside this repository's `.context` directory. It never uses the normal macOS application data directory. Run one native stack at a time.

After preparing the desktop resources, create a disposable fixture with the native integration test:

```sh
OPENSPORT_NATIVE_TEST_DATA_DIR="$PWD/.context/native-security-fixture" npm run test:desktop:native
```

Audit that fixture:

```sh
OPENSPORT_NATIVE_SECURITY_AUDIT=1 \
OPENSPORT_NATIVE_TEST_DATA_DIR="$PWD/.context/native-security-fixture" \
node desktop/tests/native-security.audit.mjs
```

The audit starts and stops its own server, verifies loopback listeners, and attempts database connections with random incorrect passwords and the public upstream development default. All SQL checks are read-only. Passwords, database URLs, tokens, and account details are not printed. The report is saved privately as `native-security-audit.json` inside the fixture.

- Exit `0`: every tested incorrect/default credential was rejected.
- Exit `2`: an incorrect/default credential authenticated or an authentication policy check failed; production acceptance is blocked.
- Other nonzero exit: the audit could not finish; this is not a security pass.

The `opensport-native-auth-v1` profile uses a source-built launcher and must pass this gate. Hosting also performs the shared authentication check before declaring itself ready, so unsafe startup can fail before the standalone report is produced. Replacing `trust` with SCRAM alone is insufficient: public default passwords must also be replaced with private installation credentials before the server starts. The native integration test additionally observes actual temporary and final PostgreSQL sockets before readiness and repeats the gate after restart and relocated restore.

For coordinated browser checks, `OPENSPORT_NATIVE_AUDIT_KEEP_RUNNING=1` retains the synthetic server after the audit. Its runner PID is in the private report; send that process `SIGTERM` when the other checks finish so it stops the server gracefully. A second audit can probe the retained server using `OPENSPORT_NATIVE_AUDIT_REUSE_RUNNING=1`; that mode neither starts nor stops services. Do not combine the two options.

## Original stock-runtime baseline

The October 12, 2026 check against CLI 2.120.0 completed all 15 probes: eight connections authenticated and seven were rejected. A random incorrect password authenticated as `supabase_admin`, a database superuser. The public development default authenticated as all seven tested existing roles. All 11 native listeners were on loopback; loopback binding does not prevent another local process from reaching the database proxy. The test performed no writes and stopped its disposable server after coordinated browser checks.

The pinned [database implementation](https://github.com/supabase/cli/blob/v2.120.0/packages/stack/src/services/Database.ts) rewrites an HBA rule allowing trusted local `supabase_admin` connections on every launch. The TCP proxy reaches PostgreSQL through that local socket. It also rejects `hba_file` in custom database settings, so an ordinary project configuration override cannot replace this rule. The [project configuration adapter](https://github.com/supabase/cli/blob/v2.120.0/apps/cli/src/command-internal/stack-config.ts) does not pass a database password into its database service creation. [Database bootstrap](https://github.com/supabase/cli/blob/v2.120.0/packages/stack/src/runtime/DatabaseBootstrap.ts) reconciles service-role passwords from managed credentials during readiness, making an isolated post-start password change insufficient.

The OpenSport [source patch and build](../patches/README.md) now provide authenticated native startup and require an installation password and root key. A separate checksum-guarded bootstrap template applies SCRAM before the temporary initialization server starts. The main process generates and retains those secrets, verifies launcher identity, and propagates them through the managed stack. The audit inventories every LOGIN role dynamically, including passwordless disabled roles; it checks verifier formats without retrieving password hashes. Existing development-profile previews are refused rather than silently rotated or converted. See the [validation record](../../docs/VALIDATION.md) for observed results and remaining release gates.
