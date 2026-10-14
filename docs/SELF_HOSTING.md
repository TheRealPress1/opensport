# Run your own OpenSport team

OpenSport runs one private team per installation. You need Docker Engine with
Docker Compose v2 (Docker Desktop on macOS/Windows), a terminal with Bash, and
about 4 GB of available memory and 40 GB of disk. Initial installation downloads
container images and frontend dependencies. No Supabase account, SMTP service,
cloud account, or paid subscription is required. Use a supported 64-bit Linux or
Apple Silicon/Intel machine; Windows users should run these commands in WSL2.

## Start locally

Download and unpack an OpenSport source release, then open a terminal in that
folder. Keep the entire folder: it contains the pinned deployment and migrations.

```sh
./scripts/ops.sh init
./scripts/ops.sh up
./scripts/ops.sh bootstrap
```

Open **http://localhost:8080**. The last command prompts privately for the first
administrator's email, display name, and password (12 characters minimum). Sign
in and set the team name, season, timezone, and sport in Settings. A new install
contains no sample players or matches. Invitations are created by administrators;
public account signup is disabled.

`init` generates new database passwords, JWT signing secrets, API keys, and other
service credentials. They live in `.opensport/.env` with private permissions.
The browser receives only the public anonymous API key. Never commit or share
this directory. Re-running `init` refuses to replace existing credentials.
Passwords are read without terminal echo and are never passed as CLI arguments.

The local default binds only to your computer's loopback interface. It is useful
for evaluating the app; `localhost` links will not work on teammates' devices.
Docker must stay running. Do not expose the local HTTP installation to the Internet.

## Let teammates connect over HTTPS

Use an always-on machine with a public DNS name pointing to it, such as
`team.example.org`. Route inbound TCP ports **80** and **443** to that machine;
leave database and administration ports closed. CGNAT or a router you cannot
configure needs a separately managed HTTPS tunnel or a reachable host.

For a fresh remote installation:

```sh
./scripts/ops.sh init https://team.example.org
./scripts/ops.sh up
./scripts/ops.sh bootstrap
```

Caddy obtains and renews HTTPS certificates automatically. DNS must already point
to the host and ports 80/443 must be reachable for certificate issuance. Frontend,
Auth, REST, private avatars, functions, and realtime connections use the same
origin; `/api` is routed to the internal Supabase API gateway. Neither Postgres,
Studio, a connection pooler, nor container health endpoints are published.

To change the address of an existing installation, take a backup first. Edit
`.opensport/.env` to update `PUBLIC_URL`, `CADDY_SITE`, `SITE_URL`,
`ADDITIONAL_REDIRECT_URLS`, `API_EXTERNAL_URL` (the origin plus `/api/auth/v1`),
and `SUPABASE_PUBLIC_URL` (the origin plus `/api`). For public HTTPS, use
`BIND_ADDRESS=0.0.0.0`, `HTTP_PORT=80`, and `HTTPS_PORT=443`. Then run `up` to
recreate services and rebuild the browser bundle. Existing invitation links use
the old address; generate replacement links. Keep all generated secrets unchanged.

## Invitations and forgotten passwords

Administrators create invitations in the team settings and copy each private,
one-use link to the invited teammate. No email delivery is assumed. The teammate
opens the link and chooses a password. Links expire after one hour; generate a
new one if needed. Treat invitation and recovery links like passwords.

Administrators can generate member recovery links from the app. If the last
administrator cannot sign in, the host can restore access:

```sh
./scripts/ops.sh recover
```

This host-only command prompts for an existing account's email, restores its
active administrator role, and prints a private one-use password recovery link.
It deliberately requires Docker host access and is unavailable in the browser.
The app protects the last active administrator from removal.

## Daily operations and updates

```sh
./scripts/ops.sh status
./scripts/ops.sh logs auth
./scripts/ops.sh down
./scripts/ops.sh up
./scripts/ops.sh migrate
```

`down` removes containers and the private network, **not persistent volumes**.
`up` starts the backend, waits for health checks, applies pending application
migrations, then builds and starts the app. Migrations run transactionally and
record checksums. An already applied migration cannot silently change. `migrate`
stops the frontend while applying pending migrations and restarts it only on
success. No operation resets a database during an upgrade.

For an OpenSport update: take a backup, retain `.opensport`, unpack the new release
over the application files, read its release notes, and run `up`. Rehearse on a
restored copy first. Supabase image tags are pinned to the official
`self-hosted/v0.8.2` set; do not independently upgrade Postgres or other services.
Upstream source, license, commit, and checksums are in `deploy/upstream`.

Existing hosted/Babson databases require a separate schema audit, backup, and
migration rehearsal. These commands target the local Compose project only;
they are not a cloud migration or production data-import tool.

## Backup and restore

```sh
./scripts/ops.sh backup
```

This performs a **cold snapshot**: stops services cleanly, archives Postgres
(including Auth and every team record), storage files, Postgres encryption
configuration, HTTPS certificates, deployment definitions, and generated secrets, verifies
the archive checksum, and starts services again. The team is briefly unavailable.
If creating the backup fails, services stay stopped so you can inspect the error
before running `up`. Keep both the `.tar.gz` and `.tar.gz.sha256` files printed by
the command. Store an encrypted copy off the host; the archive contains credentials
and personal team data. A checksum detects damage, not malicious modification.

Restore only backups you trust. Restore requires **a fresh state directory and
Compose project**, the same CPU architecture, and this pinned Supabase release.
It never overwrites a nonempty data volume. Custom deployment definitions are saved
under `deployment/` in the archive for review; restore does not overwrite application
source or execute archived deployment scripts. Stop the original installation first
if you will reuse its address and ports:

```sh
./scripts/ops.sh down
OPENSPORT_STATE_DIR="$PWD/.opensport-restored" \
  COMPOSE_PROJECT_NAME=opensport-restored \
  ./scripts/ops.sh restore /absolute/path/to/opensport-backup.tar.gz
OPENSPORT_STATE_DIR="$PWD/.opensport-restored" \
  COMPOSE_PROJECT_NAME=opensport-restored \
  ./scripts/ops.sh up
```

If you choose a different state directory name, keep it outside the source tree
or add it to your Git and Docker ignore files; it contains private backups.

Keep using those same two environment variables for all restored-installation
commands. Rehearse restoration regularly: sign in with an existing account,
check events and RSVPs, and open an avatar. A valid archive checksum alone does
not prove the application can use a restored database. This snapshot format is
for recovery on the same architecture/release, not moving between Postgres major
versions; such moves require a separately rehearsed logical migration.

## Troubleshooting

- **Service unhealthy:** run `status`, then `logs db`, `logs auth`, or `logs
  functions`. Ensure Docker has sufficient memory and disk. Do not delete volumes
  to work around an error.
- **Docker image or npm download fails:** check Internet access and Docker's
  registry access, then rerun `up`. Existing data is retained. If your host uses
  an HTTP proxy, configure Docker's build proxy as well as the daemon proxy;
  frontend dependency installation also needs Internet access inside the build.
- **Port already allocated:** choose another local origin during `init`, for
  example `http://localhost:18880`, or stop the service using ports 80/443 on a
  remote host.
- **Certificates fail:** confirm DNS and inbound ports 80/443. Check `logs web`.
- **Link points at localhost:** the installation is in local evaluation mode;
  configure a reachable HTTPS origin before inviting remote teammates.
- **Invite expired or already used:** generate a new private link. Public signup
  is intentionally disabled.
- **Changed applied migration:** restore that file from its original release;
  schema changes belong in a new migration. Back up before retrying.
- **Restore refuses an existing environment/volume:** choose a new project name
  and empty state directory. The refusal protects the existing team.

Only the installation host administrator can access Docker and generated
credentials. Docker access is equivalent to privileged access to this team's data.
