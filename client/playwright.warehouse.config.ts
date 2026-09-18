import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './tests/warehouse',
  fullyParallel: false,
  workers: 1,
  timeout: 30000,
  globalSetup: './tests/warehouse/setup.ts',
  use: { baseURL: 'http://127.0.0.1:5179', browserName: 'chromium', channel: process.platform === 'win32' ? 'msedge' : undefined, headless: true },
})
