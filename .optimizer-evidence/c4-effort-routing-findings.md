# C4 — risk-aware effort routing: investigation and decision

Tasking bar: implement MEDIUM effort for non-CRITICAL implementation slices
**only if simple AND proven in Archon v0.9.0**, keeping HIGH for review,
convergence, and FULL verification; otherwise DO NOT IMPLEMENT and document
why.

## What Archon v0.9.0 actually provides (verified)

- `Archon CLI v0.9.0` (linux-x64 binary).
- Workflow YAML supports **static** `effort:` at workflow level and per node,
  and a `model:` selector (used once per product workflow:
  `model: large` on the planning node of `foresift-work-package*.yaml` /
  `foresift-milestone-control.yaml`).
- Every production foresift node pins `effort: high`. No foresift workflow has
  ever executed a node with `effort: medium`; medium is therefore **not
  proven** for this product's implementation slices.
- Node fields are static YAML. There is no conditional-expression mechanism
  that could read a package's `risk` field (`specs/implementation/
current-milestone.json`) at node-selection time — risk is runtime data
  evaluated inside bash nodes, invisible to DAG construction.

## Why the requested behavior is not expressible simply

"MEDIUM only for non-CRITICAL implementation slices" requires the effort
decision to depend on per-package runtime risk. With static YAML the only
routes are:

1. **Duplicate the work-package workflow into risk variants** (HIGH variant vs
   MEDIUM-implementation variant) and route between them by risk. This adds a
   second production topology to maintain and interacts badly with the
   standing constraint against hot-swapping an already-running package to a
   new workflow revision (in-flight packages would straddle variants). Not
   simple; rejected.
2. **Set `effort: medium` statically on the implementation node.** This would
   also apply to CRITICAL packages — directly violating the tasking's own
   guardrail. Rejected.
3. **Executor-side risk-aware routing** — no such feature exists in v0.9.0;
   would require modifying the orchestrator itself. Out of scope.

Additionally, "proven" cannot be established without burning real product
workflow runs on an unproven effort tier against live quota — precisely what
this optimization pass may not experiment with.

## Decision: DO NOT IMPLEMENT

All review, convergence, FULL-gate repair, and implementation nodes remain
pinned `effort: high` (unchanged). Recorded revisit triggers:

- An Archon release adding conditional/dynamic node fields (or first-class
  per-risk profile selection) makes route 1 trivial; re-evaluate then.
- Any measured signal that implementation-phase reasoning effort dominates
  cost without quality impact (requires the measurement machinery above to
  exist first).

## Related C4 item already landed

Deterministic critical-path PRIORITY scheduling among eligible packages was
implemented (`scripts/automation/milestone-scheduler.mjs`, tests 42–46) —
that part of later-milestone optimization met its bar (pure functions,
benchmark-shaped benefit on wide milestones, zero policy drift since all
eligibility stays in `schema.mjs canStartPackage`). Effort routing did not
meet its bar. Both outcomes are recorded here per the tasking's
document-either-way requirement.
