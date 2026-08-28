// bare-bun-test-guard.mjs — bunfig [test] preload. Advisory only; never fails
// a run.
//
// WHY THIS EXISTS (kernel OOM observed 2026-08-28): a bare `bun test` over the
// full tree runs every file in ONE process with no `--isolate` and defaults to
// `--max-concurrency=20`. The DATABASE_PGLITE suites create PGlite (WASM
// Postgres) instances that accumulate across files in that single process —
// measured 5.07 GiB peak for the first 10 PGlite files and >9 GiB before file
// 25 — so a full-tree bare run exceeds a 15 GiB host and the kernel OOM-kills
// bun. The sanctioned path (bun-test-coordinator.mjs) runs groups with
// --isolate + bounded concurrency and peaks at ~3.3 GiB per group.
//
// The coordinator sets FORESIFT_TEST_COORDINATOR=1; any other bun test run
// (targeted suites, --watch) gets a single one-line advisory per process.
if (process.env.FORESIFT_TEST_COORDINATOR !== '1') {
  const FLAG = '__foresiftBareBunTestWarned';
  if (!globalThis[FLAG]) {
    globalThis[FLAG] = true;
    console.warn(
      '[foresift] advisory: bun test without the coordinator (no isolation) — full-tree runs accumulate PGlite memory and can OOM. Use `pnpm test:all` or the per-workload scripts for the complete suite.',
    );
  }
}
