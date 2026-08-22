# ADR-0002: Deterministic clean-room fallback when GitHub Actions is unavailable

- Status: Accepted
- Date: 2026-08-22
- Deciders: Foresift autonomous bootstrap session (owner-directed)

## Context

GitHub Actions on this account is currently blocked by a billing/spending-limit
condition: jobs die within seconds of launch ("The job was not started because
recent account payments have failed or your spending limit needs to be
increased"), confirmed persistent across reruns. The product contract requires
that source reaches `main` only through PRs with passing CI. Waiting for the
billing fix would stall all autonomous progress; skipping verification would
violate the completion standard.

## Decision

While Actions is unavailable (and only then), both merge-path commands
(`foresift-wp-ci-merge`, `foresift-mc-land`) follow a disclosed fallback:

1. Attempt exact-head CI as normal, bounded (~45 min), ≤3 fix attempts.
2. If CI cannot start due to the billing block:
   - post a PR comment stating that CI was unavailable and the fallback ran,
     including the failing run URL;
   - perform a **clean-room verification**: fresh `git clone` of the repository,
     `git checkout <exact head SHA>`, `corepack pnpm install --frozen-lockfile`,
     `pnpm verify` (spec:verify + format + lint + typecheck + tests);
   - merge (`gh pr merge --squash`) only if the clean-room run passed;
   - record the fallback usage in the merge report.
3. Any other failure still blocks the merge.

## Consequences

- Verification strength is preserved deterministically (same commands, same
  lockfile, same commit) but loses CI's independent-host property temporarily.
- Every fallback use is visible in the PR timeline; when Actions billing is
  repaired, the fallback path becomes dead code and normal CI resumes as the
  sole gate.
