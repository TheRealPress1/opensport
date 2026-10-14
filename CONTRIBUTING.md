# Contributing to OpenSport

Open an issue describing the behavior you want to improve, or submit a focused pull request against `main`. Include what changed, why, and how you checked it. Use fictional players and teams in tests and screenshots.

## Local development

Use Node 22.12 or later and `npm ci`. Copy `.env.example` to `.env.local` for the public project site and its isolated demo. Use the self-hosting guide for a real local team installation. Do not reuse a production team's credentials or data.

Run `npm run check` for lint, utility tests, production packaging, and desktop/mobile browser tests. Install Chromium with `npx playwright install chromium` first. Docker setup and database security tests are separate release requirements. Run `npm run test:db` with Docker, and `npm run test:edge` with Deno 2. Follow `docs/SELF_HOSTING.md` and the live test configuration in `tests/browser-live/` for the complete installation journey.

Run `node scripts/ops-acceptance.mjs` for the full Docker journey on a disposable local installation. It generates synthetic credentials, tests the live interface, and restores accounts, team records, and an avatar into fresh volumes. It requires Docker and installed Playwright Chromium and removes only the test projects it creates. Set `OPENSPORT_ACCEPTANCE_TLS=1` to exercise HTTPS and secure realtime sockets using Caddy's local test certificate. CI uses this option against the unpacked source archive with the release's pinned images. Separately verify a real host's DNS, trusted TLS, firewall, and access from a second device before opening it to teammates.

Keep the demo independent of the live client. Components shared with `TeamWorkspace` must not import `supabase.js`, `useTeam`, or Auth screens. New team access rules belong in Postgres policies or privileged functions, not only in UI visibility checks.

## Release checklist

1. Run all frontend, database security, and isolated Docker integration checks.
2. Start from the source ZIP on a clean installation; bootstrap an owner, invite a player, set a password, and coordinate an event from two browser contexts.
3. Test expired/reused/revoked invitations, account recovery, access denial, draft privacy, private avatar access, and last-admin protection.
4. Verify restart persistence and restore a backup into a separate empty installation, including Auth records and avatar objects.
5. Check the remote HTTPS configuration from a second device and verify database/administration ports are not public.
6. Run `npm run release:prepare`; inspect `public/downloads/opensport-0.1.0-source.zip` and its SHA-256 manifest. The archive is built from working-tree source, so review all included changes.
7. Publish only the exact validated source and archive. Building an archive alone does not mark the release accepted. Tagging or publishing a GitHub release is a separate maintainer action.

The original live Babson schema is not present in this repository. Changes for that deployment require a schema-only audit, backup, and isolated rehearsal. Never apply the fresh-install schema blindly to a live database.

## License

Contributions are accepted under the repository's MIT license. Keep notices for vendored upstream resources. Do not include real player contacts, private team records, credentials, or generated host configuration in a contribution.
