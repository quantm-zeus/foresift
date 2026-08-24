# ADR-0013: Zod is the single approved runtime schema-validation library

- Status: Accepted
- Date: 2026-08-23
- Deciders: g0-contracts-data-truth implementation (plan decision P1, PRD §37.5)

## Context

The product contract requires runtime validation at every trust boundary:
external SDK types are never trusted without passing an authoritative
schema (PRD §37.5). The `packages/shared-schemas` package exists to hold
those authoritative schemas. A greenfield codebase that grows validation
ad hoc tends to accumulate several half-compatible validation libraries,
each with its own semantics for coercion, defaults, and error shapes —
which fragments the guarantee that "validated" means one thing everywhere.

## Decision

Foresift uses **Zod** as the single approved runtime-validation schema
library. Authoritative schemas live in `packages/shared-schemas`; external
SDK types are never trusted without passing these schemas. Adding further
ad-hoc validation libraries requires a superseding ADR.

## Consequences

- Every boundary type consumed from an external provider or transport passes
  through a shared-schemas Zod schema before use.
- Error surfacing follows the shared typed-error vocabulary; validation
  failures fail closed (refuse the input), never sanitize-and-continue.
- Schema evolution is versioned with the schemas themselves, so consumers and
  producers cannot drift apart silently.

## References

- PRD §37.5 (runtime validation requirement)
- `packages/shared-schemas` — authoritative schema home
