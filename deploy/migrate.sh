#!/usr/bin/env bash
set -euo pipefail
# A transaction-level lock serializes both journal initialization and migrations.
psql -X -v ON_ERROR_STOP=1 <<'SQL'
BEGIN;
SELECT pg_advisory_xact_lock(728691);
CREATE SCHEMA IF NOT EXISTS opensport_internal;
REVOKE ALL ON SCHEMA opensport_internal FROM PUBLIC;
CREATE TABLE IF NOT EXISTS opensport_internal.migrations (
  name text PRIMARY KEY,
  checksum text NOT NULL,
  applied_at timestamptz NOT NULL DEFAULT now()
);
COMMIT;
SQL
for migration in /migrations/*.sql; do
  test -f "$migration" || { echo 'No migrations found.' >&2; exit 1; }
  name=$(basename "$migration")
  checksum=$(sha256sum "$migration" | cut -d ' ' -f1)
  [[ "$name" =~ ^[a-zA-Z0-9_-]+\.sql$ ]] || { echo 'Invalid migration filename.' >&2; exit 1; }
  # The applied-state check stays under the lock, so simultaneous runners wait
  # then skip the winner's migration instead of attempting duplicate DDL.
  {
    cat <<'SQL'
BEGIN;
SELECT pg_advisory_xact_lock(728691);
SELECT EXISTS(SELECT 1 FROM opensport_internal.migrations WHERE name = :'migration_name') AS applied,
       COALESCE((SELECT checksum = :'checksum' FROM opensport_internal.migrations WHERE name = :'migration_name'), false) AS same_checksum
\gset
\if :applied
  \if :same_checksum
    \echo Already applied: :migration_name
  \else
    \echo Changed applied migration: :migration_name — restore its original contents and add a new migration.
    \quit 1
  \endif
\else
SQL
    printf '\\i %s\n' "$migration"
    cat <<'SQL'
  INSERT INTO opensport_internal.migrations(name,checksum) VALUES (:'migration_name', :'checksum');
  \echo Applied: :migration_name
\endif
COMMIT;
SQL
  } | psql -X -q -v ON_ERROR_STOP=1 -v "migration_name=$name" -v "checksum=$checksum"
done
psql -X -q -v ON_ERROR_STOP=1 -c "NOTIFY pgrst, 'reload schema';"
