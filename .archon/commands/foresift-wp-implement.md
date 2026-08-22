---
description: Implement exactly one Foresift work package from its scoped plan
argument-hint: <package-id>
---

# Foresift work-package implementation (one continuation iteration)

**Package**: $ARGUMENTS
**Workflow artifacts**: $ARTIFACTS_DIR

> **You may be continuing work from a previous Claude turn. Do not assume this
> is the first turn.** Implementation is a multi-turn loop: a prior turn may
> have ended cleanly (turn time limit) with tasks remaining — that is normal
> and expected, NOT a failure. Continuation state lives on disk/git, NOT in
> conversational memory.

You are the implementation agent in a fresh context. The plan was written by a
different agent; nothing carries over except files.

## Start of every iteration

Inspect current state before writing anything:

1. `git status` and `git diff` — useful uncommitted work from an earlier turn
   MUST be inspected and continued, never reset or discarded.
2. `git log --oneline -20` — committed units must not be repeated.
3. `specs/$ARGUMENTS/tasks.md` — find the first unfinished task(s).
4. `$ARTIFACTS_DIR/implement-completeness.json` and
   `$ARTIFACTS_DIR/implementation-notes.md`, if present (prior guard output /
   notes).
5. Current implementation state of the files your next tasks touch.

Rules: completed work must not be reimplemented; committed work must not be
repeated; partial changes are continued to coherence; the working tree may hold
uncommitted partials when your turn ends — persistence beats cleanliness.

## Read first

1. `CLAUDE.md` (operating contract — authority hierarchy, greenfield rule,
   security boundary, git-history contract).
2. `.specify/memory/constitution.md` (project constitution).
3. `$ARTIFACTS_DIR/plan.md` and `$ARTIFACTS_DIR/plan-context.md` — the plan.
4. `specs/$ARGUMENTS/spec.md`, `plan.md`, `tasks.md` — full scoped Spec Kit artifacts.
5. `specs/implementation/current-milestone.json` — your package object is binding scope.
6. Relevant PRD sections and accepted ADRs for your requirements.

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
- When a task is done AND its focused verification passes, mark it complete in
  `specs/$ARGUMENTS/tasks.md` (`- [x]`) — that file is the loop's progress
  record; the deterministic guard reads it.
- If the plan proves wrong or incomplete, prefer the safest coherent reading of
  the authoritative contract; record deviations in
  `$ARTIFACTS_DIR/implementation-notes.md`.
- Out-of-scope necessities: keep them minimal and list every one in
  `$ARTIFACTS_DIR/out-of-scope-notes.md`.

## Permanent prohibitions (never introduce)

Trading execution, custody, wallet signing, private-key handling, transaction
submission. Never weaken verification or product authority to obtain a pass.

## Before you finish

Run focused verification for what you completed this iteration (per
plan-context validation commands). Do NOT mark anything PROVEN — statuses are
machine-owned.

## Completion discipline

This loop's completion is decided ONLY by the deterministic guard
(`scripts/automation/package-implement-complete.mjs`: every task checked,
artifacts intact, no unresolved markers) followed by the full deterministic
gate — not by anything you say, and `<promise>IMPLEMENTED</promise>` has NO
power to end the stage. If your turn ends with tasks remaining, that is fine:
leave coherent partial work; a fresh turn continues automatically.

NEVER emit, quote, or write the loop control string
`WP_IMPL_LOOP_TEXT_SIGNAL_NEVER_EMIT_e47a09` anywhere in your output.

If blocked by something genuinely outside your control, end with
<promise>BLOCKED</promise> plus a short explanation.
