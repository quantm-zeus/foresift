import { defineConfig } from 'vitest/config';

// Package-local runner config for `pnpm --filter @foresift/providers test`.
// Mirrors the proven sibling arrangement so the milestone-declared
// per-package verification command collects this package's colocated `test/`
// suites. No suite here performs network access: every transport is an
// injected fixture FetchPort. Timeouts mirror the root per-project budgets.
export default defineConfig({
  test: {
    include: ['test/**/*.spec.ts'],
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
