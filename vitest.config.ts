import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

// Nest resolves constructor dependencies from decorator metadata, which tsc emits and
// Vite's default transform does not.
const nestTransform = {
  oxc: { decorator: { legacy: true, emitDecoratorMetadata: true } },
} as const;

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: 'shared',
          root: './packages/shared',
          include: ['src/**/*.test.ts'],
          environment: 'node',
        },
      },
      {
        ...nestTransform,
        test: {
          name: 'api-unit',
          root: './apps/api',
          include: ['src/**/*.test.ts', 'eval/**/*.test.ts'],
          environment: 'node',
        },
      },
      {
        ...nestTransform,
        test: {
          name: 'api-int',
          root: './apps/api',
          include: ['test/**/*.int.test.ts'],
          environment: 'node',
          globalSetup: ['./test/support/global-setup.ts'],
          testTimeout: 30_000,
          hookTimeout: 120_000,
        },
      },
      {
        // Manual, real API key, costs money: `pnpm eval:llm`. Not in `pnpm test` or CI.
        ...nestTransform,
        test: {
          name: 'api-eval',
          root: './apps/api',
          include: ['eval/**/*.eval.ts'],
          environment: 'node',
          testTimeout: 300_000,
        },
      },
      {
        resolve: {
          alias: { '@': fileURLToPath(new URL('./apps/web', import.meta.url)) },
        },
        test: {
          name: 'web',
          root: './apps/web',
          include: ['**/*.test.{ts,tsx}'],
          exclude: ['node_modules/**', '.next/**'],
          // Node by default; a test that needs the DOM opts in with `// @vitest-environment jsdom`.
          environment: 'node',
        },
      },
    ],
  },
});
