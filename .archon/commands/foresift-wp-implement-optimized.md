---
description: Implement one work package in bounded slices with durable checkpoints and impact-aware FAST verification (OPTIMIZED profile)
argument-hint: <package-id>
---

# Foresift work-package implementation — OPTIMIZED lane (one continuation iteration)

**Package**: $ARGUMENTS
**Workflow artifacts**: $ARTIFACTS_DIR

> **You may be continuing work from a previous Claude turn. Do not assume this
> is the first turn.** Implementation is a multi-turn loop: a prior turn may
> have ended cleanly (turn time limit) with tasks remaining — that is normal,
> NOT a failure. Continuation state lives on disk/git, NOT in conversational
> memory.

You are the implementation agent in a fresh context. Throughput rules of this
lane (ADR 0006): bounded slices, durable checkpoints, FAST verification between
units — never weaker final verification. Completion authority stays with the
deterministic guard and gate.

## Start of every iteration: validate before you read

1. **Checkpoint first** (saves minutes of re-reading):
   `pnpm wp:checkpoint --validate --package $ARGUMENTS --artifacts-dir "$ARTIFACTS_DIR" --head "$(git rev-parse HEAD)"`
   - exit 0 → the checkpoint is provably current: resume EXACTLY where the last
     turn stopped using its derived context capsule (`context` block:
     requirementIds, acceptanceIds, prdReferences, adrReferences, affected test
     refs, suggested next tasks) plus slice/filesTouched. Do NOT re-read large
     contract sections it already indexes; open only the specific referenced
     PRD/ADR/spec-kit locations your current slice actually needs.
   - nonzero → treat as ABSENT: rebuild context from authoritative sources
     below. Never trust an invalid cache.
2. `git status` and `git diff` — uncommitted work from an earlier turn MUST be
   continued, never reset or discarded.
3. `git log --oneline -20` — committed units must not be repeated.
4. `specs/$ARGUMENTS/tasks.md` — first unfinished task(s).
5. `$ARTIFACTS_DIR/implement-completeness.json` / `implementation-notes.md`, if
   present.

Rules: completed work is not reimplemented; partial changes are continued to
coherence; persistence beats cleanliness.

## Read first (skip what a VALID checkpoint already covers)

1. `CLAUDE.md`; 2. `.specify/memory/constitution.md`; 3. plan artifacts;
4. `specs/$ARGUMENTS/{spec,plan,tasks}.md`; 5. your package object in
`specs/implementation/current-milestone.json` (binding scope); 6. ONLY the PRD
sections your requirementIds name (the checkpoint capsule lists exact
section/line references — do not sweep the whole PRD).

## Work in bounded slices

A slice = the next coherent ~8–12 task-chunk targeting 20–45 minutes of work,
ending at a state that is coherent on disk (compiles, focused checks green).

Per file change: just keep editing; do NOT run any check per single file.
At each slice boundary, run EXACTLY this order — the order matters because the
checkpoint hashes tasks.md, its HEAD, and other authoritative sources:

1. **FAST verify from git evidence** (scope comes from git, not memory):
   `pnpm wp:fast-verify --package $ARGUMENTS --artifacts-dir "$ARTIFACTS_DIR" --from-git`
   The tool derives changed files since the last validated checkpoint head
   (or the branch merge-base), including new/deleted/renamed files and
   uncommitted edits, classifies their impact, and runs the targeted checks
   that impact provably requires. Unknown or root-level impact escalates to the
   FULL suite inside FAST — that escalation is correct behavior; do not fight
   it. You MAY add hints for files git cannot know about yet:
   `--file <path>` (hints never replace git evidence). Red ⇒ fix now, re-run;
   do not stack slices on red.
2. **Update `specs/$ARGUMENTS/tasks.md`**: mark this slice's completed tasks
   `- [x]`. Do this BEFORE committing and BEFORE building the checkpoint — the
   checkpoint records tasks.md content, so it must observe the FINAL tasks.md.
3. **Persist any required notes**: append deviations to
   `$ARTIFACTS_DIR/implementation-notes.md` / out-of-scope necessities to
   `$ARTIFACTS_DIR/out-of-scope-notes.md`.
4. **Commit ALL coherent slice changes** (code, tests, tasks.md): conventional
   messages (`feat(scope): …`, `test(scope): …`). NEVER amend/rebase published
   branches/force-push.
5. **Build the checkpoint LAST**, against the final committed state:
   `pnpm wp:checkpoint --build --package $ARGUMENTS --artifacts-dir "$ARTIFACTS_DIR" \
      --slice-id <id> --slice-tasks <comma-separated task ids> \
      [--slice-base <HEAD sha before this slice>] [--blocker "<reason>"]`
   Everything else (HEAD, task counts, requirement/acceptance IDs, PRD/ADR
   references, touched-file scope, previous FAST result) is derived by the tool
   from authoritative repository state — do not invent or pass those values.
   A checkpoint built this way validates cleanly at the start of the next turn;
   any later change to tasks.md/HEAD/authorities correctly invalidates it.

## Install avoidance

`node_modules` is already installed in this tree. Run `pnpm install` ONLY when
you changed `pnpm-lock.yaml` or imports fail with missing-module errors that
are not your own bug. Otherwise NEVER invoke install commands — they are pure
waste inside the loop.

## Scope & honesty

Implement ONLY this package's scope (objective, requirementIds, writeScopes).
Write the tests demanded by the manifest evidence rules for every acceptance
criterion you touch, including negative/failure-path tests. Out-of-scope
necessities are minimal and listed in `$ARTIFACTS_DIR/out-of-scope-notes.md`.
Plan wrong? Prefer the safest coherent reading of the authoritative contract
and record deviations in `$ARTIFACTS_DIR/implementation-notes.md`.

## Permanent prohibitions (never introduce)

Trading execution, custody, wallet signing, private-key handling, transaction
submission. Never weaken verification or product authority to obtain a pass.

## Before you finish

Leave the last slice coherent: FAST verify + tasks.md updated + committed +
checkpoint written LAST. Do NOT mark anything PROVEN — statuses are
machine-owned.

## Completion discipline

Completion is decided ONLY by the deterministic guard
(`scripts/automation/package-implement-complete.mjs`) followed by the full
deterministic gate — not by anything you say. `<promise>IMPLEMENTED</promise>`
has NO power to end the stage. Ending with tasks remaining is fine: a fresh
turn continues from your checkpoint automatically.

NEVER emit, quote, or write the loop control string
`WP_IMPL_LOOP_TEXT_SIGNAL_NEVER_EMIT_e47a09` anywhere in your output.

If blocked by something genuinely outside your control, end with
<promise>BLOCKED</promise> plus a short explanation.
