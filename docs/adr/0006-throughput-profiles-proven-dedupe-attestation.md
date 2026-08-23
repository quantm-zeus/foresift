# ADR 0006: Throughput profiles, proven-only verification dedupe, and exact-head FULL-gate attestation

- Status: Accepted
- Date: 2026-08-23
- Deciders: Foresift autonomous optimizer work stream (task spec `work-package-throughput-optimization`)
- Supersedes: none
- Relates to: [ADR 0005](./0005-provider-quota-recovery-policy.md) (recovery policy — untouched by this ADR)

## Context

The autonomous pipeline spends most wall-clock time re-verifying already-verified
facts: every work-package turn reruns the whole repository suite after every file
change, CI runs the aggregate verify twice, per-package milestone checks re-execute
tests the root suite just ran, and any process restart discards implementation
context that could have been durably cached. The throughput task authorizes
optimizations ONLY under hard constraints:

- the running logical G0 package (`g0-contracts-data-truth`) must keep its exact
  behavioral implementation profile;
- no optimization may weaken verification or authorize a merge without the FULL
  gate and exact-head CI;
- nothing may be assumed duplicated — dedupe requires proof;
- Archon v0.9 semantics are never guessed; new runtime behavior requires smoke
  workflows before activation.

## Decision

### 1. Deterministic LEGACY/OPTIMIZED profile (`work-package-throughput-profile.mjs`)

A pure function maps package id → profile:

- `g0-contracts-data-truth` → **LEGACY** (forever);
- every other package → **OPTIMIZED**.

The mechanism is explicit code, not orchestrator snapshot behavior, and there is
no second orchestrator: callers (gate, status) branch on the function's result.
`autopilot:status` prints each package's profile so the lane assignment is always
operator-visible.

### 2. Durable implementation checkpoints (`package-checkpoint.mjs`)

`implementation-checkpoint.json` in a run's artifacts dir caches _context_
(completed Spec Kit tasks, current slice, files touched, targeted checks,
references). It is CACHE/INDEX only: completion authority stays with
package-implement-complete.mjs, verification authority stays with the gate. Every
cached source file rides in the record as a sha256 hash; HEAD is recorded. A
fresh implementation turn may trust the checkpoint only if schema, packageId,
HEAD, and ALL source hashes still validate — any mismatch means "absent"
(rebuild context from authoritative sources).

### 3. FAST/FULL verification tiers

- **FAST** (`package-fast-verify.mjs`): spec:verify + ESLint + `vitest related`
  over explicitly declared touched files. Never writes an attestation, never
  authorizes a merge. Fail-closed: with no usable touched source files it
  escalates to the full test suite rather than guessing scope.
- **FULL** (`package-full-gate.mjs`): `foresift:gate --package <id>` (spec
  integrity + repository verification + unique package checks). Only a FULL run
  persists `full-gate-attestation.json`.

### 4. Exact-head FULL-gate attestation

An attestation record carries the complete identity of its execution: HEAD sha,
packageId, risk, profile, pnpm-lock hash, authority hashes (PRD manifest,
current-milestone, roadmap), gate-code hashes (gate/schema/runner), and
toolchain versions. `--check` re-derives the CURRENT identity and permits reuse
only when every field matches — a one-line commit, dependency bump, toolchain
upgrade, risk change, or gate edit invalidates prior evidence. Reuse is
deterministic evidence ("this exact identity already passed"), not test skipping.
Negative tests prove each single-field mutation is reported.

### 5. Proven-only verification dedupe (`verify-dedupe.mjs`, gate integration)

For OPTIMIZED packages the gate skips a milestone `verificationCommand` only when
the classifier PROVES it duplicates the root `vitest run` that already executed:
exact known command shape, package `test` script exactly `vitest run`, NO local
vitest config, and enumerated default-include test files. The prohibited-
capabilities scan is always unique-mandatory. Anything unproven executes
unchanged. For LEGACY packages the gate path is behaviorally frozen (dedupe
disabled).

### 6. Deterministic mechanical landing (`package-land.mjs`) + CI dedupe

PR creation/discovery, exact-head CI wait, and squash merge are scripted, not
agent-waited: clean-tree refusal → idempotent push → discover-or-create PR →
pin local HEAD → poll check-runs AT THAT SHA → red CI exits nonzero (never
bypassed; repair is forward commits) → zero-check-runs diagnoses the
squash-base/merge-ref conflict fast → pre-merge drift guard re-confirms origin
HEAD == pinned HEAD → squash merge. GitHub CI keeps its named steps and check
name but drops the duplicate aggregate `pnpm verify` step (each check then runs
exactly once) and cancels superseded pushes via `concurrency.cancel-in-progress`.

## Consequences

- Verification effort scales with what actually changed instead of with
  repository size, while the merge gate remains FULL + exact-head CI.
- The G0 legacy package is structurally protected: its gate path cannot change
  without editing the LEGACY guard itself.
- Attestation reuse across sessions/processes becomes safe because identity is
  content-addressed, not time-based.
- Risk levels stay HIGH until proven otherwise (no MEDIUM downgrade was needed
  for these mechanics; all changes are control-plane only).

## Verification

- `tests/automation/throughput.spec.ts` §11–17: positive+negative tests for
  profile determinism, checkpoint invalidation, attestation drift, FAST file
  selection fail-closed, dedupe proof chain (config/wrapper/unknown shapes).
- Live hermetic cycle: failing gate writes NO attestation; stubbed-passing gate
  writes one; `--check` accepts at pinned head, rejects after head move and for
  a different package (evidence: `.optimizer-evidence/prB1-control-plane.md`).
- Supervisor selftest 103/103 unchanged; `pnpm verify` green at pushed HEAD.
