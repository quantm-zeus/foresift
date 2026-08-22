# ADR-0001: Autonomous control plane architecture

- Status: Accepted
- Date: 2026-08-22
- Deciders: Foresift autonomous bootstrap session (owner-directed)

## Context

The owner mandated a working autonomous development control plane for Foresift:
the authoritative PRD must flow through GitHub Spec Kit and Archon into Claude
Code work packages that implement, review, verify, merge, and iterate without
human approval, on a single VPS. Custom orchestration was capped (~500 lines)
and bespoke orchestrators, worktree managers, task leases, review engines, and
retry engines were explicitly prohibited.

## Decision

1. **Archon is the execution engine.** Exactly two product workflows live in
   `.archon/workflows/foresift/`:
   - `foresift-work-package` — preflight → scoped Spec Kit plan → fresh-context
     implementation → deterministic package gate → PR → bundled
     `archon-review-block` independent review with automatic CRITICAL/HIGH
     fixes → bounded Spec Kit convergence loop (max 4 iterations) → final
     deterministic gate → exact-head CI → machine squash merge.
   - `foresift-milestone-control` — Mode A (plan next milestone: decomposition
     → independent planning review → fix loop → deterministic validation → PR)
     and Mode B (independent milestone audit; gaps become remediation packages;
     final product-wide audit at G7).
2. **The supervisor is thin and dumb.**
   `scripts/automation/foresift-autopilot.mjs` (<500 lines incl. helpers) only:
   selects eligible packages per the version-controlled concurrency policy,
   starts/stops/resumes Archon runs via the CLI's `--json` interface, applies
   the §16 recovery policy, commits version-controlled implementation state,
   reports status. No AI logic, no database access, no worktree management.
3. **Planning state is version-controlled in `specs/implementation/`**
   (`roadmap.json`, `current-milestone.json`, `history/`), derived from the
   authoritative requirements manifest — never from the predecessor repository.
4. **Determinism gates autonomy.** `pnpm foresift:gate --package <id>` derives
   its checks from committed package metadata plus the manifest. AI verdicts
   never mark anything PROVEN; a merged PR observed via `gh` plus the gate do.
5. **Recovery uses supported Archon operations only** (`workflow resume`,
   `workflow abandon`); Archon's database is never touched directly.

## Consequences

- Upgrade path: re-validate workflows with `archon validate workflows` and the
  `foresift-smoke-resume` fixture after any Archon upgrade.
- The supervisor can be replaced or restarted at any time; durable truth lives
  in git (`specs/implementation/`) and Archon's run records.
