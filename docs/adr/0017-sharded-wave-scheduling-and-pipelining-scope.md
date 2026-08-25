# ADR 0017: Sharded-wave scheduling scope — contract-first satisfied in-place; speculative roadmap pipelining deferred

Date: 2026-08-25
Status: Accepted
Deciders: V4 control-plane optimizer (autonomous, per operating contract)

## Context

The V4 mission lists four throughput features: Claude+Antigravity hybrid
execution, intra/cross-package parallelism, contract-first scheduling, and
bounded speculative roadmap pipelining. Three shipped with the sharded-wave
work (`foresift/sharded-wave-v4`, PR #53). Two schedule-shaped items need an
explicit recorded decision.

## Decision

1. **Contract-first scheduling is satisfied by the sharded wave's own
   architecture.** Every lane's work is fully contracted BEFORE any provider
   dispatch: a deterministic task graph
   (`build-implementation-task-graph.mjs`), write-disjoint shard plan with
   recorded scope exceptions, per-lane briefs rendered from the authority-bound
   planning capsule (PR #51), admission gating under telemetry
   (`check-writer-admission.mjs`), and pinned-base private worktrees. Writers
   never negotiate scope at runtime; the guard recomputes everything against
   those contracts. No separate scheduler module is added — scheduling IS the
   contract pipeline.

2. **Bounded speculative roadmap pipelining is DEFERRED, not dropped.** The
   active milestone is G0 (foundation). `specs/implementation/roadmap.json`
   policy pins `maxParallelCodingPackagesFoundation: 1` — foundation packages
   are intentionally serialized by an accepted V3 safety policy. Speculative
   pipelining (starting package N+1's planning while N settles) would either
   violate that policy or deliver zero makespan benefit while adding unproven
   orchestration complexity to the control plane. The sharded wave already
   attacks makespan WITHIN each package, and cross-package concurrency for
   post-G0 milestones is already governed by `maxParallelCodingPackages: 2`
   plus the `concurrentRequiresAllOf` guards.

## Consequences

- Revisit pipelining when the roadmap reaches a milestone governed by
  `maxParallelCodingPackages >= 2`; at that point implement it behind the same
  rollout discipline as the sharded wave (frozen pure selector,
  commit-gated flip, canary evidence before PRODUCTION).
- No verification, security, or product-authority surface changes.
- The §18 acceptance matrix remains complete without a pipelining row; this
  ADR is the audit trail for why.
