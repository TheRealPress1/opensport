# Supabase deployment provenance

The unmodified files in this directory come from Supabase **self-hosted/v0.8.2**,
commit `564eab8ad7840b13324f68b1bfac074ef8d51c21`:
https://github.com/supabase/supabase/tree/564eab8ad7840b13324f68b1bfac074ef8d51c21/docker

`SHA256SUMS` records the vendored contents. `LICENSE` is the upstream Apache 2.0
license. OpenSport's MIT license does not replace upstream component licenses.

`../compose.yml` adapts that versioned upstream set: it omits Studio, analytics,
metadata and connection-pooler services; removes host ports and globally fixed
container names; uses named volumes; adds a frontend/Caddy HTTPS gateway,
operator tools and ordered application migrations. Auth signup is disabled.
Service versions retain the official release's exact image tags. No files are
fetched from a moving branch during installation. Docker images, npm dependencies
and ACME certificates still require network access on first use.

Source: https://supabase.com/docs/guides/self-hosting/docker
