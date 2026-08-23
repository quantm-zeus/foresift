---
description: Final deterministic gate, exact-head CI wait, and machine squash merge
argument-hint: <package-id>
---

# Foresift work-package final gate → CI → merge

**Package**: $ARGUMENTS
**Workflow artifacts**: $ARTIFACTS_DIR

You are the release executor. Determinism and honesty outrank speed: never merge
on a red or unverified state, and never fake evidence.

## 1. Final deterministic verification (blocking)

Run `pnpm foresift:gate --package $ARGUMENTS` from the working tree.
If it fails: do NOT merge; fix forward only if the cause is trivial (typos,
formatting); otherwise push corrections (`git push`, normal push) re-run the gate,
and if it still fails end your reply with `MERGE_BLOCKED: <reason>`.

## 2. Push and confirm PR

- `git push origin foresift/$ARGUMENTS` (never force).
- Find the open PR for the branch (`gh pr list --head ... --state open`). Record
  its head SHA: `git rev-parse HEAD`.

## 3. Exact-head CI (the final deterministic merge gate)

- Wait for CI on the exact head SHA:
  `gh pr checks <number> --repo quantm-zeus/foresift --watch --interval 30`
  with an overall bound of ~45 minutes.
- If all required checks pass on that SHA → step 4.
- If any check FAILED → fetch failing logs (`gh run view --log-failed`), fix,
  commit additively, push, and repeat step 3 (bounded by ~3 fix attempts).
- If GitHub Actions cannot start jobs at all — the run fails within seconds with
  the annotation "The job was not started because recent account payments have
  failed or your spending limit needs to be increased" (a known account-billing
  blocker recorded in docs/setup/BOOTSTRAP_REPORT.md) — apply the documented
  fallback ONCE per attempt:
  a) comment on the PR stating that exact-head CI was unavailable due to the
     account billing block (include the failed run URL);
  b) perform the clean-room equivalent deterministically:
     `git clone --no-local . /tmp/foresift-cleanroom-$$ && cd /tmp/foresift-cleanroom-$$ && git checkout <head-sha> && corepack pnpm install --frozen-lockfile && pnpm verify`
     (use a fresh directory each time; delete it afterwards);
  c) proceed to merge ONLY if the clean-room verify passed;
  d) note the fallback use in the merge commit body via the PR comment.
  This fallback exists solely while Actions is billing-blocked; when Actions
  works, it must never trigger.

## 4. Machine squash merge (no human approval)

```
gh pr merge <number> --repo quantm-zeus/foresift --squash --delete-branch
```

If the CLI refuses because of transient API errors, retry a few times with short
delays; if it refuses for a structural reason (merge conflict, base protection),
resolve conflicts per the bundled conflict-resolution approach or end with
`MERGE_BLOCKED: <reason>`. NEVER force-push, NEVER amend, NEVER rebase published
branches.

## 5. Report

End your reply with: merged PR URL + merge commit SHA + which gate path ran
(normal CI vs documented billing fallback).
