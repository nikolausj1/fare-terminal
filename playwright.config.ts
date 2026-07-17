import { defineConfig, devices } from '@playwright/test';

// Chromium-only, against the dev server (DB is expected to already exist —
// see README quickstart / `npm run db:setup && npm run seed && npm run
// pipeline`). fullyParallel + a handful of workers keeps the whole suite
// (8 spec files, PRD §34.3) comfortably under ~4 minutes locally; CI runs
// serially (workers: 1) for determinism against the single shared dev
// server + SQLite file.
export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: 'list',
  timeout: 30_000,
  use: {
    baseURL: 'http://localhost:3111',
    trace: 'retain-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: {
    command: 'npm run dev -- --port 3111',
    url: 'http://localhost:3111',
    reuseExistingServer: !process.env.CI,
    // Turbopack cold start + first-route compile can take a few seconds
    // beyond Playwright's 60s default when the DB file is already present
    // but no route has been compiled yet; give it real headroom rather
    // than flaking on a slow first run.
    timeout: 120_000,
  },
});
