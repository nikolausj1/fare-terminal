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
    // Production server, not `next dev`: a cold Turbopack dev compile was
    // measured at ~100s on this machine, which flakes the 120s startup
    // budget under any load, while `next start` boots in about a second and
    // exercises the same server path production runs (including the
    // finalized read-only-capable DB). PREREQUISITE: `npm run build` must
    // have run first — the standard gate order (typecheck, lint, test,
    // build, test:e2e) and the CI job both guarantee this; if you run
    // test:e2e standalone after changing app code, build first.
    command: 'npm run start -- --port 3111',
    url: 'http://localhost:3111',
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
