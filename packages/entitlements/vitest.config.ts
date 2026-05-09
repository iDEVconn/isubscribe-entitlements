import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Default is `node`; React tests opt in to jsdom via `// @vitest-environment jsdom` pragma.
    environment: 'node',
    setupFiles: ['./test/setup.ts'],
    globals: false,
    include: ['test/**/*.test.ts', 'test/**/*.test.tsx'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov', 'html'],
      include: ['src/**/*.ts', 'src/**/*.tsx'],
      exclude: ['src/**/index.ts', 'src/**/*.d.ts'],
      thresholds: {
        lines: 80,
        statements: 80,
        functions: 75,
        branches: 70
      }
    }
  }
});
