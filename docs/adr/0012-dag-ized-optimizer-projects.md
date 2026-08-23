# ADR-0012: DAG-ized optimizer/research projects (reusable template)

Date: 2026-08-23
Status: Accepted
Context task: V3 §25 — "DAG-ize large optimizer projects (reusable workflow,
read-only children `mutates_checkout:false` when proven, writers isolated
worktrees)".

## Context

Large optimization or research efforts (the V3 optimization campaign itself is
one) were at risk of being run as one long serial session per project. Serial
execution wastes wall-clock on independent subproblems and concentrates all
writes in one checkout, which collides with the repository's permanent
"never run two writer agents on one checkout" boundary.

Archon 0.9.0 (authoritative install, see ADR for §24) has no
`mutates_checkout` node flag — read-only intent cannot be DECLARED to the
runner. Anything not enforced by structure must therefore be proven by the
node itself.

## Decision

Large optimizer projects are structured with the reusable skeleton in
`.archon/workflows/foresift/TEMPLATE-dag-project.yaml`, which encodes three rules:

1. **Read-only children prove it; they don't claim it.** Every read-only node
   ends with `git status --porcelain --untracked-files=normal` and fails if
   anything changed. Read-only means byte-for-byte unchanged tree, verified,
   every run.
2. **Writers are isolated worktrees.** Any node that writes does so inside its
   own `git worktree add` under `$ARTIFACTS_DIR/wt/<id>` (or a dedicated
   clone), commits/pushes from there, and removes the worktree afterwards.
   The run checkout itself is never written by a writer node.
3. **Fan-out/fan-in via `depends_on` only.** Siblings without an explicit edge
   run concurrently (archon semantics); a synthesis/verification node lists
   ALL fan-out ids in `depends_on`, making the join point explicit and
   machine-scheduled.

## Consequences

- Wall-clock for independent research/read phases drops from serial to
  max-per-phase (V3 §26 used this pattern during the campaign itself).
- The one-checkout-one-writer boundary is respected by construction instead
  of by discipline.
- A template copy that cannot keep rule 1 green for a given child proves that
  child is a WRITER and must be moved under rule 2 — the classification is
  derived from evidence, never asserted.

## Verification

- Template exists and parses: `.archon/workflows/foresift/TEMPLATE-dag-project.yaml`
  (structure mirrors `foresift-smoke-gen-adoption.yaml`, proven schema).
- Boundary context: CLAUDE.md "never run two writer agents on one checkout";
  landing safety across checkouts proven in
  `tests/automation/v3-base-drift.spec.ts` §31 describe.
