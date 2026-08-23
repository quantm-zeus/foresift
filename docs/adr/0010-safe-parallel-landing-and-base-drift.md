# ADR-0010: Safe parallel landing and the base-drift contract

- **Status:** Accepted
- **Date:** 2026-08-23
- **Deciders:** Foresift V3 control-plane mission (task spec §11)
- **Scope:** Control plane only — landing mechanics; no product behavior, no
  change to the read-only product boundary.

## Context

Generation ≥ 1 runs up to `maxParallelCodingPackages` work packages at once.
Two packages seeded from the same `origin/main` tip can finish near each other;
when package A squash-merges, main advances and package B's branch — seeded
AND full-gate-validated against the OLD main — becomes a moving-world merge:
GitHub may happily run B's CI green against its own merge ref, but the merged
result joins a main that none of B's evidence ever covered. Before V3-D the
only guard was the lander's indirect `no-check-runs` diagnostic (the silent-CI
squash-base trap), which catches some cases late and none of them honestly.

## Decision

1. **Attestations carry base identity.** The FULL-gate attestation records
   `baseMainSha` (the local remote-tracking view of `origin/main` at gate
   time; injectable for hermetic fixtures, null when the ref does not exist).
   `--check` treats a changed base as drift: evidence is reusable ONLY while
   main is unchanged. No network fetch happens inside attestation hashing —
   freshness comes from the landing path, which fetches before any re-check.
2. **A branch lands only while it carries current main.** Admission predicate:
   `merge-base --is-ancestor <origin/main> <head>` must hold. After a sibling
   lands this is false until the branch explicitly reconciles by merging
   updated `origin/main` in — an ordinary forward merge commit (new head ⇒ new
   CI ⇒ fresh FULL gate). Rebases and force-pushes remain banned by the git
   history contract; reconciliation is additive.
3. **Enforcement points, in order of authority.**
   - The mechanical lander (`package-land.mjs`) enforces admission TWICE:
     before pushing (fast fail — no PR is even created) and immediately before
     the squash-merge (closing the TOCTOU window where a sibling merges while
     CI runs). Verdict: `{merged:false, reason:"base-drift"}`, exit 1.
   - `package-final-land.mjs` gains an advisory admission step BEFORE gate
     work: when drift is provable it refuses (`base-drift`, exit 4) so a FULL
     gate is never burned on a doomed landing; when the environment cannot
     prove anything (fixtures, no remote) it proceeds ADVISORY-OK because the
     lander stays the fail-closed authority.
4. **Reconciliation guidance** is embedded in every refusal detail: merge
   updated origin/main into the branch (normal commit), which yields a new
   head, fresh exact-head CI, and a fresh attestation whose base equals the
   world actually joined.

## Consequences

- Parallel throughput keeps its ceiling while eliminating stale-base merges;
  worst case for a waiter after a sibling lands is one reconcile-merge plus a
  fresh FULL gate — the honest price of joining a changed world.
- Attestations written before this ADR lack `baseMainSha`; against any
  resolved base they now fail reuse (fail-closed) and simply trigger one
  fresh FULL run.
- The lander refuses (rather than retries) on unverifiable origins; landing
  requires a resolvable origin anyway (exact-head CI), so leniency would only
  hide real breakage.

## Verification

- `tests/automation/v3-base-drift.spec.ts` — pure verdicts; ancestor
  semantics incl. unverifiable⇒null; attestation records/invalidates
  `baseMainSha` (incl. legacy-record fail-closed); END-TO-END lander fixtures
  over real git repos + sibling bare origins + stub gh: pre-push refusal (no
  PR created, no merge attempted), happy landing with `base-admitted` trace,
  and TOCTOU closure (main advances DURING the CI wait ⇒ pre-merge re-check
  refuses); final-land routes (drift ⇒ refuse before gates; advisory ⇒ normal
  reuse route).
