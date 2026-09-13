# g2-production-readiness — out-of-scope notes

The package plan (`plan.md`) requires every finding that is outside this
package's scope to be recorded here rather than planned or implemented silently.
Recorded during implementation and the T039 convergence fix (2026-09-13).

## Owned by sibling packages (deliberately not implemented here)

- **Admin rendering and kill switches** (FR-ADM-001/003/007): this package
  publishes the governed module-state, containment, and rollback primitives plus
  the read-only activation gate that decides advancement; the dashboard,
  overview, and kill-switch UI/API surfaces are `g2-admin-control`. A kill switch
  drives containment through the exported API; it never writes `prod` directly.
- **Recovery drills** (FR-DR-003…006, AC-060…064, AC-260…264):
  `capability-registry` exposes the append-only provenance and the read-only
  consistency surfaces the drills consume; the destructive restore drills and
  RPO/RTO measurement stay with `g2-recovery-continuity`.
- **Social/X capability adapters** (FR-SOC, G5): the activation gate consumes
  already-registered statistical/distribution evidence verdicts as opaque inputs;
  collecting social data and the paid/X adapters are G5.
- **Alert consumption of the activation state** (FR-ALERT-001…005): this package
  exposes `statesFor`, the persisted `prod` names, and
  `assertAlertResumptionAllowed`; classification, rendering, and delivery of
  alerts remain `g2-alert-lifecycle`, which honours the activation gate it is
  given without deciding module availability.
- **Execution/security/cost ownership**: the §69.4/§69.5 gate CONSUMES the
  capacity contract, verified gate evidence, rights/distribution readiness, and
  containment facts produced by the G0/G1 packages; it never recomputes them.

## Accepted residuals (non-blocking, carried forward)

- **Base provider AC hooks lack explicit timeouts.** The landed
  `tests/acceptance/AC-270.spec.ts` and `AC-271.spec.ts` boot PGlite-backed
  stores in `beforeAll` without an explicit `120_000` budget. Every hook this
  package adds carries an explicit timeout; the base provider files are left
  untouched under the additive-only rule. Bounding them is a separate
  hardening change for a wall-clock-capped host.
- **`prod.live_path_alpha_reads.bound_id` is NOT NULL with an FK to
  `prod.precomputed_alpha_bounds`.** Every recorded read — including a refusal —
  must name a persisted bound, so an unknown-bound refusal cannot be persisted
  without a bound row. This is deliberate (a read can never be recorded against
  a non-existent envelope, and a refusal is attributable to a declared bound);
  relaxing it would admit unattributable reads and is not planned.
- **Per-package `noUncheckedIndexedAccess` latent errors.** `tsconfig.base.json`
  enables the flag but the root `tsconfig.json` disables it, so the array/index
  accesses across the package compile under the looser setting. The package
  guards every indexed access at runtime with typed fallback refusals, but a
  repo-wide strict-flag flip must be audited package by package rather than only
  here.

## Proof summary

- Package tests: `packages/capability-registry/test/` (9-state lattice, total
  ordered gate, persisted-evidence guard, containment, rollback, `prod`
  migration shape).
- The convergence fix binds `ACTIVE` to persisted gate evidence at both levels:
  `requirePersistedActivationEvidence` re-derives the evaluation-set reference
  from `prod.activation_gate_evaluations` inside the writing transaction, and
  `g2_prod_0005` refuses a raw `ACTIVE` INSERT/UPDATE unless a complete,
  all-PASS, unexpired set exists for the same scope hash and activation event.
- Forgery probes (both levels, already refused): a hand-built PASS object with
  `evaluations: []`, a PASS object whose `activationEventRef` was never
  persisted, a `DEGRADED → ACTIVE` reactivation without fresh persisted PASS
  evidence, and a raw SQL `ACTIVE` INSERT with zero gate rows.
