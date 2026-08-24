import { defineConfig } from 'vitest/config';

// Package-local runner config for `pnpm --filter @foresift/tenant-isolation
// test` — same arrangement as the proven sibling packages (root vitest
// projects cover only `tests/**`; this keeps the milestone-declared
// per-package verification command self-contained). Timeouts mirror the root
// per-project budgets.
export default defineConfig({
  test: {
    include: ['test/**/*.spec.ts'],
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
