import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import { defineConfig, globalIgnores } from 'eslint/config'

export default defineConfig([
  globalIgnores(['dist', '.context', '.opensport', 'deploy/upstream', 'desktop/resources', 'desktop/dist', 'desktop/out', 'playwright-report', 'test-results']),
  {
    files: ['**/*.{js,jsx}'],
    extends: [
      js.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
      parserOptions: {
        ecmaVersion: 'latest',
        ecmaFeatures: { jsx: true },
        sourceType: 'module',
      },
    },
    rules: {
      'no-unused-vars': ['error', { varsIgnorePattern: '^[A-Z_]' }],
    },
  },
  {
    files: ['scripts/**/*.mjs', 'desktop/**/*.{mjs,cjs}', 'tests/**/*.{js,mjs}', 'supabase/tests/**/*.mjs', 'supabase/functions/**/*.js', 'api/**/*.js', 'server/**/*.js', 'playwright.config.js', 'vite.config.js'],
    languageOptions: { globals: { ...globals.node, ...globals.browser } },
    rules: { ...js.configs.recommended.rules },
  },
])
