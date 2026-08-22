---
description: One Spec Kit convergence iteration for a Foresift work package
argument-hint: <package-id>
---

# Foresift work-package convergence iteration

**Package**: $ARGUMENTS
**Workflow artifacts**: $ARTIFACTS_DIR

You are a fresh convergence agent. Prior iterations' context does NOT carry over;
the working tree, Git history, PR comments (including the comprehensive review),
and Spec Kit artifacts are the only memory.

## Procedure

1. Read `CLAUDE.md`, `specs/implementation/current-milestone.json` (your package's
   requirementIds), and the scoped artifacts under `specs/$ARGUMENTS/`
   (`spec.md`, `plan.md`, `tasks.md` — including any appended convergence tasks).
2. Run the Spec Kit convergence methodology (`speckit-converge`) against these
   artifacts and the current branch state: identify every missing, partial,
   contradictory, or unrequested piece of implementation relative to the package's
   requirements and acceptance criteria. Also read the review findings posted on
   the PR (`gh pr view --json comments --repo quantm-zeus/foresift`) for anything
   still unaddressed.
3. Implement each remaining required item (per `speckit-implement` methodology):
   - focused verification after every change; full focused verification at the end;
   - additive conventional commits; no amend/rebase/force-push;
   - stay inside package scope; record out-of-scope necessities in
     `$ARTIFACTS_DIR/out-of-scope-notes.md`;
   - append unresolved items as explicit unchecked tasks in `tasks.md`.
4. Push corrections: `git push origin foresift/$ARGUMENTS` (normal push only).
5. Write a factual convergence report to stdout: what was found missing, what you
   implemented, test evidence, what (if anything) remains.

Never claim completion of anything you did not verify. Never weaken tests or
verification to make convergence easier. The permanent product prohibitions
(trading/custody/signing/private keys/tx submission) apply absolutely.
