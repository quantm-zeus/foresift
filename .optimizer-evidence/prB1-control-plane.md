# PR B1 evidence — throughput control plane (profiles, checkpoints, tiers, attestation, dedupe, landing)

Implements task-spec §8 (profiles), §12 (checkpoints), §13–§15 (FAST/FULL +
attestation), §16–§17 (proven-only dedupe), §18–§21 (deterministic landing +
CI dedupe), §25 items 11–23 (regression tests). Design decisions recorded in
[ADR 0006](../docs/adr/0006-throughput-profiles-proven-dedupe-attestation.md).

## New deterministic mechanisms (all fail-closed)

| Mechanism                | File                                                     | Proof                                                                                                                 |
| ------------------------ | -------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| LEGACY/OPTIMIZED profile | `scripts/automation/work-package-throughput-profile.mjs` | unit tests §11–12; `autopilot:status` prints `profile=` per package                                                   |
| Durable checkpoint       | `scripts/automation/package-checkpoint.mjs`              | build/validate CLI round-trip; tamper → INVALID with reasons (live smoke)                                             |
| FAST tier                | `scripts/automation/package-fast-verify.mjs`             | `selectFiles` unit tests; empty selection ⇒ escalate to full suite (fail-closed)                                      |
| FULL gate + attestation  | `scripts/automation/package-full-gate.mjs`               | live hermetic cycle below                                                                                             |
| Dedupe classifier        | `scripts/automation/verify-dedupe.mjs`                   | positive + 5 negative unit tests; real-milestone report fail-closed UNIQUE                                            |
| Deterministic landing    | `scripts/automation/package-land.mjs`                    | dogfooded to land this very PR (trace in PR body)                                                                     |
| Gate dedupe integration  | `scripts/automation/foresift-gate.mjs`                   | LEGACY path frozen (guard), OPTIMIZED skips only PROVEN duplicates                                                    |
| CI dedupe                | `.github/workflows/ci.yml`                               | duplicate aggregate `pnpm verify` step removed; named steps + check name kept; `concurrency.cancel-in-progress` added |
| Status observability     | `scripts/automation/foresift-autopilot.mjs`              | profile per package; checkpoint slice/tasks for OPTIMIZED runs, INVALID labeling                                      |

## §15 attestation — live hermetic cycle (2026-08-23)

1. **Negative, live**: `package-full-gate.mjs --run` against this worktree —
   gate legitimately red here (G0's workspace packages exist only on the
   product branch) → exit 1, `attestation-exists=NO`. A failing gate never
   writes evidence.
2. **Positive, hermetic**: temp git repo + stub `pnpm` (exit 0) →
   `--run` writes `full-gate-attestation.json` for head `2ec9a6e2e7…`;
   `--check` at the same head → `{"valid":true,…}`.
3. **Invalidation**: new empty commit (HEAD moved) → `--check` →
   `{"valid":false,"reasons":["changed: headSha"]}` exit 1. Different packageId
   → `changed: headSha,changed: packageId`.

Identity covers: headSha, packageId, risk, profile, pnpm-lock hash, PRD
manifest + current-milestone + roadmap hashes, gate/schema/runner code hashes,
toolchain versions. Any single-field mutation is reported (unit-tested).

## Dedupe — proof chain, never assumption

`verify-dedupe.mjs` over the real milestone: every per-package filtered test
command classifies UNIQUE_MANDATORY today because those workspace dirs do not
exist on `main` (they land with G0's PR) — absence of proof is proof of
uniqueness, exactly the fail-closed direction. The prohibited-capabilities scan
is hard-coded UNIQUE_MANDATORY. In a product worktree where a package exists
with a plain `vitest run` script and no local vitest config, the same command
classifies DUPLICATE_COVERED_BY_FULL_SUITE (unit-tested both ways).

## Test results at this branch

- `pnpm test` 59/59 (39 pre-existing + 20 new §25 items 11–23)
- `pnpm autopilot:selftest` 103/103
- `pnpm verify` (spec:verify, format:check, lint, typecheck, test) — green

## Explicit non-goals honored

- No MEDIUM risk downgrade requested; control-plane only, no product code.
- LEGACY gate path behaviorally frozen behind the profile guard.
- FAST tier cannot write attestations (no code path exists) and its result
  JSON hard-codes `mergeAuthorized: false`.
- No Archon workflow changes in this PR (PR B2 owns workflow/command YAML and
  its smoke workflows).
