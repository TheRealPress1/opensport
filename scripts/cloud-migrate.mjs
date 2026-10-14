#!/usr/bin/env node
// Applies supabase/migrations to a one-click cloud install's database during its
// Vercel production build. Mirrors deploy/migrate.sh: a transaction-level lock
// serializes runners, and a checksum journal skips finished files and refuses
// edited ones. Builds without a cloud database (the project site, self-hosting)
// skip it.
import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import pg from 'pg';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const LOCK = 728691;
// The Deploy button creates the Supabase project moments before the first build,
// and a new project can take a few minutes to accept connections.
const WAIT_FOR_DATABASE_MS = 5 * 60 * 1000;
// Network failures, Postgres still starting (57P03), and the connection pooler
// not knowing the new project yet ("Tenant or user not found", XX000).
const notReadyCodes = new Set(['ENETUNREACH', 'EHOSTUNREACH', 'ENOTFOUND', 'ETIMEDOUT', 'ECONNREFUSED', 'ECONNRESET', 'EAI_AGAIN', '57P03', '08001', '08006', '28P01', 'XX000']);
const notReady = error => notReadyCodes.has(error.code) || /tenant or user not found|timeout|terminated/i.test(error.message);

export async function migrate(client, migrations, log = console.log) {
  await client.query('BEGIN');
  try {
    await client.query('SELECT pg_advisory_xact_lock($1)', [LOCK]);
    await client.query('CREATE SCHEMA IF NOT EXISTS opensport_internal');
    await client.query('REVOKE ALL ON SCHEMA opensport_internal FROM PUBLIC');
    await client.query('CREATE TABLE IF NOT EXISTS opensport_internal.migrations (name text PRIMARY KEY, checksum text NOT NULL, applied_at timestamptz NOT NULL DEFAULT now())');
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  }
  for (const { name, sql } of migrations) {
    const checksum = createHash('sha256').update(sql).digest('hex');
    await client.query('BEGIN');
    try {
      // The applied-state check stays under the lock, so a simultaneous runner
      // waits and then skips the winner's migration instead of repeating DDL.
      await client.query('SELECT pg_advisory_xact_lock($1)', [LOCK]);
      const { rows } = await client.query('SELECT checksum FROM opensport_internal.migrations WHERE name = $1', [name]);
      if (rows.length) {
        if (rows[0].checksum !== checksum) throw new Error(`Changed applied migration: ${name}. Restore its original contents and add a new migration.`);
        await client.query('COMMIT');
        log(`Already applied: ${name}`);
        continue;
      }
      await client.query(sql);
      await client.query('INSERT INTO opensport_internal.migrations(name, checksum) VALUES ($1, $2)', [name, checksum]);
      await client.query('COMMIT');
      log(`Applied: ${name}`);
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      throw error;
    }
  }
  await client.query("NOTIFY pgrst, 'reload schema'");
}

export async function readMigrations(directory = path.join(root, 'supabase', 'migrations')) {
  const names = (await readdir(directory)).filter(name => name.endsWith('.sql')).sort();
  if (!names.length) throw new Error('No migrations found.');
  for (const name of names) if (!/^[a-zA-Z0-9_-]+\.sql$/.test(name)) throw new Error(`Invalid migration filename: ${name}`);
  return Promise.all(names.map(async name => ({ name, sql: await readFile(path.join(directory, name), 'utf8') })));
}

// Connection-string SSL settings would override the explicit ssl option below.
function withoutSslParameters(url) {
  const parsed = new URL(url);
  for (const key of ['sslmode', 'sslrootcert', 'sslcert', 'sslkey', 'uselibpqcompat', 'workaround', 'supa', 'pgbouncer']) parsed.searchParams.delete(key);
  return parsed.toString();
}

// Supabase signs its certificates with its own authority. Like libpq's
// sslmode=require, encrypt the connection without verifying that authority.
// Only an explicit sslmode=disable, as for a local test database, turns it off.
const createClient = url => new pg.Client({
  connectionString: withoutSslParameters(url),
  ssl: new URL(url).searchParams.get('sslmode') === 'disable' ? false : { rejectUnauthorized: false },
  connectionTimeoutMillis: 15000,
});

// Tries each address in order and returns the first connected client. While
// every address reports that the database isn't ready, waits and tries again;
// an error that waiting can't fix ends it once every address has failed.
export async function connectWhenReady(urls, { connect = createClient, waitMs = WAIT_FOR_DATABASE_MS, sleep = ms => new Promise(resolve => setTimeout(resolve, ms)), log = console.log } = {}) {
  const deadline = Date.now() + waitMs;
  for (let round = 1; ; round++) {
    let lastError;
    let fatal;
    for (const url of urls) {
      const client = connect(url);
      try {
        await client.connect();
        return client;
      } catch (error) {
        await client.end().catch(() => {});
        if (notReady(error)) lastError = error;
        else fatal ??= error;
      }
    }
    if (fatal) throw fatal;
    if (Date.now() >= deadline) throw lastError;
    log(`The database isn't accepting connections yet (${lastError.message}). Trying again shortly.`);
    await sleep(Math.min(5000 * round, 20000));
  }
}

export async function main(env = process.env) {
  // The session (non-pooling) address handles DDL best; Vercel builds may lack
  // IPv6 for Supabase's direct host, so fall back to the IPv4 pooler.
  const urls = [...new Set([env.POSTGRES_URL_NON_POOLING, env.POSTGRES_URL].filter(Boolean))];
  if (!urls.length) { console.log('No cloud database is configured; skipping migrations.'); return; }
  if (env.VERCEL_ENV !== 'production' && env.OPENSPORT_MIGRATE !== '1') {
    console.log(`Skipping database migrations for this ${env.VERCEL_ENV || 'local'} build; production deployments apply them.`);
    return;
  }
  const migrations = await readMigrations();
  const client = await connectWhenReady(urls);
  try { await migrate(client, migrations); }
  finally { await client.end().catch(() => {}); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(error => {
    // Never print connection strings; they contain the database password.
    console.error(`Database migration failed: ${error.message}`);
    console.error('If you just created this project, its database may still be starting. Wait a minute, then redeploy it from your Vercel dashboard.');
    process.exitCode = 1;
  });
}
