import { defineConfig, devices } from '@playwright/test'

export default defineConfig({
  testDir: '.',
  testMatch: '**/*.spec.js',
  fullyParallel: false,
  workers: 1,
  timeout: 60000,
  expect: { timeout: 15000 },
  reporter: 'list',
  outputDir: '../../test-results/live',
  use: {
    baseURL: process.env.OPENSPORT_TEST_URL || 'http://localhost:18880',
    // Only for the disposable loopback Caddy installation with its internal CA.
    ignoreHTTPSErrors: process.env.OPENSPORT_TEST_TLS === '1',
    trace: 'retain-on-failure',
    actionTimeout: 12000,
    navigationTimeout: 20000,
    launchOptions: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE } : {},
    ...devices['Desktop Chrome'],
  },
})
