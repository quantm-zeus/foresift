# ADR-0014: PGlite as the deterministic database test engine

- Status: Accepted
- Date: 2026-08-23
- Deciders: g0-contracts-data-truth implementation (plan decision P2)

## Context

Migration and repository tests need a real PostgreSQL engine to be honest:
SQL truth (constraints, triggers, immutability rules) must execute, not be
simulated in TypeScript. But requiring a provisioned PostgreSQL server for
every test run makes the suite slow, environment-dependent, and hostile to
deterministic CI. PGlite provides in-process PostgreSQL (WASM) with full
SQL semantics, no external services.

## Decision

Migration and repository tests run against in-process PostgreSQL (**PGlite**).
Production remains real PostgreSQL per product ADR-001; PGlite is a **test
engine only**, never normative for production state. Migrations must restrict
themselves to SQL constructs supported by both engines; any divergence
requires a documented conformance note and a CI-followup issue.

## Consequences

- The persistence engine seam (`DatabaseEngine`) carries an explicit
  `engineKind` so tests are transparent about which engine executes.
- Migration authoring treats "runs identically on PGlite and real PostgreSQL"
  as a constraint; features only available on one engine require an explicit
  conformance note before use.
- Deterministic snapshots and restore drills (ADR-0015) rely on PGlite's
  byte-stable row rendering for reproducibility of backup artifacts.
- Nothing in production configuration may point at PGlite; the dependency is
  dev/test-only by package manifest.
- Production pools are constructed exclusively through
  `createProductionPgPool(pg, config)` in `packages/persistence/src/db.ts`,
  which registers the precision-retaining timestamp parsers
  (`types.setTypeParser`, OIDs 1114/1184) on the driver's registry before the
  first Pool exists; constructing a node-pg pool outside this factory
  violates the engine contract and reintroduces silent sub-millisecond
  truncation on read-back (FR-DATA-002 receipt-hash round-trips).

## References

- product ADR-001 (production PostgreSQL)
- `packages/persistence/src/db.ts` (engine seam)
