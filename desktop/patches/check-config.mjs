import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import { mkdir, mkdtemp, writeFile, rm } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { BunServices } from '@effect/platform-bun'
import { Effect, Exit, Layer, Redacted } from 'effect'
import { runtimeInfoLayer } from '../src/shared/runtime/runtime-info.layer.ts'
import { loadStackConfig } from '../src/command-internal/stack-config.ts'
// This is copied into the pinned source's apps/cli/scripts directory.
// Configuration is evaluated without starting an owner, database, or service.
const projectRoot = await mkdtemp(fileURLToPath(new URL('../../../../config-check-', import.meta.url)))
await mkdir(`${projectRoot}/supabase`, { recursive: true })
await writeFile(`${projectRoot}/supabase/config.toml`, 'project_id = "opensport-config-check"\n')
const run = effect => Effect.runPromise(effect.pipe(Effect.provide(Layer.mergeAll(BunServices.layer, runtimeInfoLayer))))
const password = randomBytes(32).toString('hex'), key = randomBytes(32).toString('hex')
try {
  delete process.env.OPENSPORT_NATIVE_DATABASE_PASSWORD
  delete process.env.OPENSPORT_NATIVE_POSTGRES_ROOT_KEY
  const config = await run(loadStackConfig(projectRoot))
  console.log('PASS config loading does not require secrets')
  for (const [label, pw, rootKey] of [['missing', undefined, undefined], ['short-password', 'invalid', key], ['missing-root-key', password, undefined], ['malformed-root-key', password, 'invalid']]) {
    if (pw === undefined) delete process.env.OPENSPORT_NATIVE_DATABASE_PASSWORD
    else process.env.OPENSPORT_NATIVE_DATABASE_PASSWORD = pw
    if (rootKey === undefined) delete process.env.OPENSPORT_NATIVE_POSTGRES_ROOT_KEY
    else process.env.OPENSPORT_NATIVE_POSTGRES_ROOT_KEY = rootKey
    const result = await run(Effect.exit(config.creations('config-only-check')))
    assert.ok(Exit.isFailure(result), `Credentials were accepted for ${label}`)
    console.log(`PASS rejected ${label}`)
  }
  process.env.OPENSPORT_NATIVE_DATABASE_PASSWORD = password
  process.env.OPENSPORT_NATIVE_POSTGRES_ROOT_KEY = key
  const creations = await run(config.creations('config-only-check'))
  const database = creations.find(row => row.service === 'database')
  assert.ok(Redacted.value(database.config.databasePassword) === password)
  assert.ok(Redacted.value(database.config.rootKey) === key)
  console.log('PASS generated credentials reach database creation as redacted values')
} finally {
  delete process.env.OPENSPORT_NATIVE_DATABASE_PASSWORD
  delete process.env.OPENSPORT_NATIVE_POSTGRES_ROOT_KEY
  await rm(projectRoot, { recursive: true, force: true })
}
