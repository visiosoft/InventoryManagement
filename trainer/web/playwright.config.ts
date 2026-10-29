import { defineConfig } from '@playwright/test'

/* The website against a mocked API — no server or database needed.
   PW_CHROMIUM points at a local browser when Playwright's own is not installed. */
export default defineConfig({
  testDir: './tests',
  workers: 1,
  timeout: 30000,
  use: {
    baseURL: 'http://127.0.0.1:5182',
    browserName: 'chromium',
    headless: true,
    launchOptions: process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {},
  },
  webServer: { command: 'npx vite --port 5182 --strictPort --host 127.0.0.1', url: 'http://127.0.0.1:5182', reuseExistingServer: true, timeout: 60000 },
})
