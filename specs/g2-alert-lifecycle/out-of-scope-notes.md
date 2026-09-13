# g2-alert-lifecycle — out-of-scope notes

Recorded during implementation and the T031 convergence audit (2026-09-12/13).

## Owned by sibling packages

- **Admin rendering / kill switches** (FR-ADM-001/003/007): this package produces
  the classified alert and the §26.7/§26.8 content envelope; the dashboard,
  overview and kill-switch surfaces are `g2-admin-control`.
- **Production promotion and activation states** (FR-PROD-001…006) are
  `g2-production-readiness`; the alert package honours the activation gate it is
  given but does not decide module availability.
- **Social/X capability adapters** (FR-SOC, G5): this package models
  `SOCIAL_UNAVAILABLE` as unknown coverage and refuses an organic-confirmation
  claim over it; collecting social data and the paid/X adapters are G5.
- **Recovery drills** (FR-DR-003…006, AC-260…264): alert records and the outbox
  are part of the restored/reconciled state the recovery package verifies; the
  destructive drills are not authored here.
- **Execution/security/cost ownership**: the §26.3 gates CONSUME tradability,
  Solana-security, cost-policy, freshness and conflict results produced by the
  G0/G1 packages; this package never recomputes them.

## Accepted residuals (non-blocking, carried forward)

- **Negated disclaimers are refused.** The mechanical high-conviction scan is a
  substring law, so a negated sentence such as "No guarantee of future results."
  trips it. This is fail-closed (it refuses rather than misleads); a semantic
  negation model is deliberately out of scope because the law must stay
  deterministic and auditable. Operators can reword the disclaimer.
- **Initial render `validUntil` is caller-supplied.** The class TTL pins the
  _update_ notification `valid_until` (`validUntilFromPolicy`); the initial
  classification render accepts the caller's `valid_until` and requires it to be
  present. Pinning it to the policy on the initial path is a follow-up if the
  admin surface needs it.
- **Invalid `gateInputs` surface a `ZodError`** from the request schema rather
  than a typed `ForesiftError`; the exported gate evaluator itself refuses
  fail-closed with a typed error. Cosmetic.
- **Unauthoritative forged gate results are echoed** in the refusal outcome's
  `gates` list with `gateSetComplete: false`. The outcome is suppressed, so the
  echo is informational only; it never influences classification.

## Proof summary

- Package tests: 88 across domain/schema/migration/classification/lifecycle/
  metrics suites (plus 47 domain + 60 shared-schema tests).
- Acceptance: AC-140, AC-141, AC-142, AC-143 positive and negative (37).
- Shared extends: AC-245…249 positive (52) plus negative counterparts, base
  assertions untouched.
- Independent adversarial convergence audit (`CHANGES REQUIRED`, 2 HIGH) →
  all fixed → re-review `READY FOR PROVEN`.
