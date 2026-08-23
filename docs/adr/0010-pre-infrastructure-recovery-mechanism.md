# ADR-0010: recovery mechanism for pre-infrastructure milestones

- Status: Accepted
- Date: 2026-08-23
- Deciders: g0-contracts-data-truth implementation (plan decision P3, FR-DR-002)

## Context

FR-DR-002 requires PostgreSQL point-in-time recovery **or an equivalent
tested mechanism**, object-storage versioning/immutability where supported,
and separately protected encryption keys/recovery credentials. Production
PostgreSQL and object-store infrastructure do not exist until the
deployment-topology milestone, but FR-DR-001/002 acceptance criteria
(AC-060…062, AC-260…264) are G0-scoped and release-blocking. The recovery
contract therefore needs a mechanism that is testable now and replaceable
later without changing the contract's shape.

## Decision

Until production PostgreSQL/object-store infrastructure exists
(deployment-topology milestone), FR-DR-002's "equivalent tested mechanism"
is the deterministic snapshot-and-replay restore harness in
`packages/persistence/src/drill/`. It measures RPO/RTO against the §34.4 tier
registry and enforces key-material separation. Production WAL-based PITR
configuration implements the same interface and inherits the same drill
verification.

## Consequences

- Recovery verification is expressed as drills over a stable port set
  (snapshot capture, restore execution, tier evaluation, credential
  provider); swapping the underlying mechanism later changes adapters, not
  acceptance criteria.
- Tier ceilings remain product law regardless of mechanism: no registration
  may declare an RPO target looser than its data class ceiling.
- Destructive restore drills verify byte-identical recovery through
  canonical-row snapshots plus clean-environment checks (migrations, object
  hashes, audit chain, cross-store references, checkpoint continuity).
- When production infrastructure lands, this ADR is superseded (not deleted);
  the harness remains the drill verifier against whichever mechanism backs it.

## References

- FR-DR-001 / FR-DR-002, AC-260…AC-264
- ADR-0009 (PGlite deterministic snapshot rendering)
