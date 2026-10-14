import test from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { NATIVE_PATH_HELPERS, nativeBootstrapHba, parseListenerAudit } from '../native-isolation.mjs'
import { localOrigin } from '../native-runtime.mjs'

test('listener audit rejects wildcard, LAN and IPv6 wildcard sockets', () => {
  const listeners = parseListenerAudit('p42\nn127.0.0.1:24567\nn[::1]:24568\np43\nn*:29000\nn192.168.1.2:29001\nn[::]:29002\n')
  assert.deepEqual(listeners.map(item => item.loopback), [true, true, false, false, false])
  assert.equal(listeners[2].pid, 43)
})

test('preview address rejects external hosts, credentials and path tricks', () => {
  for (const value of ['https://team.example.org', 'http://192.168.1.2:8080', 'http://user@localhost:8080', 'http://localhost:8080/private', 'http://localhost:8080/?redirect=elsewhere']) assert.throws(() => localOrigin(value))
  assert.equal(localOrigin('http://127.0.0.1:8080'), 'http://127.0.0.1:8080')
})

test('native PostgreSQL configuration paths preserve spaces, apostrophes and backslashes', () => {
  const value = "/Users/Coach's Team/$(printf x)/$OPENSPORT_QUOTE_TEST/a\\b"
  const postgres = execFileSync('/bin/sh', ['-c', `${NATIVE_PATH_HELPERS}\n printf '%s' "$1" | opensport_pg_escape`, 'test', value], { encoding: 'utf8' })
  assert.equal(postgres, value.replaceAll('\\', '\\\\').replaceAll("'", "''"))
})

// Unmodified upstream postgres-17.11.0.004-r1 fixture; its exact archive hash
// is checked by nativeBootstrapHba before any authentication rules are changed.
const originalHba = readFileSync(new URL('./fixtures/native-pg_hba.conf.template', import.meta.url), 'utf8')

test('first-boot PostgreSQL only permits authenticated local connections', () => {
  const rules = nativeBootstrapHba(originalHba).split('\n').map(line => line.trim()).filter(line => line && !line.startsWith('#')).map(line => line.split(/\s+/))
  assert.deepEqual(rules, [
    ['local', 'all', 'all', 'scram-sha-256'],
    ['host', 'all', 'all', '127.0.0.1/32', 'scram-sha-256'],
    ['host', 'all', 'all', '::1/128', 'scram-sha-256'],
  ])
})

test('bootstrap authentication refuses an unrecognized or modified upstream template', () => {
  for (const source of ['', originalHba.replace('local all  all', 'local postgres all'), `${originalHba}\nlocal all all trust\n`]) {
    assert.throws(() => nativeBootstrapHba(source), /not recognized/)
  }
})
