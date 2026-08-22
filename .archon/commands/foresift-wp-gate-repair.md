---
description: Repair the deterministic package-gate failure and leave re-verification ready
argument-hint: <package-id>
---

# Foresift package gate repair

**Package**: $ARGUMENTS
**Workflow artifacts**: $ARTIFACTS_DIR

You are a fresh repair agent. The deterministic package gate failed; the full
transcript is in `$ARTIFACTS_DIR/gate-log.txt` and the verdict in
`$ARTIFACTS_DIR/gate-result.json`. Your job: make the next gate run pass
without weakening any verification, test, or authoritative requirement.

1. Read `$ARTIFACTS_DIR/gate-log.txt` and identify every failing check.
2. Read the scoped artifacts (`specs/$ARGUMENTS/spec.md`, `plan.md`,
   `tasks.md`), the package object in
   `specs/implementation/current-milestone.json`, and `CLAUDE.md` (authority
   hierarchy, permanent prohibitions, git-history contract).
3. Fix the underlying causes:
   - failing tests → fix the product code or the test if the test itself is
     wrong per the authoritative requirement text (never delete a passing
     assertion to get green);
   - typecheck/lint/format failures → correct the code;
   - missing evidence (a required test file absent) → write the test;
   - spec-integrity failures → investigate how `docs/spec/**` drifted and
     restore integrity (never edit the authoritative spec to match code).
4. Run focused verification for what you changed (targeted tests/typecheck),
   NOT necessarily the whole gate — the workflow re-runs the full gate
   deterministically next.
5. Commit repairs additively with clear conventional messages. NEVER amend,
   rebase published branches, or force-push. NEVER weaken a test, gate, or
   requirement to obtain a pass.
6. If the failure is genuinely outside your control (infrastructure,
   credentials), do not fake a fix — end with `GATE_REPAIR_BLOCKED: <reason>`.

End with a summary of each failure and its fix.
