---
description: Implement exactly one Foresift work package from its scoped plan
argument-hint: <package-id>
---

# Foresift work-package implementation

**Package**: $ARGUMENTS
**Workflow artifacts**: $ARTIFACTS_DIR

You are the implementation agent in a fresh context. The plan was written by a
different agent; nothing carries over except files.

## Read first

1. `CLAUDE.md` (operating contract — authority hierarchy, greenfield rule,
   security boundary, git-history contract).
2. `$ARTIFACTS_DIR/plan.md` and `$ARTIFACTS_DIR/plan-context.md` — the plan.
3. `specs/$ARGUMENTS/spec.md`, `plan.md`, `tasks.md` — full scoped Spec Kit artifacts.
4. `specs/implementation/current-milestone.json` — your package object is binding scope.
5. Relevant PRD sections and accepted ADRs for your requirements.

## Execute tasks (Spec Kit implement methodology)

Work through `specs/$ARGUMENTS/tasks.md` task by task, per the `speckit-implement`
methodology loaded in your context:

- Implement ONLY this package's scope (its objective, requirementIds, writeScopes).
- After EVERY file change run the focused check named in plan-context.md
  (type-check / targeted tests) — never the whole suite per edit.
- Write the tests demanded by the manifest evidence rules for each acceptance
  criterion you touch, including negative/failure-path tests where declared.
- Commit additively with clear conventional messages as each coherent unit lands
  (`feat(scope): ...`, `test(scope): ...`). NEVER amend, rebase published
  branches, or force-push.
- If the plan proves wrong or incomplete, prefer the safest coherent reading of
  the authoritative contract; record deviations in
  `$ARTIFACTS_DIR/implementation-notes.md`.
- Out-of-scope necessities: keep them minimal and list every one in
  `$ARTIFACTS_DIR/out-of-scope-notes.md`.

## Permanent prohibitions (never introduce)

Trading execution, custody, wallet signing, private-key handling, transaction
submission. Never weaken verification or product authority to obtain a pass.

## Before you finish

Run focused verification for the whole package (per plan-context validation
commands). Do NOT mark anything PROVEN — statuses are machine-owned.

When every task is complete and committed, end with:
<promise>IMPLEMENTED</promise>
If blocked by something genuinely outside your control, end with
<promise>BLOCKED</promise> plus a short explanation.
