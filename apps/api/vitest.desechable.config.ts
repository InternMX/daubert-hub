import { defineConfig } from 'vitest/config';

// Pruebas de integración del gestor documental contra una instancia PostgreSQL DESECHABLE (contenedor temporal). NO forman parte de `npm test`: se ejecutan con
// `npm run test:desechable` (requiere Docker). Nunca se conectan a daubert_hub_test ni a daubert_global.
export default defineConfig({
  test: {
    include: ['test/desechable/**/*.desechable.spec.ts'],
    globals: true,
    environment: 'node',
    setupFiles: './test/setup.ts',
    globalSetup: './test/desechable/global-setup.ts',
    testTimeout: 60_000,
    hookTimeout: 120_000,
    fileParallelism: false
  }
});
