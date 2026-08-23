# PR B2 evidence — workflow integration (OPTIMIZED variant, invocation repair, runtime smoke)

Implements task-spec §9–§11 (workflow/commands carry the throughput lane),
§22 (install avoidance), §23 (Archon semantics validated + smoke), §25 items
24–27 (selftest S17, smoke workflow). Design decisions in
[ADR 0007](../docs/adr/0007-workflow-variant-selection-and-gate-invocation-repair.md).

## What lands

| Change                               | File                                                                          | Why                                                                                                                                                                                                                          |
| ------------------------------------ | ----------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| OPTIMIZED workflow variant           | `.archon/workflows/foresift/foresift-work-package-optimized.yaml`             | byte-identical proven DAG; only `implement-iterate` → `foresift-wp-implement-optimized` and `ci-merge` → `foresift-wp-ci-merge-optimized`                                                                                    |
| Slice/checkpoint/FAST implement body | `.archon/commands/foresift-wp-implement-optimized.md`                         | checkpoint-first iteration start (validate before reading), bounded 8–12 task slices, FAST verify per slice boundary (never per file), checkpoint persisted at each boundary                                                 |
| Deterministic landing body           | `.archon/commands/foresift-wp-ci-merge-optimized.md`                          | `wp:full-gate --check` reuse else `--run`, then ONE `wp:land` command does push → PR → exact-head CI → drift guard → squash merge; bounded red-CI repair; billing fallback scoped to `no-check-runs` + documented annotation |
| Profile-based selection              | `scripts/automation/foresift-autopilot.mjs`                                   | `workPackageWorkflow()` picks the variant for launches AND stranded-run adoption; tracked entries record the actual workflow name (recovery identity stays exact)                                                            |
| Gate invocation repair               | gate parser + all call sites (both workflows, 2 commands, docs, usage string) | `pnpm foresift:gate -- --package X` provably exited 2 (pnpm forwards bare `--` to the script); parser now tolerates `--`, all sites canonicalized to `--package`/`--milestone`                                               |
| Runtime smoke                        | `.archon/workflows/foresift/foresift-smoke-throughput.yaml`                   | bash-only: checkpoint build→valid→tamper→guard-fails→auto-iteration→rebuild→guard-passes; full-gate `--check` fails closed with no attestation; dedupe classifier runs fail-closed                                           |

## Latent defect found and fixed (correctness, not optimization)

While copying the shared YAML for the variant, `pnpm foresift:gate -- --package
<id>` was verified to exit 2 — pnpm passes the bare `--` separator through to
the npm script, which the gate read as an unexpected positional. The shared
workflow's gate-router/gate-rerun/gate-iter nodes used exactly this form, so
EVERY future package's gate phase would have failed once and burned its 4
repair iterations. No run had reached those nodes yet (G0 is still mid-plan),
so it was latent. Fixed at the source (tolerant parser) AND at every call site;
for LEGACY this restores intended behavior — it changes nothing about what the
gate verifies.

## Archon semantics: validated, never guessed

- `archon validate workflows`: 27 valid, 0 errors (both new workflows `ok`;
  the 2 warnings are pre-existing bundled archon workflows).
- `archon validate commands`: 52 valid, 0 errors.
- DAG topology of the variant is byte-identical to the original except two
  command names — no new loop/when/guard semantics are introduced, so the
  empirically verified v0.9 loop rules (ADR 0004) carry over unchanged.
- `foresift-smoke-throughput` runs WITHOUT provider spend and must be executed
  post-merge as part of §28 activation (recorded below).

## Selftest

`pnpm autopilot:selftest` → **PASS=106 FAIL=0**, including new S17:

- LEGACY fixture (`g0-contracts-data-truth`) launches `foresift-work-package`
  (original);
- OPTIMIZED fixture launches `foresift-work-package-optimized`;
- the stranded-run adoption path searches the profile-correct workflow name.

Two pre-existing assertions that hardcoded the legacy workflow name for
OPTIMIZED fixture packages were updated to the new expectation (the behaviors
they assert — recovery identity retention and re-adoption — are unchanged).

## Post-merge activation record (§28)

Filled after merge on the main checkout:

- [ ] main pulled to the merge commit on the product checkout
- [ ] `pnpm autopilot:selftest` green on main checkout
- [ ] smoke run: `archon workflow run foresift-smoke-throughput --detach …`
      completed; all four PROOF lines present in its log
- [ ] `pnpm autopilot:status` shows g0-contracts-data-truth profile=LEGACY and
      every other package profile=OPTIMIZED
- [ ] NO manual launch of g0-security-perimeter (its turn comes from the
      supervisor when G0 finishes)
