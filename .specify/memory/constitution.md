# Foresift Constitution

The Foresift project constitution: binding engineering principles that govern
every specification, plan, implementation task, review, and verification pass
in this repository — including those performed autonomously by AI agents.

**Subordination clause.** This constitution is subordinate to the authoritative
product contract (`docs/spec/crypto_intelligence_agent_gateway_PRD_FINAL_v6.0.md`,
including its inline accepted ADRs) and its machine-readable requirement
manifest (`*.requirements.json`). It must never be read as a competing product
specification, and no principle here may weaken, reinterpret, or override an
authoritative requirement. Where the product contract and this constitution
appear to conflict, the contract wins and the conflict is recorded as an ADR.

## Core Principles

### I. Product-Contract Authority

The PRD and its manifest are the sole product authority (see `CLAUDE.md`
authority hierarchy). Every artifact downstream of them — Spec Kit files,
milestone plans, package specs, tasks, ADRs, code, tests — is a derivative and
must trace back to specific requirement IDs. Implementation must never edit,
omit, silently reinterpret, or weaken `docs/spec/**` to make delivery easier.
Spec Kit artifacts operate under the PRD's authority; spec generation may never
replace or compete with `docs/spec/` as the source of truth.

### II. Greenfield Architecture

The predecessor repository is not a source of truth for design. Architecture is
designed from the PRD alone; the predecessor's only legacy role is migration
provenance recorded in `docs/migration/SPEC_MIGRATION.md`. Copying old
structure because it existed is a defect, not a shortcut.

### III. Modular-Monolith-First Simplicity

The system is one deployable modular monolith with internal module boundaries;
distributed decomposition (separate services, message brokers, microservice
topologies) requires an accepted ADR demonstrating a concrete product need.
Start with the smallest coherent structure that satisfies the requirements:
no speculative abstractions, no orchestration frameworks beyond the ones the
project has deliberately adopted, complexity must be justified at review time.

### IV. Read-Only Product Boundary (NON-NEGOTIABLE)

Foresift is a read-only intelligence and research system. The prohibited-
capability policy `READ_ONLY_NO_TRADING_CUSTODY_SIGNING` from the PRD is
permanent: no trading execution, no custody, no wallet signing, no private-key
handling, no transaction submission — in code, configuration, dependencies,
documentation, and operational procedure. No test, deadline, review pressure,
or autonomous decision may weaken this boundary. Violations fail every gate.

### V. Point-in-Time Correctness

Intelligence answers must reflect what was knowable at the requested point in
time. Queries are evaluated against historical state as of their reference
time, never against later retroactive data, unless the requirement explicitly
demands current-state semantics. Silent retroactive mutation of served history
is a correctness defect.

### VI. Event-Time and Earliest-Availability Correctness

Analytics, signals, and derived features are computed over event time (when the
event happened), not ingestion time (when we saw it), and respect each source's
declared earliest-available-data constraints. Backfills and replays must
produce results consistent with what a live computation would have produced at
the same event times, within the tolerances the requirements define.

### VII. Provenance and Evidence

Every externally sourced fact, derived metric, and agent-visible datum carries
provenance: source identity, retrieval/derivation time, and transformation
lineage sufficient to audit it. Claims without retrievable evidence are not
shipped. Evidence artifacts referenced by requirements (tests, fixtures,
reports) must actually exist and run.

### VIII. Fail-Closed External Integrations

External providers, APIs, and services are untrusted and fallible. On ambiguity,
timeout, partial response, schema drift, or authentication uncertainty the
system refuses to act rather than guessing: no silent default values standing in
for missing truth, no swallowing errors into success paths, no serving derived
conclusions from unverifiable inputs. Degrade explicitly and observably.

### IX. Provider/Capability Abstraction

External capabilities (data providers, model providers, execution surfaces)
are accessed through internal abstractions so providers can rotate, degrade, or
be replaced without product-code rewrites. Product modules depend on capability
interfaces, not vendor SDKs, except where a requirement pins a specific
integration.

### X. Requirement Traceability

Every work package cites requirement IDs; every scoped specification quotes its
assigned requirements' normative text; every implementation task traces to at
least one requirement or acceptance criterion; every acceptance criterion maps
to executable verification. Untraceable work is out of scope by definition and
must not land. Requirement IDs not present in the authoritative manifest must
never be invented.

### XI. Deterministic Verification

Completion claims are settled by deterministic checks — tests, integrity
verifiers, gates, CI — never by an AI's self-assessment. Gates are code, run
the same way locally and in CI, and fail closed on infrastructure error.
`pnpm verify`, `pnpm spec:verify`, and the automation gates are the floor, not
the ceiling.

### XII. Positive and Failure-Path Testing

Requirements demand both positive-path evidence and negative/failure-path
tests wherever the manifest declares them: invalid input rejection, provider
failure handling, permission denial, corruption, replay, and timeout behavior
must be exercised, not assumed. A feature whose only proof is its happy path is
unverified.

### XIII. Replay, Recovery, and Idempotency

Durable operations produce identical outcomes when replayed. State transitions
are idempotent under retry; recovery paths rebuild consistent state from
persisted artifacts; crash-resumption tests cover every long-running stage.
At-least-once delivery assumptions are handled by idempotent consumers, never
by hoping failures don't happen.

### XIV. Durable, Resumable Operations

Any operation that can outlive a single session, process, or machine turn must
persist its progress on disk/git — never solely in conversational memory or
process-local variables — such that a fresh context can continue it without
repetition or loss. Long stages are bounded loops over persisted state, not
single monolithic sessions. Completed work is never reimplemented and useful
partial work is never discarded merely because a previous session ended.

### XV. Security and Least Privilege

Secrets never enter git, logs, command lines, or workflow artifacts; only
placeholder examples are committed. Services run with the minimum permissions
they need; administrative surfaces require authentication; network exposure is
explicitly enumerated and everything else stays closed. Verification and
security boundaries are never weakened to obtain a passing result.

### XVI. Autonomous-Agent Governance

AI agents operate inside deterministic guardrails: eligibility preflights,
scope limits, concurrency policies, additive-only git contracts, and machine
gates bound what any agent — however confident — may do. Agents resolve routine
engineering decisions autonomously but must record material decisions as ADRs,
prefer the safest coherent interpretation of genuine ambiguity, and escalate
fatal blockers instead of papering over them.

### XVII. Additive Git History

History is append-only: no amend, no rebase of published branches, no force
push. Corrections are new commits. Product source reaches `main` only through
pull requests gated by CI; machine-driven metadata transitions follow the
documented ownership rules (`docs/adr/0003`). Rewriting published history is a
contract violation even when the rewrite would be convenient.

### XVIII. No AI Claim Is Completion

No requirement, package, milestone, or audit is complete because an AI asserted
completion — including in a promise tag, summary, or final report. Completion
exists only when the deterministic completion guards, gates, independent
review, convergence checks, and CI for that scope have passed on merged code.
AI promises may trigger *checking*; they never constitute *proof*.

## Additional Constraints

- **Authority chain**: PRD → accepted repository ADRs → executable
  verification → current implementation. Conflicts are recorded, never
  silently resolved.
- **Spec Kit discipline**: GitHub Spec Kit drives constitution, planning, work
  packages, tasks, and convergence; Archon orchestrates execution; neither may
  manufacture product authority.
- **Evidence durability**: verification evidence lives in the repository
  (tests, scripts, reports under version control) where later audits can rerun
  it.

## Development Workflow and Quality Gates

1. Milestone planning, package planning, implementation, review, and audit
   stages run as bounded fresh-context continuation loops with deterministic
   completion guards; loop exhaustion fails the stage rather than faking
   completion.
2. Independent review uses fresh contexts separate from authoring contexts;
   CRITICAL/HIGH findings block progression until repaired.
3. Every merge to `main` passes exact-head CI; merges are squash merges
   produced by the machine pipeline, with zero human approvals required by
   design.
4. Package completion requires the deterministic package gate plus the shared
   aggregate gate (`pnpm verify`) — both green before PROVEN status.
5. Recovery from failure is classified (transient / fatal / unknown / hung /
   restart / clean-exit-incomplete) and follows the documented policy rather
   than one generic retry.

## Governance

- This constitution binds all contributors — human and autonomous. Reviews and
  gates verify compliance; non-compliance blocks merging regardless of
  schedule pressure.
- Amendments require a new MINOR or PATCH version bump (MAJOR for principle
  changes), a recorded rationale, and must never weaken Principle IV or the
  subordination clause. Superseded versions remain readable in git history.
- Runtime development guidance belongs in `CLAUDE.md`; conflicts between it and
  this constitution resolve in favor of whichever is stricter, with the PRD
  always supreme.

**Version**: 1.0.0 | **Ratified**: 2026-08-22 | **Last Amended**: 2026-08-22
