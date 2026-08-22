# Implementation planning area

Machine-readable, version-controlled implementation state for the Foresift
autonomous development control plane. **Authoritative for implementation
progress** — but always subordinate to `docs/spec/` (the product contract).

## Files

| Path                     | Purpose                                                                                                                                                          |
| ------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `roadmap.json`           | Milestone skeleton derived from the PRD requirement manifest dependency groups (G0–G7) plus the concurrency policy. Never contains work packages.                |
| `current-milestone.json` | The single milestone currently being implemented, decomposed into 2–8 work packages. Written by the `foresift-milestone-control` workflow through a reviewed PR. |
| `history/`               | Archived, converged milestone states (`<milestone-id>.json`), moved here when a milestone is proven.                                                             |

## Lifecycle

```text
roadmap.json (skeleton, derived from PRD manifest)
      ↓  foresift-milestone-control (Mode A): decompose next milestone → PR → CI → merge
current-milestone.json (2-8 work packages)
      ↓  foresift-work-package per package: plan → implement → verify → review → converge → CI → merge
all packages PROVEN
      ↓  foresift-milestone-control (Mode B): independent audit; gaps become remediation packages in the SAME milestone
milestone PROVEN → archived to history/, next milestone planned (or final product-wide audit)
```

## Package schema

```json
{
  "id": "g0-core-runtime",
  "objective": "one outcome-oriented sentence",
  "requirementIds": ["FR-CORE-001"],
  "dependencies": ["g0-domain-contracts"],
  "risk": "LOW | MEDIUM | HIGH | CRITICAL",
  "parallelizable": false,
  "writeScopes": ["packages/core/**"],
  "verificationCommands": ["pnpm typecheck", "pnpm test"],
  "status": "PENDING"
}
```

Package statuses: `PENDING → RUNNING → VERIFYING → REVIEWING → CI → PROVEN`,
with `BLOCKED` as a terminal-needs-attention state. Status transitions on
`main` are performed only by the autopilot supervisor or the milestone-control
workflow (never by implementation agents inside worktrees).

## Rules

- The roadmap is derived from the authoritative requirement manifest — never
  from the predecessor repository.
- Only the current milestone is decomposed. The next milestone is planned only
  after the current one converges.
- Work-package statuses change only through machine gates (deterministic
  verification + CI + independent review), never to make progress look better.
