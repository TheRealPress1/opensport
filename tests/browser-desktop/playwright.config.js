import { defineConfig } from '@playwright/test'
import { fileURLToPath } from 'node:url'

export default defineConfig({
  testDir: '.',
  testMatch: '*.spec.js',
  fullyParallel: false,
  workers: 1,
  timeout: 30000,
  expect: { timeout: 10000 },
  reporter: 'list',
  outputDir: '../../test-results/desktop-ui',
  use: {
    baseURL: 'http://127.0.0.1:18921',
    viewport: { width: 1100, height: 810 },
    trace: 'retain-on-failure',
    launchOptions: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE } : {},
  },
  webServer: {
    cwd: fileURLToPath(new URL('../../', import.meta.url)),
    command: 'npx vite --config tests/browser-desktop/vite.config.js --host 127.0.0.1 --port 18921 --strictPort',
    url: 'http://127.0.0.1:18921',
    reuseExistingServer: false,
    env: { VITE_APP_MODE: 'desktop', VITE_SUPABASE_URL: 'https://desktop-must-not-connect.invalid', VITE_SUPABASE_ANON_KEY: 'test-only-public-key' },
  },
})
