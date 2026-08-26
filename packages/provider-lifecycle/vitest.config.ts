import { defineConfig } from 'vitest/config';

// Package-local runner config for `pnpm --filter @foresift/provider-lifecycle
// test` (plan material decision 10). Mirrors the proven sibling arrangement:
// the repository-root vitest config's `packages` project collects this tree
// for the full run, while this file keeps the milestone-declared per-package
// verification command self-contained over colocated `test/` suites —
// including PGlite-backed suites whose hooks apply the full migration set.
// Timeouts mirror the root per-project budgets.
export default defineConfig({
  test: {
    include: ['test/**/*.spec.ts'],
    // Scaffold stage tolerates an empty suite; every landed unit replaces
    // this with real colocated coverage.
    passWithNoTests: true,
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
