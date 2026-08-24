# ADR-0016: Decimals CROSS_CHECKED independence is best-effort over registered identities

- Status: Accepted
- Date: 2026-08-23
- Relates to: FR-DATA-001, INV-008 (provider count is not source independence), ADR-052 (declared lineage + empirical dependence)

## Context

`recordDecimalsObservation` (`packages/persistence/src/repos/identity.ts`) grants
CROSS_CHECKED once ≥2 distinct `token_decimal_observations.source_ref` strings
endorse the newest decimals value. That is ref-level counting: two refs reselling
the same upstream lineage (one aggregator behind two brands) would earn full
cross-check credit despite being a single independent voice — exactly the trap
INV-008 names.

A structural fix needs a hard linkage from free-form decimal-observation
`source_ref` values to registered `source_identities` rows (and their
independence groups). No such foreign key exists today; `source_ref` is an
opaque caller-chosen string, so the linkage cannot be made total at this layer.

## Decision

1. **Best-effort collapse now.** When ≥2 supporting refs are candidates for
   CROSS_CHECKED, the repository resolves them against
   `source_group_memberships`. If any single independence group holds ≥2 of the
   supporters, full cross-check credit is refused: the representation stays
   SOURCED and the call result carries
   `independenceHints: ['DECIMAL_UNCERTAIN']` so callers can flag field-level
   uncertainty.
2. **Unregistered refs keep ref-level semantics.** Refs that match no
   registered source identity cannot be lineage-checked; they continue to count
   as distinct voices. This residual gap is documented rather than silently
   narrowed by heuristics on string shape.
3. **Full closure is deferred.** Total independence-aware confirmation requires
   making decimal observations reference source identities at write time. That
   schema change belongs to the package that owns provider/source registration
   integration; tracked as follow-up work ("Independence-aware CROSS_CHECKED
   decimal confirmation").

## Consequences

- Same-lineage duplicate confirmation no longer promotes a value to
  CROSS_CHECKED when both refs are registered identities.
- Callers see reduced credit explicitly (`DECIMAL_UNCERTAIN`) instead of
  discovering inflated confidence downstream.
- The state machine is deterministic and history-derived (NOT monotone: late
  memberships can downgrade a state, and CONFLICTING↔upgraded transitions are
  by design): the downgrade depends only on rows visible inside the same
  transaction.
