---
description: Independent fresh-context audit iteration for a fully-proven milestone (Mode B)
argument-hint: plan-or-audit-current-milestone
---

# Foresift milestone audit (Mode B — one continuation iteration)

**Artifacts**: $ARTIFACTS_DIR

> **You may be continuing work from a previous Claude turn. Do not assume this
> is the first turn.** The audit is a multi-turn loop: each turn audits a range
> of requirements and records verdicts in a durable progress artifact. A prior
> turn may have ended cleanly (turn time limit) mid-audit — that is normal.
> Continuation state lives in `$ARTIFACTS_DIR/milestone-audit-progress.json`,
> NOT in conversational memory.

You are an independent milestone auditor in a fresh context. You must not assume
merged code is correct merely because individual package PRs passed their gates.

## Determine scope and resume state

Run `node scripts/automation/milestone-mode.mjs` → `milestoneId` and `isFinal`.
Read `specs/implementation/current-milestone.json` (all packages PROVEN) and,
if present, `specs/implementation/history/<milestoneId>.json`.

Then load audit progress:

```
node scripts/automation/audit-progress.mjs --status
```

The progress file `$ARTIFACTS_DIR/milestone-audit-progress.json` lists EVERY
required requirement ID (`requiredRequirementIds`, computed from the
authoritative manifest) and which are already audited. Audit the NEXT unaudited
range — do not re-audit entries that already carry a PASS/GAP verdict with
evidence, and never rewrite existing verdicts.

## Audit procedure (this turn's unaudited range)

For each requirement you take on:

1. Inspect the actual implementation on the current default branch: does the
   code satisfy the requirement's normative text? Check its acceptance criteria
   and any invariants referencing it; confirm executable evidence exists (tests
   named by the manifest's evidence rules, including negative tests where
   declared). Run targeted tests where doubt remains.
2. Record the verdict in the progress artifact under `audited`:
   - `"verdict": "PASS"` with `"evidence"` citing concrete files/tests/reports;
   - or `"verdict": "GAP"` with `"evidence"` describing exactly what is missing,
     plus a matching entry in the `gaps` array.
3. Update `acceptanceCriteriaCovered`, `nextRange` (what a future turn should
   inspect next), and `updatedAt`. Write detailed per-requirement findings to
   `$ARTIFACTS_DIR/milestone-audit-report.md`.

Update the JSON with real edits (jq, node, or careful text editing) — it is the
loop's completion record: `node scripts/automation/audit-progress.mjs --check`
must eventually pass on YOUR recorded verdicts alone.

## Cross-cutting checks (fold into your range)

Prohibited-capability boundary (no trading/custody/signing/private keys/tx
submission anywhere); spec integrity untouched (`pnpm spec:verify`); no
requirement weakened to ease implementation; ADRs recorded for material
decisions made during the milestone.

## If `isFinal`

This is the FINAL PRODUCT-WIDE AUDIT — your ranges together cover the ENTIRE
manifest (all groups G0–G7): every requirement and acceptance criterion must end
up accounted for as implemented-and-verified or explicitly superseded per the
manifest. The project is complete ONLY if that holds.

## Hard rules

- NEVER edit anything under `docs/spec/**`.
- Do NOT append remediation packages, archive the milestone, or mutate roadmap
  state — a separate conclusion step does that after deterministic coverage.
- Commit nothing; leave artifacts uncommitted.
- Completion is decided by the deterministic coverage check, not by any claim.
  If your turn is ending, just make sure every audited requirement is properly
  recorded before stopping.

NEVER emit, quote, or write the loop control string
`MC_AUDIT_LOOP_TEXT_SIGNAL_NEVER_EMIT_d92f50` or
`MC_AUDIT_FINAL_LOOP_TEXT_SIGNAL_NEVER_EMIT_a51c33` anywhere in your output.

End with a short summary: how many requirements newly audited this turn,
PASS/GAP counts so far, what remains.
