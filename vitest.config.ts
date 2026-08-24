import { configDefaults, defineConfig } from 'vitest/config';

// Two-tier test organization (V2 task-spec C2.5):
//   unit       — pure/deterministic suites; threads + isolate:false for fast
//                inner-loop authoring (`pnpm test:unit`).
//   integration— suites that spawn REAL processes (gates, CLIs, git);
//                forked + isolated workers (`pnpm test:integration`).
// `pnpm test` runs BOTH projects and remains the FULL repository authority;
// FAST verification (fast-impact.mjs → `vitest related`) composes unchanged.
//
// `.claude/**` MUST stay excluded: stale session worktrees contain old copies
// of these very specs; collecting them ran duplicate suites against CURRENT
// scripts (measured 2026-08-23: 60 duplicate tests + false red from a stale
// snapshot).
const excludeStaleWorktrees = [...configDefaults.exclude, '**/.claude/**'];

export default defineConfig({
  test: {
    exclude: excludeStaleWorktrees,
    // NOTE: a generous default budget is required because several suites
    // spawn real subprocesses (spec-verify on a spec copy, git CLIs, nested
    // gate runs) while the FULL suite deliberately overlaps unit +
    // integration work. The old implicit 5s default produced load-dependent
    // false reds (observed 2026-08-23: spec-verify mutation case timed out
    // while a nested gate suite ran). A larger timeout only removes
    // scheduling noise — a hang still fails. It must be set PER PROJECT:
    // Vitest 4 project configs do not inherit root-level `testTimeout`.
    //
    // `hookTimeout` needs the same budget for the same reason: PGlite-based
    // beforeAll hooks boot a real in-process Postgres and apply migrations;
    // when nested gate suites overlap (the gate e2e children run the full
    // suite), init exceeded the implicit 10s hook default and failed
    // whichever spec was slowest to boot (observed 2026-08-24: AC-242,
    // AC-245, AC-247 across three runs). A hung hook still fails — only
    // load-dependent false reds are removed.
    projects: [
      {
        test: {
          name: 'unit',
          include: ['tests/**/*.spec.ts'],
          exclude: ['**/*e2e*.spec.ts', ...excludeStaleWorktrees],
          pool: 'threads',
          isolate: false,
          testTimeout: 30_000,
          hookTimeout: 30_000,
        },
      },
      {
        test: {
          name: 'integration',
          include: ['tests/**/*e2e*.spec.ts'],
          exclude: excludeStaleWorktrees,
          pool: 'forks',
          isolate: true,
          testTimeout: 30_000,
          hookTimeout: 30_000,
        },
      },
    ],
  },
});
