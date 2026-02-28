import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['**/__tests__/**/*.test.ts'],
    fileParallelism: false,
    coverage: {
      provider: 'v8',
      include: [
        'common/repositories/**/*.ts',
        'workers/**/*.ts',
      ],
      exclude: ['**/*.d.ts', '**/__tests__/**'],
    },
    testTimeout: 30000,
    hookTimeout: 30000,
  },
});
