import { defineConfig } from '@playwright/test'

/* Pages tested against a mocked API — lead distribution and the dashboard's
   Customize — no server or database needed. PW_CHROMIUM points at a local browser when Playwright's own is not
   installed. */
export default defineConfig({
  testDir: './tests',
  testIgnore: '**/warehouse/**',
  fullyParallel: false,
  workers: 1,
  timeout: 30000,
  globalSetup: './tests/ui-setup.ts',
  use: {
    baseURL: 'http://127.0.0.1:5181',
    browserName: 'chromium',
    headless: true,
    launchOptions: process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {},
  },
})
