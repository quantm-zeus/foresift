import { defineConfig } from 'vitest/config';

// Package-local runner config for `pnpm --filter @foresift/persistence test`.
// The repository-root vitest config's two-tier projects include only the
// root-level `tests/**` tree, so a package-cwd `vitest run` resolves the root
// config upward and collects nothing ("No test files found"). This file keeps
// the milestone-declared per-package verification command self-contained over
// this package's colocated `test/` suites — including the PGlite-backed
// suites whose beforeAll hooks boot a real in-process Postgres and apply
// migrations. Timeouts mirror the root per-project budgets (a hung hook still
// fails; only load-dependent false reds are removed).
export default defineConfig({
  test: {
    include: ['test/**/*.spec.ts'],
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
