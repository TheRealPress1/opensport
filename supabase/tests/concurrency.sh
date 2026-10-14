#!/usr/bin/env bash
set -euo pipefail
test_container="$1"
test_logs=$(mktemp -d)
trap 'rm -rf "$test_logs"' EXIT
docker exec -i "$test_container" psql -h /tmp -X -q -v ON_ERROR_STOP=1 -U postgres <<'SQL'
insert into auth.users(id,email,email_confirmed_at,encrypted_password) values
  ('10000000-0000-0000-0000-000000000001','race1@example.test',now(),'fixture'),
  ('10000000-0000-0000-0000-000000000002','race2@example.test',now(),'fixture');
insert into public.soccer_members(id,user_id,name,role,active,onboarding_completed_at) values
  ('20000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','Race admin','admin',true,now()),
  ('20000000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000002','Race coach','coach',true,now());
SQL
demote() {
  docker exec -i "$test_container" psql -h /tmp -X -q -v ON_ERROR_STOP=1 -U postgres <<SQL
begin;
set local role authenticated;
select set_config('request.jwt.claim.sub','10000000-0000-0000-0000-00000000000$1',true);
select public.set_member_access('20000000-0000-0000-0000-00000000000$1','player',null);
select pg_sleep(0.3);
commit;
SQL
}
demote 1 >"$test_logs/one" 2>&1 & first=$!
demote 2 >"$test_logs/two" 2>&1 & second=$!
successes=0
if wait "$first"; then successes=$((successes+1)); else
  case "$(cat "$test_logs/one")" in
    *'must keep at least one active admin or coach'*) ;;
    *) cat "$test_logs/one" >&2; exit 1 ;;
  esac
fi
if wait "$second"; then successes=$((successes+1)); else
  case "$(cat "$test_logs/two")" in
    *'must keep at least one active admin or coach'*) ;;
    *) cat "$test_logs/two" >&2; exit 1 ;;
  esac
fi
remaining=$(docker exec "$test_container" psql -h /tmp -X -At -U postgres -c "select count(*) from public.soccer_members where active and role in ('admin','coach')")
if [ "$successes" != 1 ] || [ "$remaining" != 1 ]; then
  echo 'FAIL: concurrent demotions must leave exactly one administrator' >&2
  exit 1
fi
echo 'ok - concurrent last-admin/coach demotions are serialized'
