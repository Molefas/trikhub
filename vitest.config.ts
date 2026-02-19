import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/js/**/*.test.ts', 'tests/e2e/**/*.e2e.test.ts'],
    // E2E tests need longer timeouts for network operations
    testTimeout: 120000, // 2 minutes
    hookTimeout: 60000,  // 1 minute for setup/teardown
  },
});
