import { defineConfig } from 'vitest/config';

// Package-local runner config for `pnpm --filter @foresift/tool-core test`.
// The repository-root vitest config's projects include only the root-level
// `tests/**` tree, so a package-cwd `vitest run` resolves the root config
// upward and collects nothing ("No test files found"). This file keeps the
// milestone-declared per-package verification command self-contained over
// this package's colocated `test/` suites — including PGlite-backed suites
// whose hooks apply the full migration set. Timeouts mirror the root
// per-project budgets.
export default defineConfig({
  test: {
    include: ['test/**/*.spec.ts'],
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
