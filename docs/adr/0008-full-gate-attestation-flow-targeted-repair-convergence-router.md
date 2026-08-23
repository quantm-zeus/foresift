# ADR 0008: One exact-head FULL gate, structured manifests, targeted repair, and the deterministic convergence router

- Status: Accepted
- Date: 2026-08-23
- Relates to: [ADR 0006](./0006-throughput-profiles-proven-dedupe-attestation.md) (attestation identity), [ADR 0007](./0007-workflow-variant-selection-and-gate-invocation-repair.md) (OPTIMIZED variant)

## Context

The first-pass OPTIMIZED lane (ADR 0006/0007) verified the same unchanged HEAD
up to three times on the clean path: the gate-router ran a bare
`foresift:gate` (no attestation written), the convergence loop re-ran it
unconditionally, and ci-merge's `wp:full-gate --check` missed (no attestation)
and executed a third FULL run. A failed gate also produced no structured
evidence — repair agents root-caused from a raw log transcript, and every
repair iteration re-ran the entire gate. Finally, convergence always ran,
even when review changed nothing, because nothing machine-checkable said it
could be skipped. Measured baseline: ≥10 non-implementation AI invocations per
package and 3× FULL verification of one identity.

The bundled `archon-review-block` is a packed binary whose internal review
verdicts have no machine-readable artifact (probed via binary strings,
2026-08-23): its verdict cannot be consumed directly.

## Decision

1. **ONE local FULL gate per identity; attestation reuse everywhere.** The
   OPTIMIZED gate-router runs `package-full-gate.mjs --run` (after a `--check`
   probe for resumable runs). PASS writes the exact-head attestation; every
   downstream verification point (repair-loop final full, convergence-loop
   final full, ci-merge step 1) probes `--check` first and re-executes only on
   a miss. A clean package executes exactly ONE local FULL gate.
2. **Structured gate manifests (`foresift/full-gate-result@1`).**
   `foresift:gate --result-file <path>` records every check with label,
   category (`SPEC|FORMAT|LINT|TYPECHECK|TESTS|PACKAGE`), command, status —
   written on success AND failure, including pre-check blocks. The flag is
   opt-in; the LEGACY lane's behavior is untouched. When the runner invokes
   the gate and the manifest is missing after a failure (crash/older binary),
   `wp:full-gate --run` synthesizes a fail-closed record.
3. **TARGETED post-failure verification (`package-targeted-verify.mjs`).** The
   planner maps a single failed category to exactly its own command (TESTS:
   failing files extracted from the gate log when identifiable, else the full
   suite; PACKAGE: the exact recorded commands verbatim). ANY doubt — missing/
   malformed evidence, multiple or unknown categories, a PASS manifest in a
   repair context — escalates to the FULL gate (exit 3). Targeted results are
   persisted (`foresift/targeted-verify@1`) and NEVER merge-authorizing.
4. **Repair/convergence loop bodies become repair → targeted → conditional
   final full.** The FULL gate executes only when targeted evidence is green
   or escalated; a still-red targeted check spends no FULL time and lets the
   bounded loop iterate with fresh structured evidence. Loop bash nodes route
   on PERSISTED verdict files (verified-safe under Archon v0.9.0 semantics),
   not sibling outputs.
5. **Deterministic review-outcome collection + convergence router.** A
   pre-review HEAD snapshot node and a post-review collector
   (`review-outcome-collector.mjs`) compose `foresift/review-verdict@1` from
   GitHub's own review state (`reviewDecision`, unresolved threads via
   GraphQL) plus HEAD stability. The collector never fails the DAG. The router
   (`convergence-router.mjs`) returns CONVERGENCE_NOT_REQUIRED only when ALL
   hold: APPROVED verdict, HEAD unchanged across the review window, an
   exact-head attestation matching the current identity, and deterministic
   implementation completeness. Anything missing/malformed ⇒
   CONVERGENCE_REQUIRED (today's always-run behavior). Skipping convergence is
   the optimization; running it is the default.
6. **Review-verdict provenance honesty.** Because the bundled reviewers emit no
   machine-readable verdict, GitHub's review state is the deterministic proxy.
   Until lanes produce richer structured verdicts, production may still route
   CONVERGENCE_REQUIRED often — accepted cost; the contract degrades safely
   rather than guessing.

## Consequences

- Clean-path FULL executions drop 3→1; repair iterations stop paying FULL-gate
  cost per edit; convergence becomes evidence-driven instead of mandatory.
- The gate gains an opt-in output channel without changing any default
  behavior (LEGACY frozen).
- New artifacts in `$ARTIFACTS_DIR`: `full-gate-result.json`,
  `targeted-verify-result.json`, `.review-head-snapshot.json`,
  `review-verdict.json`, `convergence-decision.json`.
- Regression coverage: `tests/automation/v2-gate-convergence.spec.ts`
  (including two REAL gate executions against this repository — milestone
  green / package red), plus smoke PROOFS 6–8 in `foresift-smoke-throughput`.
