import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.spec.ts'],
    globals: true,
    environment: 'node',
    setupFiles: './test/setup.ts',
    coverage: { provider: 'v8', reporter: ['text', 'json-summary'] }
  }
});
