import { configDefaults, defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.spec.ts'],
    // Requieren Docker (instancia PostgreSQL desechable): se ejecutan con `npm run test:desechable`.
    exclude: [...configDefaults.exclude, 'test/desechable/**'],
    globals: true,
    environment: 'node',
    setupFiles: './test/setup.ts',
    coverage: { provider: 'v8', reporter: ['text', 'json-summary'] }
  }
});
