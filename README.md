# OpenSport

**The free, open-source alternative to TeamSnap.** Your team. Your community. OpenSport.

[Website and demo](https://getopensport.vercel.app) · [Setup guide](docs/SELF_HOSTING.md) · [Mac preview](docs/MAC_APP.md)

OpenSport is a self-hosted, open-source TeamSnap alternative: team management with no ads and no subscription. Coordinate schedules, rosters, and RSVPs for any sport; soccer teams can also use formations, published lineups, goals, and assists. One installation serves one team, with its own database and accounts.

This repository was previously named `teamsnap-open-source` (and before that, `teambabo`); old links redirect here.

## Why it exists

I have played soccer since I was three. Every team I was on used TeamSnap to organize and let family and friends follow along. When I became captain of my college soccer team, I realized how critical organization was—and how expensive it could be for a whole team.

I built OpenSport to make that coordination simpler and more accessible, so teams can spend more time enjoying sports together. This is an independent project, not affiliated with TeamSnap, and it does not promise full TeamSnap feature parity.

## Try it

The project site includes a fictional team demo using the real interface. Explore schedules, rosters, results, and a published soccer lineup; change your RSVP and refresh to reset. The demo makes no Supabase, Auth, Storage, or Realtime requests.

To run the project site locally (Node 22.12+):

```sh
npm ci
cp .env.example .env.local
npm run dev
```

The example selects `VITE_APP_MODE=project`. Team mode is an explicit installation choice. A team installation directs visitors to its own sign-in and team workspace, not the project marketing page.

## Host your team

**Host on the organizer’s Mac first** is the direction for the first Mac version. The [Mac hosting preview](docs/MAC_APP.md) provides guided setup without Docker, Terminal, or server rental for organizers using the packaged app. Once secure remote sharing ships, teammates will open a shared HTTPS address in their browsers, including on phones; only the organizer needs the Mac app.

The current Apple silicon preview is **local-only and for fictional test data** while release checks are completed. New installations use private database credentials and authenticated startup. Internet sharing is not available yet. The Mac must be running to host the team. Public Mac distribution also requires Developer ID signing, notarization, and the remaining acceptance checks in the Mac guide; the current build is ad-hoc signed for local review.

### Advanced hosting with Docker

Follow the [self-hosting guide](docs/SELF_HOSTING.md). Docker Compose runs the app, PostgreSQL, Auth, Storage, and Realtime on your own computer or server. No Supabase cloud account or paid service is required. An always-on, reachable host is needed for teammates to use it; remote access requires a configured domain and HTTPS.

```sh
bash scripts/ops.sh init
bash scripts/ops.sh up
bash scripts/ops.sh bootstrap
```

Create the first administrator from the host, configure your team, and copy invitation links to share privately with teammates. Public signup is disabled. Invitation and recovery links work without SMTP; the host can recover administrator access.

Download archives contain source code and setup tooling, not a desktop installer. A built project site serves its versioned archive at `/downloads/opensport-0.1.0-source.zip`, with a SHA-256 checksum alongside it. `npm run build` generates the archive from the current source; `npm run release:prepare` validates the web release candidate. Database and Docker acceptance checks described below are also required before publishing a release.

## Included

- List/calendar schedules, locations, notes, and timezone-aware calendar links.
- Going, Maybe, and Can’t RSVPs, without requiring a messaging app.
- Optional profile photos, jersey numbers, positions, and contact details.
- Administrator invitations, recoverable account access, member deactivation, and protected administration.
- General sport mode with optional simple final scores; soccer mode with formations, goals, assists, and published lineups.
- Database-enforced permissions, private avatars, restricted contacts, and administrator-only lineup drafts.
- Persistent team settings, restart persistence, and documented database/storage backup and restore.

RSVP participation is the share of eligible past events marked Going; it is **not recorded attendance**. Messaging shortcuts open your own messaging app; they do not send automatic reminders.

## Architecture

React 19, Vite 8, Tailwind CSS 4, and Supabase (Postgres/Auth/Storage/Realtime).

- `src/App.jsx` selects the public site, isolated demo, or lazily loaded live application.
- `src/components/TeamWorkspace.jsx` is shared presentation. Live data and fictional data supply the same interface.
- `src/lib/useTeam.js` owns live reads, mutations, auth, and subscriptions.
- `supabase/` contains the versioned schema, database permissions, privileged team administration function, and security tests.
- `deploy/` and `scripts/ops.sh` package and operate the self-hosted service.
- `desktop/` packages the Mac setup app and supervises its experimental native server. The browser-facing gateway and native controls have separate permissions.

Only public API credentials belong in frontend environment variables. Service credentials stay on the host. Google Maps is optional; manual location entry works without it.

## Development and validation

```sh
npm ci
npx playwright install chromium
npm run lint
npm test
npm run build
npm run test:e2e
```

See [contributor instructions](CONTRIBUTING.md) for database tests and release gates, and the [v0.1.0 validation record](docs/VALIDATION.md) for completed checks and remaining release requirements. Tests use synthetic accounts and local isolated databases; never point them at a real team's installation.

The original Babson installation is not automatically migrated. Its schema, permissions, and storage must be audited and backed up, then migration rehearsed on a copy before changing its deployment. The source migrations target fresh installations; they are not an unattended legacy migration.

## First-release scope

One team per host; invite-only accounts. Family/fan feeds, parent-managed accounts, automated messaging, payments, leagues, multi-team SaaS, and additional sport-specific scoring are future work.

Code is [MIT licensed](LICENSE). Landing-page photography and its cutout adaptations retain their individual Creative Commons licenses; see [photo credits](src/lib/athleteCredits.json) and the included license texts. The bundled Barlow Condensed font retains its [SIL Open Font License](public/fonts/OFL-BarlowCondensed.txt). Contributions and [issues](https://github.com/TheRealPress1/opensport/issues) are welcome. Vendored Supabase deployment resources retain their upstream license and provenance.
