# Foresift Handoff / Retirement Notice

**Effective date:** 2026-09-19  
**Successor project:** [Private Execution Platform (PEP)](https://github.com/quantm-zeus/private-execution-platform)  
**Canonical development branch:** `quantm-zeus/private-execution-platform:main`

## Status

Foresift has been migrated into PEP and is retired as a standalone active project.
This repository is retained as a historical source, audit trail, and recovery reference.
New product development, fixes, deployment work, and operational ownership should continue in PEP rather than this repository.

The last pre-handoff Foresift `main` commit was:
`27c12c8ea5ef730b052203964168ef60e75cc654`.

## Preservation performed before VPS retirement

Before deleting the VPS working copies, all committed local branches were pushed to GitHub where possible.
Two local branch tips that could not fast-forward their already-advanced remote counterparts were preserved under dedicated archive refs instead of force-pushing.
In addition, 28 dirty historical worktree states were snapshotted as commits and pushed under:

`archive/vps-cleanup-20260919/*`

The archival snapshots intentionally exclude transient caches, `node_modules`, review temp data, logs, and secret-like files such as `.env`, PEM, or key files.

Archive branches may contain stale, partial, experimental, or conflicted work-in-progress.
They exist for recovery and forensic reference and should not be merged into PEP or Foresift `main` without review.

## Operational handoff

The standalone Foresift runtime on the VPS is retired as part of this handoff.
Foresift/Archon/DeepSeek-specific services, timers, tmux sessions, worktrees, dependency trees, caches, and clearly Foresift-specific container artifacts are removed after remote preservation is verified.
Shared services and the PEP workspace are outside the cleanup scope and must remain intact.

## Recovery

To recover historical Foresift work:

1. Clone `https://github.com/quantm-zeus/foresift`.
2. Start from `main` for the final canonical Foresift state.
3. Inspect `archive/vps-cleanup-20260919/*` only when historical uncommitted VPS state is needed.
4. Port any intentionally recovered change into PEP through normal review rather than reviving the retired Foresift runtime.

## Ownership going forward

PEP is the source of truth for continued implementation and operations:
`https://github.com/quantm-zeus/private-execution-platform`.
