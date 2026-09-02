# ADR-0021: Archon loads workflow YAML from the discovery root, not run worktrees

## Status

Accepted (recorded 2026-09-02 after two live confirmations)

## Context

Foresift runs Archon workflows (`foresift-sharded-wave`,
`foresift-milestone-control`, …) against per-run worktrees. Workflow
definitions live in `.archon/workflows/foresift/*.yaml` — but **Archon
resolves those files from the DISCOVERY ROOT** (the registered codebase root:
the primary tree `/home/minhquan_eth/foresift`), never from the run worktree
the workflow's bash nodes `cd` into.

Two live confirmations:

1. Run 7c98e02e (2026-09-02): the repair-loop convergence fix
   (`CODEX_REPAIR_EXHAUSTED` must defer to `fast-recheck`, not abort the
   iteration) was first applied ONLY to the task worktree's yaml. Resume #4
   failed identically — the engine was still reading the old yaml from the
   primary tree. Landing the same change in the primary tree (PR #152)
   fixed the resume.
2. Workflow bash nodes execute with `cwd` = the run worktree, while node
   resolution (`bash:` scripts, `until_bash` guards) happens engine-side
   against the discovery root's file. A worktree yaml is inert for engine
   behavior; only its _content on disk in the primary tree_ matters.

## Decision

- Workflow YAML changes MUST land in the primary tree's
  `.archon/workflows/foresift/` to take effect for any future run or resume.
  Worktree copies are shadows only and must not be treated as authoritative.
- When a run worktree carries newer yaml than the primary tree (e.g. a wave
  edited its own workflow), recovery/repair must first land the yaml through
  the normal PR path to main, then resume the run.
- Resume/relaunch decisions must re-read the discovery-root yaml; assuming a
  worktree edit is live is a defect class.

## Consequences

- Single source of truth for engine behavior; no split-brain between engine
  and worktree yaml.
- Fixes that appear "already applied" in a worktree may still be missing
  from the engine — verify against the primary tree before diagnosing a
  resume failure.
- Mirrors the existing control-plane boundary: the supervisor (primary tree)
  drives archon (discovery root), while product work happens in worktrees.
