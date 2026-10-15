import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readDeployment } from '../src/lib/deployment.js'

test('the Vercel return link accepts only https vercel.app sites', () => {
  assert.deepEqual(readDeployment('?deployment-url=riverside-fc.vercel.app', ''), { url: 'https://riverside-fc.vercel.app', host: 'riverside-fc.vercel.app', dashboard: null })
  assert.equal(readDeployment('?deployment-url=https%3A%2F%2Friverside-fc.vercel.app%2Fsome%2Fpath', '').url, 'https://riverside-fc.vercel.app')
  assert.equal(readDeployment('', '#/start?deployment-url=riverside-fc.vercel.app').host, 'riverside-fc.vercel.app', 'parameters after the hash also count')
  for (const unsafe of ['http://riverside-fc.vercel.app', 'https://evil.test', 'https://riverside-fc.vercel.app.evil.test', 'javascript:alert(1)', 'https://vercel.app.evil.test']) {
    assert.equal(readDeployment(`?deployment-url=${encodeURIComponent(unsafe)}`, ''), null, unsafe)
  }
  assert.equal(readDeployment('', ''), null)
})

test('the dashboard link is kept only when it points at vercel.com', () => {
  const site = '?deployment-url=riverside-fc.vercel.app&project-dashboard-url='
  assert.equal(readDeployment(site + encodeURIComponent('https://vercel.com/riverside/riverside-fc'), '').dashboard, 'https://vercel.com/riverside/riverside-fc')
  assert.equal(readDeployment(site + encodeURIComponent('https://vercel.com.evil.test/x'), '').dashboard, null)
  assert.equal(readDeployment(site, '').dashboard, null)
})
