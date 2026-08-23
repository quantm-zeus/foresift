---
description: Repair the deterministic package-gate failure and leave re-verification ready
argument-hint: <package-id>
---

# Foresift package gate repair

**Package**: $ARGUMENTS
**Workflow artifacts**: $ARTIFACTS_DIR

You are a fresh repair agent. The deterministic package gate failed; your job:
make the next gate run pass without weakening any verification, test, or
authoritative requirement.

The workflow gives you machine-readable evidence (V2 task spec §9/§10):

- `$ARTIFACTS_DIR/full-gate-result.json` — structured per-check manifest
  (`checks[]` with label, category SPEC|FORMAT|LINT|TYPECHECK|TESTS|PACKAGE,
  command, status; `failedCategories`; `exitCode`). This is the authority on
  WHAT failed — read it FIRST.
- `$ARTIFACTS_DIR/targeted-verify-result.json` — if a previous repair
  iteration already ran, this shows which targeted re-checks were still red.
- `$ARTIFACTS_DIR/gate-log.txt` — full transcript for root-causing.

1. Read the structured manifest first, then the failing sections of
   `$ARTIFACTS_DIR/gate-log.txt`.
2. Read the scoped artifacts (`specs/$ARGUMENTS/spec.md`, `plan.md`,
   `tasks.md`), the package object in
   `specs/implementation/current-milestone.json`, and `CLAUDE.md` (authority
   hierarchy, permanent prohibitions, git-history contract).
3. Fix the underlying causes of exactly what the manifest flags:
   - failing tests → fix the product code or the test if the test itself is
     wrong per the authoritative requirement text (never delete a passing
     assertion to get green);
   - typecheck/lint/format failures → correct the code;
   - missing evidence (a required test file absent) → write the test;
   - spec-integrity failures → investigate how `docs/spec/**` drifted and
     restore integrity (never edit the authoritative spec to match code).
4. Run focused verification for what you changed (targeted tests/typecheck),
   NOT necessarily the whole gate — after your turn the workflow re-verifies
   ONLY your failed category deterministically, and re-runs the FULL gate once
   when that is green. Do not stack new changes while a targeted check you
   can run locally is still red.
5. Commit repairs additively with clear conventional messages. NEVER amend,
   rebase published branches, or force-push. NEVER weaken a test, gate, or
   requirement to obtain a pass.
6. If the failure is genuinely outside your control (infrastructure,
   credentials), do not fake a fix — end with `GATE_REPAIR_BLOCKED: <reason>`.

End with a summary of each failure and its fix.
