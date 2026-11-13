import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api': {
        target: 'http://localhost:3000'
      }
    }
  },
  test: {
    // Las pruebas no dependen de .env.local: el gestor documental está APAGADO salvo que una prueba lo active explícitamente.
    env: { VITE_MANUFACTURING_DOCUMENTS: 'false' },
    environment: 'jsdom',
    setupFiles: './src/test/setup.ts',
    coverage: { provider: 'v8', reporter: ['text', 'json-summary'] }
  }
});
