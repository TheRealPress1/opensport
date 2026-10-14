#!/usr/bin/env bash
set -euo pipefail
test_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
test_container="opensport-security-${RANDOM}-$$"
test_image="${OPENSPORT_TEST_POSTGRES_IMAGE:-postgres:17-alpine}"
cleanup() { docker rm -f "$test_container" >/dev/null 2>&1 || true; }
trap cleanup EXIT
docker run --detach --name "$test_container" --network none --user postgres --entrypoint sh "$test_image" \
  -c 'initdb -D /tmp/opensport-test-db -U postgres --auth=trust >/dev/null && exec postgres -D /tmp/opensport-test-db -k /tmp -c listen_addresses= -c wal_level=logical' >/dev/null
for attempt in $(seq 1 60); do
  if docker exec "$test_container" pg_isready -h /tmp -U postgres >/dev/null 2>&1; then break; fi
  if [ "$attempt" = 60 ]; then echo 'Test database did not become ready' >&2; exit 1; fi
  sleep 1
done
docker exec -i "$test_container" psql -h /tmp -X -q -v ON_ERROR_STOP=1 -U postgres < "$test_dir/fixture.sql"
for migration in "$test_dir"/../migrations/*.sql; do
  docker exec -i "$test_container" psql -h /tmp -X -q -1 -v ON_ERROR_STOP=1 -U postgres < "$migration"
done
docker exec -i "$test_container" psql -h /tmp -X -q -t -o /dev/null -v ON_ERROR_STOP=1 -U postgres < "$test_dir/security.sql"
bash "$test_dir/concurrency.sh" "$test_container"
echo 'OpenSport database security tests passed.'
