# OpenSport for Mac — local hosting preview

The first-version direction is **host on the organizer’s Mac**. OpenSport provides a setup wizard and host controls so a coach can run their team without renting a server. The organizer uses the Mac app and opens the team interface in a normal browser. Once secure remote sharing ships, teammates will use a shared HTTPS address in their browsers, including on phones; they will not need the Mac app.

Remote sharing is planned, not available in this preview. Docker remains an advanced option for operators who want to manage an always-on server and remote HTTPS access themselves; it is not part of the main Mac setup.

This is a **local preview for Apple silicon Macs running macOS 14 or later**, not the public Mac release. It uses the experimental native Supabase runtime. It does not make a team reachable by teammates over the internet. Do not forward its ports or put a tunnel in front of the native services.

Use a fictional team while evaluating this preview and completing release checks. New installations generate private database credentials and require password authentication from the first database startup. Hosting checks authentication before opening the team interface. This protects database connections; software running as the organizer or a Mac administrator can still access the installation files.

## What the organizer does

1. Open OpenSport at **Host on this Mac** and choose **Set up on this Mac**.
2. Enter the team name, timezone, and General or Soccer mode.
3. Create the first administrator with a name, email, and password.
4. Wait while OpenSport prepares the local server. The first setup needs internet access to download verified native services and can take several minutes. Subsequent starts reuse those downloads.
5. Open the team in a browser and sign in. Use the existing schedule, roster, RSVP, invitations, and team settings screens.

No Docker, Terminal, Homebrew, Node installation, or Supabase cloud account is required by the organizer using the packaged application. An email service is not required. Invitation links in this preview work only on the host Mac; internet sharing is not available yet.

The app prevents automatic idle sleep while hosting. Closing its window leaves the host running. Quitting the app stops it safely. Closing the laptop lid, shutting down, losing power, and disconnecting the network can still interrupt availability. This does not turn a personal laptop into an always-on server.

The secondary **Already have a team address?** section accepts an HTTPS address; **Open existing team** opens it in the default browser. It is for a team that already has a configured host; it does not provision or rent a server. New organizers start with **Set up on this Mac**.

## Data, backups, and recovery

Private state belongs to `~/Library/Application Support/OpenSport/`, independently of the `.app` bundle. Replacing the app must not delete this directory. The app keeps server credentials in its main process; the browser receives only the public anonymous key and uses the same database permissions as the server deployment.

**Save backup** briefly stops the server, saves the team and accounts, and then restarts it if it was running. Backups contain private records and credentials: keep them somewhere private. **Restore backup** accepts a backup only in an empty installation; it cannot overwrite an existing team. Docker backups and native Mac backups are different formats.

Restore only a backup you created or received from an operator you trust. A database backup contains executable database definitions; file checksums detect corruption, not a malicious backup author.

This build uses backup format 2 and the `opensport-native-auth-v1` installation profile. Earlier previews and their backups cannot be started or converted by this build. The app preserves an older installation and shows its folder in Finder; it disables hosting and recovery. Legacy backups are rejected before any files are installed. Keep that older folder or backup until a reviewed migration is available. New-format backups retain their private database password and encryption key through restart and restore.

Administrator recovery is available from the host controls. The host enters the administrator email and receives a private password-reset link to open themselves. Share such a link only with its intended account owner. Nothing is emailed automatically.

## Building the preview (contributors)

These are developer commands, not instructions for the organizer receiving the app. Use an Apple silicon Mac with Node 22.12 or newer and Xcode command-line tools.

```sh
npm ci
npx install-electron
npm run desktop:prepare
npm run desktop:dev
```

Create the application and disk image:

```sh
npm run desktop:build
```

Output is under `desktop/out/`, including `OpenSport-darwin-arm64/OpenSport.app`, a preview `.dmg`, and its SHA-256 checksum. The build uses pinned Electron and a small source patch to Supabase CLI 2.120.0. It downloads a pinned Bun/pnpm toolchain, verifies source and patch checksums, compiles the launcher, and checks its build identity and signature. See the [native build instructions](../desktop/patches/README.md) for provenance and rebuild steps. The organizer receiving the app needs none of those developer tools. The build includes database migrations and function sources and builds separate setup and team interfaces without inheriting production Vite credentials. Generated resources and bundles are ignored by Git and excluded from source releases.

The development app is ad-hoc signed and its resource seal is verified locally. It is **not Developer ID signed or notarized**. It is for local review. Public distribution requires the project owner's Apple signing credentials, notarization, a tested update/migration policy, and a clean-machine acceptance run. Never recommend disabling Gatekeeper or other system security settings.

## Validation and next release gates

```sh
npm run test:desktop
npm run test:desktop:ui
npm run test:desktop:electron
OPENSPORT_NATIVE_TEST_DATA_DIR=.context/mac-native-check npm run test:desktop:native
OPENSPORT_ELECTRON_HOST_TEST=1 node --test desktop/tests/electron-host.integration.mjs
npm run lint
npm run build
```

The UI suite uses a mocked native bridge to exercise recoverable setup errors and controls. Native integration and actual packaged-app checks must be recorded separately; a passing UI suite does not prove the server or its backup can work.

After the native integration check creates its disposable fixture, run the
database authentication release gate:

```sh
OPENSPORT_NATIVE_SECURITY_AUDIT=1 OPENSPORT_NATIVE_TEST_DATA_DIR=.context/mac-native-check node desktop/tests/native-security.audit.mjs
```

This starts and stops only that fixture, sends read-only authentication probes,
and saves a diagnostic report inside its private directory. Exit 2 means an
incorrect or public development password was accepted, or an authentication
policy check failed. Hosting itself also checks these conditions and stops on
failure. Connection failures are errors, not successful rejection evidence.

With a disposable team gateway already running on loopback and its synthetic
credentials supplied through `OPENSPORT_TEST_ADMIN_EMAIL`,
`OPENSPORT_TEST_ADMIN_PASSWORD`, and `OPENSPORT_TEST_URL`, run the additional
connection-loss and read-error browser checks:

```sh
OPENSPORT_TEST_RECONNECT=1 npm run test:live
```

These tests deliberately cut a browser's connection, verify missed changes are
recovered without refreshing, and ensure failed-save inputs survive a successful
background read. They do not start a gateway themselves and skip by default.

Run the native and Electron hosting checks sequentially: the upstream native runtime recommends only one active project per environment. The opt-in checks create synthetic accounts in `.context/`, start only their own local services, and stop them afterward. They need the prepared desktop resources and Chromium. Native checks include cold restoration into a different empty data directory. The manual **OpenSport Mac preview** GitHub workflow runs these checks and produces an ad-hoc signed preview artifact; it does not publish a release.

The Mac runtime applies checksum-guarded configuration changes to the pinned upstream service launchers so their listeners bind to loopback. Before enabling the team interface, it audits the owned processes' TCP listeners, waits for the database API, and starts the Realtime stream so the first update is not missed. The same checked overlays handle PostgreSQL paths containing spaces or apostrophes, including the normal Application Support folder, without modifying service binaries. The original files and upstream notices are retained. See `desktop/native-isolation.mjs` for exact upstream versions, hashes, and changes.

Before enabling remote Mac hosting: choose a stable HTTPS connection method, retain the database authentication gate, audit every native service listener and credential, test browser access from a second physical device, test restart and offline behavior, and preserve the same invitation, recovery, role, and backup guarantees as the server installation. Remote sharing must explain when the host Mac is available and make setup practical for an organizer without requiring server rental. The upstream runtime is still experimental; the app must not silently substitute its local-development defaults for a production deployment.

References: [Supabase native runtime](https://supabase.com/docs/guides/local-development/docker-and-native-runtimes), [Electron security](https://www.electronjs.org/docs/latest/tutorial/security), [Apple notarization](https://developer.apple.com/documentation/security/notarizing-macos-software-before-distribution).
