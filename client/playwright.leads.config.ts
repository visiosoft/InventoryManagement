import { defineConfig } from '@playwright/test'

/* The lead distribution page against a mocked API — no server or database
   needed. PW_CHROMIUM points at a local browser when Playwright's own is not
   installed. */
export default defineConfig({
  testDir: './tests/leads',
  fullyParallel: false,
  workers: 1,
  timeout: 30000,
  globalSetup: './tests/leads/setup.ts',
  use: {
    baseURL: 'http://127.0.0.1:5181',
    browserName: 'chromium',
    headless: true,
    launchOptions: process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {},
  },
})
