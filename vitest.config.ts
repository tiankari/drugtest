import { defineConfig } from 'vitest/config';

// Node unit tests. Browser-only checks live in tests/browser (vitest.browser.config.ts).
export default defineConfig({
  test: {
    include: ['tests/unit/**/*.test.ts'],
    environment: 'node',
  },
});
