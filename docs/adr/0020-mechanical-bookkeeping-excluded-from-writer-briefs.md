# ADR 0020: Mechanical bookkeeping units are coordinator-owned and excluded from writer briefs

Date: 2026-08-30
Status: Accepted
Deciders: Foresift control-plane maintainer (persistent maintenance mission, per operating contract)

## Context

Since PR #97 the sharded-wave **prep** step regenerates
`evidence/bun-migration/bun-migration-manifest.json` mechanically (zero-AI)
whenever tests/packages/apps are dirty. However, the implementation task graph
still carried the legacy unit T063 — "regenerate the coordinator test manifest"
— whose body names the manifest path, and the writer-brief builder passed that
unit verbatim into the AGY test-author brief.

The wave-authority law (`wave-guard.mjs` + `path-ownership.mjs`) legally
refuses any AGY test lane write to `evidence/bun-migration/` — it is a
coordinator-owned path, and writing it is classified
`AGY_PRODUCT_OWNERSHIP_VIOLATION`. The wave therefore ran a deterministic
non-convergence: AGY attempted the manifest task, the guard refused the lane
closed, and the fast-repair loop could not fix it (the repair is also denied
that path). Observed live on runs 9cf2bf57 and 0b4838ae (2026-08-29/30), each
exhausting recovery to a fatal pause.

## Decision

1. `build-writer-briefs.mjs` classifies a unit as **mechanical bookkeeping**
   when its body names the coordinator manifest
   (`evidence/bun-migration/bun-migration-manifest.json`).
2. Mechanical units are **excluded from every writer brief** (implementation
   lanes included). The brief states this explicitly: "Mechanical bookkeeping
   units EXCLUDED from this brief (coordinator-owned, zero-AI): <ids>. Do NOT
   attempt them; the coordinator regenerates the test manifest mechanically
   after the wave."
3. The manifest regen itself stays in wave prep (PR #97) — never a writer
   duty, never a repair-loop duty.

## Consequences

- Writers can no longer be handed an unwritable task; the AGY lane fails
  closed only on genuine ownership violations.
- If a wave's plan introduces NEW coordinator-managed bookkeeping paths, the
  classification predicate must be extended in the same change that moves the
  duty to prep — otherwise the violation reappears for the new path.
- The task graph still lists mechanical units (for completeness); only the
  briefs filter them. `wave-guard` behavior is unchanged: it recomputes diffs
  from git and remains the final authority.
