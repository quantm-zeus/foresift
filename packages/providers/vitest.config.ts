import { defineConfig } from 'vitest/config';

// Package-local runner config for `pnpm --filter @foresift/providers test`.
// Same arrangement as every proven sibling package: a package-cwd `vitest
// run` would otherwise resolve the root config upward and collect nothing.
// Timeouts mirror the root per-project budgets.
export default defineConfig({
  test: {
    include: ['test/**/*.spec.ts'],
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
