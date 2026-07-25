import { defineConfig, devices } from '@playwright/test';

/**
 * Runs against the built app by default, because three route-crashing bugs
 * reached production while `npm run build` stayed green — the compiler cannot
 * see a temporal dead zone, an unregistered Chart.js scale, or an RPC that
 * does not exist. Point BASE_URL at the deployed site to smoke a real deploy.
 */
const BASE_URL = process.env.BASE_URL || 'http://localhost:4173';

export default defineConfig({
  testDir: './e2e',
  timeout: 45_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  reporter: process.env.CI ? 'line' : [['list']],
  use: {
    baseURL: BASE_URL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: process.env.BASE_URL
    ? undefined
    : {
        command: 'npm run build && npm run preview -- --port 4173',
        url: BASE_URL,
        reuseExistingServer: true,
        timeout: 180_000,
      },
});
