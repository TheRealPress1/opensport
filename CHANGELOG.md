# Changelog

## Unreleased — One-click cloud deploy

- Adds a Vercel Deploy button that gives a team its own OpenSport on free Vercel and Supabase accounts, with no Terminal or server.
- Prepares the team's database during each production build, waiting for a brand-new Supabase project to come online.
- Adds a browser setup screen protected by a setup code chosen while deploying. Owner recovery uses the same code once the owner switches it on in Vercel. Code checks are limited per visitor and overall.
- Replaces accounts that OpenSport didn't create, such as open Supabase sign-ups, when their address is invited or used for setup.
- Runs invitations and recovery links as Vercel Functions that share their logic with the self-hosted Edge Function.
- Documents costs, pausing, backups, updates, and optional sign-up settings in the cloud guide, without asking new coaches to change Supabase settings.
- Adds a guided Start your team page that pictures every Vercel and GitHub screen, including creating a GitHub account, and welcomes coaches back with a link to their new site after Vercel deploys it.
- Makes "Start your team" the main call to action on the project site, with a featured cloud card, the cloud option first in the setup guide, and the source download moved to the self-hosting card.

## Unreleased — Mac hosting preview

- Requires authenticated native database startup with private installation credentials and encryption keys, a pinned source-built launcher, and a repeated authentication gate.
- Validates both temporary bootstrap and final database sockets, rejects legacy backup formats before installation, and preserves older preview files with a compatibility message.
- Makes hosting on the organizer’s Mac the main setup flow, with availability guidance and a secondary option for an existing team address.
- Refreshes missed team updates when the browser reconnects or its live subscription recovers; successful reads clear temporary connection errors while preserving failed-save inputs and messages.
- Adds opt-in connection-loss browser tests and a native database authentication release gate covering incorrect and public development passwords.
- Adds an Electron Mac app with guided team and administrator setup, lifecycle controls, backups, and host recovery.
- Reuses the live browser team interface through a separate loopback gateway; privileged credentials stay in the native process.
- Packages the pinned experimental Supabase native runtime for Apple silicon Macs without requiring Docker or Terminal for end users.
- Keeps internet sharing disabled and labels the preview for fictional test data pending release acceptance. Public distribution still requires signing and notarization.

## 0.1.0 — release candidate

- Rebrands the project as OpenSport with its player-to-builder origin story.
- Adds an adoption-focused public site, isolated fictional demo, versioned source packaging, and setup links.
- Introduces reproducible single-team self-hosting, invitation-only accounts, persisted team settings, and database-enforced access controls.
- Separates general sport coordination from optional soccer tools.
- Adds recoverable writes, optional profile fields, independent RSVPs, corrected participation metrics, and timezone-aware calendar exports.
- Adds MIT licensing, contribution guidance, CI, and release acceptance checks.

This is a candidate until frontend, database, full installation, HTTPS, and backup/restore checks pass. It does not migrate the existing Babson deployment automatically.
