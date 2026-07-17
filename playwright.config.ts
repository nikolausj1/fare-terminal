import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  use: {
    baseURL: 'http://localhost:3111',
  },
  webServer: {
    command: 'npm run dev -- --port 3111',
    url: 'http://localhost:3111',
    reuseExistingServer: !process.env.CI,
  },
});
