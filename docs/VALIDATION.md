# v0.1.0 validation record

Validated on 2026-10-12 with fictional teams and disposable local installations.
No production database, Babson deployment, branch name, or remote release
was changed. Version 0.1.0 remains a release candidate until the exact packaged
deployment passes the full installation gate.

## Passed

- ESLint, production Vite build, four calendar/demo tests, four operator tests,
  eight Edge Function tests, and Deno type checking.
- Four desktop/mobile public browser checks: navigation, setup documentation,
  source archive contents and checksums, demo RSVPs/reset, published lineup,
  sport modes, and zero Supabase requests from the demo.
- Four live browser workflows: persisted settings, failed-write retry, invitation
  acceptance, optional profiles, independent-session realtime RSVPs, recovery,
  0–0 results, draft privacy/published lineups, and mobile/keyboard operation.
  All four also passed over HTTPS, with secure WebSocket connections asserted
  for both independent browser sessions.
- A transient invitation-completion failure preserves the chosen password and
  name and can retry without trying to set the same password again.
- 62 database security assertions plus simultaneous attempts to remove the last
  administrator. Tested with PostgreSQL 17.6.1.166 and the complete migrations.
- 27 native API checks against real Auth, REST, and Edge services:
  invitation expiry/revocation/replay/reissue, password setup, disabled signup,
  direct role/write/contact restrictions, recovery, and deactivation. These
  checks also passed over HTTPS through the packaged Caddy configuration.
- Cold backup restored into a separate fresh Docker project. Every field in team
  settings, members, events, RSVPs, goals, and lineups matched the original;
  account identity/password and private avatar bytes survived. A host recovery
  link issued before the backup also worked after restoration.
- The unchanged frontend Docker build stage succeeded on Node 22.22.0,
  Linux ARM64/Alpine. Source ZIP hashes, essential files, and private-file
  exclusions were checked inside the image. This machine required the standard
  `HTTP_PROXY`/`HTTPS_PROXY` build arguments for its configured Docker proxy.
- `npm audit` reported zero known dependency vulnerabilities after lockfile
  updates. This is a dependency report, not an independent security audit.

## Deployment evidence and remaining release gates

Functional installation tests used locally cached official Supabase images:
Postgres 17.6.1.166, Auth 2.194.0, PostgREST 14.15, Realtime 2.120.3,
Storage 1.67.20, and Edge Runtime 1.74.2, with the packaged Envoy 1.39.1 gateway.
Afterward, Auth was replaced with the release's pinned 2.196.0 image and all 27
native API checks passed again over HTTPS, including the password-setup trigger.
The initial HTTP browser tests used a temporary local static/proxy server while
the Caddy image was downloading. Subsequent HTTPS/WSS browser and API checks used
the official Caddy 2.10.2 Linux ARM64 binary, verified against its published SHA512
checksum, in a temporary Alpine image with the unchanged packaged Caddyfile.
Certificate verification exceptions were confined to these loopback test
processes using Caddy's local test CA. These overrides are in gitignored test
files; the release continues to pin the official `self-hosted/v0.8.2` deployment
set and Caddy image.

Downloads for several exact release image tags repeatedly stalled or timed out.
The full default-image installation must still pass; cached-version results do
not replace that gate. CI includes an installation job that unpacks the generated
source ZIP and runs the full browser/API/backup/recovery journey using the exact
release images and local HTTPS. That CI job has not been run remotely in this
workspace session.

Reproduce the full gate with Docker, Node 22, and Playwright Chromium installed:

```sh
OPENSPORT_ACCEPTANCE_TLS=1 node scripts/ops-acceptance.mjs
```

Verify an actual remote host's DNS, trusted HTTPS certificate, firewall, and a
second physical device before sharing it with teammates. No public domain or
remote host was provided for that operational check.

## Behavior to retain in future checks

Deactivation denies data access immediately through database policies, including
requests made with an existing access token. Password recovery invalidates the
old password and refresh sessions; already issued stateless access tokens expire
normally. Signed avatar URLs expire after five minutes. Cold snapshots require
the same CPU architecture and pinned database release when restoring.

Publishing a GitHub tag/release and migrating the existing Babson installation
remain separate actions. The latter requires its own schema audit, backup, and
successful migration rehearsal.

## Mac hosting preview baseline — 2026-10-12

The new Mac application was exercised on Apple silicon, macOS 26.3, with Electron
44.7.0 and Supabase CLI 2.120.0. It is an ad-hoc signed local testing preview for
fictional team data, not a production Mac release. Internet sharing is disabled.

Passed checks include:

- 20 desktop unit checks covering setup/retry/recovery, backup integrity and safe
  extraction, gateway permissions, listener auditing, and WebSocket shutdown.
- Six browser checks of the setup interface, including retained form inputs,
  password privacy, native bridge failure, mobile layout, and keyboard navigation.
- The actual Electron window and restricted IPC bridge, including sandboxing,
  blocked Node access, trusted-window checks, external URL restrictions, and
  keyboard setup without starting a server.
- A fresh actual Electron setup against the native backend: first administrator,
  team creation, browser sign-in, a backup from the host controls, stop/restart,
  and clean application shutdown. This passed again after adding REST readiness
  and Realtime stream warm-up (131 seconds with cached native downloads).
- The existing four live browser workflows against the Mac gateway and native
  backend, including independent-session RSVP updates and lineup publishing
  without refresh. The actual browser uses the same client as the server build.
- 62 SQL security assertions and 27 Auth/REST/Edge API checks against the native
  services. These validate application roles; they do not harden the native
  database's local administrative connection described below.
- Fresh native setup, restart, and cold restoration into different empty data
  directories containing spaces and apostrophes, retaining account sign-in, team
  settings, an event, RSVP records, and exact private avatar bytes. This covers
  the default Mac Application Support path shape.
- All 11 observed owned TCP listeners bound to loopback after checksum-guarded
  launcher configuration changes. Attempts through the Mac's LAN address failed.

Native checks must run sequentially. Parallel native projects caused a transient
startup failure; a retry with one active stack succeeded. First setup downloads
native services, so a cached test does not measure a new user's download time.

The upstream native database accepts the local `supabase_admin` connection
without password authentication. Its loopback database proxy forwards to that
connection. Other software or accounts on this Mac may therefore access the
preview database; unique app/API secrets and loopback listeners do not solve
that problem. The UI and Mac guide explicitly require fictional test data.
Before real-team use, orchestration must establish private database credentials
and authenticated connections before exposing any proxy, and preserve them
through restart, backup, recovery, and upgrades. A post-start HBA edit is not a
production fix: the upstream CLI regenerates these settings on launch.

The packaged executable opened successfully with its restricted setup bridge and
without starting a server. Its bundled files contained no tested private fixture
credentials or workspace data. The `.dmg` build succeeded locally; ad-hoc signing
verifies its local resource seal. Public distribution still requires Developer
ID signing, notarization, a clean-machine installation check, a tested upgrade
policy, and secure remote HTTPS access tested from a second physical device.
The Mac CI workflow is provided but has not been run remotely. No real team data
or live Babson installation was used in these checks.

## Connection recovery and original authentication audit — 2026-10-12

Additional checks ran here against a disposable native Mac installation. No
second physical device or public connection was needed for these local tests.

- The new browser regression first reproduced a real failure: changes saved
  while another browser was offline remained missing after it reconnected.
  The client now refreshes on both the browser's online event and a successful
  Realtime subscription. The same regression passed after the fix.
- All six live browser checks passed together against the native backend in
  32.9 seconds: the existing four workflows, connection recovery, and transient
  read-error recovery with retained failed-save inputs. The new outage test
  used two independent browser contexts with the same synthetic administrator
  account to check reconciliation of that account's own RSVP. The existing
  invitation workflow separately covers distinct accounts.
- The outage test explicitly closed the real Realtime WebSocket in addition to
  browser offline emulation. It verified the stale offline view, caught up
  within 15 seconds without reload or focus, and received subsequent RSVP
  updates in both directions. A timing assertion prevents the 60-second
  fallback poll from masking a broken reconnect.
- A recovered read cleared its temporary error. A successful background refresh
  preserved the failed event form's unsaved title and error for retry.
- ESLint, the public production build, and the Mac preview disk-image build
  passed with the fix. All four public desktop/mobile browser checks passed
  again, including source downloads and the demo's zero-backend-request check.
  Browser checks used the installed Chromium executable through
  `PLAYWRIGHT_CHROMIUM_EXECUTABLE`; the default Playwright cache was absent.
- The new native database authentication gate **failed**, correctly exiting 2.
  Of 15 read-only probes, an arbitrary incorrect password authenticated as
  `supabase_admin` with superuser access. All seven real service roles accepted
  the public upstream development password. Six real roles and the nonexistent
  role rejected the arbitrary incorrect password. Loopback binding passed but
  does not remedy these authentication failures.

The audit is a failing production acceptance gate, not a test that treats unsafe
credentials as expected success. Merely changing the administrator's trust rule
would leave the shared development passwords unresolved. Database hardening
remains required before real team data or remote access. Test gateways and owned
native services were stopped after these checks; only disposable local fixtures
and redacted diagnostic reports remain.

## Authenticated Mac database profile — 2026-10-12

The `opensport-native-auth-v1` profile addresses the stock runtime authentication
failure recorded above. It uses a small source patch to the pinned CLI plus a
checksum-guarded bootstrap HBA template. New installations generate separate
database credentials and an encryption root key, retained privately through
restart and restore. The application verifies the launcher's compiled identity
and executable digest, checks actual database authentication on each start,
and refuses older preview data rather than converting it silently.

Passed in a fresh disposable directory containing spaces and an apostrophe:

- Fresh setup, restart, and cold restore into a different directory each
  inventoried all nine LOGIN roles and rejected all 19 incorrect/default/unknown
  credential probes. All configured authentication rules used SCRAM. Tests also
  authenticated successfully with the private installation credential.
- Before readiness, the startup observer connected to the actual owned
  PostgreSQL Unix sockets. It verified authenticated access and rejected random
  and public-default passwords on both the temporary initialization server and
  final server. Restart and restore also supplied final-socket evidence. The
  initial observer attempt missed the wrapped PostgreSQL executable and failed;
  after fixing that selector, validation started again with fresh data/secrets.
- Installation credentials and encryption key remained identical across all
  three stages. Auth sign-in, team settings, schedule, RSVP records, and exact
  private avatar bytes survived restoration. The first Realtime event arrived
  without polling. All 62 SQL permission assertions passed.
- All 11 observed TCP listeners remained on loopback, and LAN-address connection
  attempts failed. Fresh and restored test services stopped after the run.
- A separate copy of a legacy fixture was started using the older packaged
  runtime. After terminating only the test app process, the new runtime stopped
  its orphaned owner and services without starting or converting the team.
  Manifest, credentials, and setup records stayed byte-identical; PostgreSQL
  data remained present. No owned processes remained after cleanup.
- 49 desktop unit checks passed, including malformed/default secrets, replaced
  launchers, startup-failure cleanup, stop-before-rewrite ordering, legacy backup
  rejection before import, unchanged destination files, and secret-safe errors.
  Eight setup-interface browser checks passed, including legacy compatibility
  and interrupted setup. ESLint passed.
- The source launcher build used pinned upstream source, patch, and toolchain
  checksums. Missing/malformed credential checks and immutable build identity
  checks passed. Two local compilations produced identical signed bytes; this
  does not promise identical output across different signing environments.
- All 27 direct Auth/REST/Edge API checks and all six live browser workflows
  passed against the protected backend and actual Mac gateway. Browser checks
  included invitation/recovery flows, role privacy, live RSVPs, soccer results
  and lineups, keyboard/mobile use, actual socket disconnection/reconnection,
  and retained failed-save inputs. Gateways and runtime stopped after the run.
- The actual Electron wizard created a new protected team, signed in through
  the browser gateway, saved a version-2 backup, restarted, and retained access
  (104 seconds with cached service downloads). The restricted native bridge
  check also passed. The final Electron fixture had no remaining native
  processes after quitting. Public build and all four public browser checks
  passed again, including demo isolation and source archive downloads.
- The updated 201 MB Mac preview disk image built successfully. Its final
  packaged launcher passed executable-digest and compiled-identity verification
  after signing; strict application signature verification and the disk-image
  SHA-256 check passed. This is still an ad-hoc signed local preview.

This resolves the observed database authentication blocker. It does not make
the Mac preview remotely reachable or constitute a complete product security
audit. The preview stays limited to fictional data while distribution, upgrade,
and remote-access acceptance are completed. Older preview installations and
backups need a separately reviewed migration; their files are preserved.

## Editorial public landing page — 2026-10-12

The landing page now uses a static six-athlete composition, local fonts and
photographs, a captured fictional-demo screenshot, the founder story, and current
hosting limitations. The team interface and backend were not changed in this
design pass. The Mac preview remains local-only; no public installer is advertised.

- ESLint, the production Vite build, and all four calendar/demo unit tests passed.
- All six desktop/mobile public browser checks passed, covering source downloads
  and checksums, all twelve image variants and dimensions, photo credits and
  licenses, setup and contribution guides, keyboard use, image-failure behavior,
  demo RSVP changes/reset, published lineups, and general-mode controls.
- The landing page and demo made zero Supabase requests. Public image and font
  requests stayed on the same origin. Production preview checks at 1440, 768,
  390, and 320 pixels had no runtime errors or horizontal overflow.
- All six athletes share a baseline with complete visible subjects. Desktop,
  tablet, and narrow mobile layouts were visually reviewed; focus outlines,
  skip navigation, expandable credits, and text contrast were checked. Final
  desktop and mobile screenshots are retained in the workspace's `.context`.
- Messi and LeBron use local foreground segmentation with original RGB pixels
  preserved before WebP optimization. Other cutouts used image-assisted edits.
  Sources, authors, height references, dimensions, modification descriptions,
  processing methods/prompts, and applicable licenses ship with the source ZIP.

This validates the public-page redesign locally; it does not replace the separate
Mac distribution, remote-access, or release installation gates above.

## Team-sports lineup — 2026-10-13

The poster now shows team-sport athletes only: Lionel Messi, Caitlin Clark,
Shohei Ohtani, Tom Brady, and LeBron James, shortest to tallest. Ohtani and
Brady share 193 cm. Marta, Serena Williams, and Roger Federer were removed along
with their photographs and credits.

- Ohtani (Jeffrey Hayes, CC BY 2.0) and Brady (Jeffrey Beall, CC BY-SA 2.0) use
  local Apple Vision foreground segmentation. Original RGB is unchanged; only
  alpha was added. Edge samples showed the outer mask ramp held only grass and
  dirt colours, so each mask was tightened until that fringe became transparent.
  Ohtani's mask also excludes the pitching rubber beside his back cleat.
- ESLint, the production build, four unit tests, and all six desktop/mobile
  public browser checks passed, covering the ten image variants and their
  archived copies, credits, licenses, and zero Supabase requests. The source
  archive contains only the five current athletes.
- At 1440, 768, 390, and 320 pixels all five figures share one baseline with no
  horizontal overflow or runtime errors. Gaps between figures are even at each
  width: 96–97 px on desktop and 10–15 px on narrow phones.

## TeamSnap positioning and brighter green — 2026-10-13

The hero now states "The free, open-source alternative to TeamSnap." A new
OpenSport vs. TeamSnap section compares price, ads, source code, data hosting,
customization, and features OpenSport does not offer yet. TeamSnap claims were
checked against its pricing page (30 million users, 19,000 organizations, free to
start with paid upgrades for availability tracking and larger rosters) and help
center (mobile app ads unless a TeamSnap+ subscription removes them). The page
links both sources and states that OpenSport is not affiliated with or endorsed
by TeamSnap. The small "Independently built" navigation label was removed, and
the dark brand green became #1f7a45; cream text on it keeps at least 4.5:1
contrast.

- ESLint, the production build, four unit tests, and all six desktop/mobile
  public browser checks passed, including new assertions for the hero statement,
  navigation link, and the comparison table's accessible name and rows.
- 1440, 768, 390, and 320 pixel layouts had no horizontal overflow or runtime
  errors. On small screens the comparison stacks each topic above its two
  answers while keeping table semantics.

## One-click cloud deploy — 2026-10-14

A Deploy button gives a team its own OpenSport on free Vercel and Supabase
accounts. Validated locally against a disposable Supabase stack (CLI 2.111,
Postgres 17.6.1.156, new-style publishable and secret keys). No Vercel project,
Supabase project, or GitHub repository was created.

- `scripts/cloud-migrate.mjs` applied all four migrations as the `postgres` role,
  including the trigger on `auth.users`, the avatars bucket, and the Realtime
  publication. A second run skipped them; preview and local builds skipped
  migrations; a connection error that waiting can't fix failed immediately.
- `vercel build` (CLI 64.0.2) used `vercel.json`'s install and build commands,
  packaged `api/setup` and `api/team-admin` as Node.js 24 functions with their
  shared modules, and kept the secret key, database password, and setup code out
  of the static files. The packaged setup function answered correctly.
- A local stand-in for Vercel served the cloud build and called the functions
  with Web Requests. A browser run covered the setup screen on a fresh install,
  a refused wrong code, team creation and sign-in, the sign-up reminder, sign-in
  for returning visitors, owner recovery with the setup code, and a phone layout.
- All six existing live browser workflows, including the reconnect checks,
  passed against that cloud install.
- The eleventh setup-code attempt within an hour was refused, even with the
  right code. Foreign origins and signed-out admin requests were refused.
- 17 unit tests, eight Edge Function tests, the database security assertions
  (now covering setup attempts), 12 public and cloud browser checks, eight Mac
  setup-screen checks, ESLint, and the production build passed.

Remaining gate: one real Deploy-button run on Vercel with the Supabase
Marketplace integration, covering provisioning timing, Supabase's pooled
connection strings, and the live sign-up setting. It needs the code on `main` and
an account owner to accept Supabase's terms.
