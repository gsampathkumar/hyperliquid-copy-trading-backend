import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  resolve: {
    alias: {
      '@hyperliquid-api/main': path.resolve(__dirname, 'libs/main/src'),
    },
  },
  test: {
    globals: true,
    environment: 'node',
    include: ['**/__tests__/**/*.test.ts', '**/*.spec.ts'],
    exclude: ['**/node_modules/**', '**/dist/**'],
    coverage: {
      provider: 'v8',
      include: ['libs/main/src/**/*.ts'],
      exclude: ['**/*.d.ts', '**/__tests__/**', '**/*.module.ts', '**/index.ts'],
    },
    testTimeout: 30000,
    hookTimeout: 30000,
  },
});
