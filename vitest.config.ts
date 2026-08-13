import path from 'node:path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/unit/**/*.test.ts', 'tests/integration/**/*.test.ts'],
    environment: 'node',
    // Forces DATABASE_PATH to a temp file so no test can create/modify the
    // repo's real DB paths as an import side effect — see the setup file's
    // comment for the CI outage this prevents.
    setupFiles: ['tests/vitest.setup.ts'],
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, '.'),
    },
  },
});
