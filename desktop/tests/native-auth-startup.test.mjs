import test from 'node:test'
import assert from 'node:assert/strict'
import { ownedPostgresPids, postgresSocketPaths } from './native-auth-startup.monitor.mjs'

test('startup monitor only selects PostgreSQL binaries inside its exact private fixture', () => {
  const root = "/tmp/fixture/Coach's Team/runtime/home/cache"
  const output = ` 11 ${root}/stack/slim-services/postgres/version/darwin-arm64/bin/postgres\n 12 ${root}-other/bin/postgres\n 13 /some/other/bin/postgres\n 14 ${root}/stack/slim-services/postgres/version/bin/psql\n 15 postgres: checkpointer\n 16 ${root}/stack/slim-services/postgres/version/darwin-arm64/bin/.postgres-wrapped\n 17 ${root}/stack/slim-services/postgres/version/bin/.postgres-wrapped-other\n`
  assert.deepEqual(ownedPostgresPids(output, root), [11, 16])
})

test('startup socket monitor distinguishes temporary and final sockets without probing unrelated names', () => {
  const output = 'p11\nn/tmp/supabase-pg.ABC123/.s.PGSQL.5432\nn/private/tmp/supabase-pg-ZYX987/.s.PGSQL.5432\nn/tmp/other/.s.PGSQL.5432\nn/tmp/supabase-pg.ABC123/.s.PGSQL.5432.lock\nn/tmp/supabase-pg.ABC123/.s.PGSQL.5432\n'
  assert.deepEqual(postgresSocketPaths(output), [
    { socket: '/tmp/supabase-pg.ABC123/.s.PGSQL.5432', kind: 'temporary' },
    { socket: '/private/tmp/supabase-pg-ZYX987/.s.PGSQL.5432', kind: 'final' },
  ])
})
