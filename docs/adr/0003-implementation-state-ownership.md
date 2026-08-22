# ADR-0003: Implementation-state commits flow directly to main; product source never does

- Status: Accepted
- Date: 2026-08-22
- Deciders: Foresift autonomous bootstrap session (owner-directed)

## Context

Work packages execute in isolated Archon worktrees on `foresift/<package-id>`
branches and reach `main` exclusively through squash-merged PRs. Yet the
control plane needs continuously updated, version-controlled planning state
(`specs/implementation/current-milestone.json` package statuses) that is not
product source. Routing every status flip through a PR would deadlock the loop
(a PR cannot merge itself while the supervisor waits on it).

## Decision

`specs/implementation/**` is machine-owned metadata:

- The autopilot commits and pushes status transitions directly to `main`
  (`chore(autopilot): <milestone>/<package> -> <status>`), additively only.
- Workflows running in worktrees never write implementation state; they read it.
- Milestone plans and audits land through the normal PR path because they are
  substantive decisions subject to review and deterministic validation.
- Everything else (all product source) reaches `main` only via squash-merged PRs.

## Consequences

- Status history is auditable in git without PR overhead.
- Direct-push rights are limited to the supervisor identity and that one path;
  any drift outside `specs/implementation/` is treated as an anomaly.
