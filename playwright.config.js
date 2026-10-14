import { defineConfig, devices } from '@playwright/test'

export default defineConfig({
  testDir: './tests/browser',
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  workers: 2,
  timeout: 60000,
  expect: { timeout: 15000 },
  reporter: 'list',
  use: { baseURL: 'http://127.0.0.1:4178', trace: 'retain-on-failure', launchOptions: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE } : {} },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'] } },
    { name: 'mobile', use: { ...devices['Pixel 7'] } },
  ],
  webServer: {
    command: 'npm run dev -- --host 127.0.0.1 --port 4178 --strictPort',
    url: 'http://127.0.0.1:4178',
    reuseExistingServer: false,
    env: { VITE_APP_MODE: 'project', VITE_SUPABASE_URL: 'https://demo-must-never-connect.invalid', VITE_SUPABASE_ANON_KEY: 'public-looking-test-key' },
  },
})
