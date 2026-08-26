import { defineConfig } from 'vitest/config';

// Package-local runner config for `pnpm --filter @foresift/providers test`
// (plan material decision 10) — same arrangement as every proven sibling
// package; timeouts mirror the root per-project budgets. No suite in this
// package performs network access: transport is always an injected FetchPort
// served from recorded fixtures.
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
