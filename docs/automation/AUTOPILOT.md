# Foresift Autopilot — operator guide

The autonomous development loop runs as two systemd **user** services on this
VPS: the Archon dashboard (`archon serve`) and the Foresift autopilot (a thin
supervisory loop over the `archon` CLI). Architecture rationale:
`docs/adr/0001-autonomous-control-plane-architecture.md`.

## What it does

1. Plans the current milestone from the authoritative PRD manifest via
   `foresift-milestone-control` (independent planning review + deterministic
   validation + PR).
2. Implements one work package at a time (two max post-foundation, never
   CRITICAL-parallel, never scope-overlapping) via `foresift-work-package`:
   Spec Kit plan → implement → deterministic gate → PR → independent review →
   bounded convergence → deterministic gate → CI → squash merge.
3. Marks packages PROVEN only when their PR is actually merged; audits each
   milestone independently before declaring it proven.

## Commands

| Task                                  | Command                                                                              |
| ------------------------------------- | ------------------------------------------------------------------------------------ |
| Live status (roadmap/milestone/runs)  | `pnpm autopilot:status`                                                              |
| Supervisor self-test (hermetic)       | `pnpm autopilot:selftest`                                                            |
| Deterministic package gate            | `pnpm foresift:gate -- --package <id>`                                               |
| Service status                        | `systemctl --user status foresift-autopilot archon-dashboard`                        |
| Supervisor logs                       | `journalctl --user -u foresift-autopilot.service -f`                                 |
| Dashboard logs                        | `journalctl --user -u archon-dashboard.service -f`                                   |
| Pause after fatal error is cleared by | `node scripts/automation/foresift-autopilot.mjs --clear-fatal` then restart the unit |

## Archon Web UI

Binds to loopback only. From your laptop:

```
ssh -L 3090:127.0.0.1:3090 <user>@<vps>
# then open http://127.0.0.1:3090
```

## Runtime state

`~/.local/state/foresift/` holds the supervisor's runtime bookkeeping
(`autopilot-state.json`, lock). It contains no secrets and nothing durable —
durable truth lives in git (`specs/implementation/`) and Archon's own records.
Delete the directory only while the autopilot service is stopped.

## Recovery policy (automatic)

- Transient failures (timeouts, 429/5xx, connection resets): up to 3
  `archon workflow resume` attempts with exponential backoff.
- Unknown failures: 1 resume, then 1 fresh restart on the same branch/worktree.
- Fatal failures (auth, quota): supervisor enters PAUSED_FATAL immediately and
  stops issuing commands until an operator clears it.
- Stale runs (>90 min without activity): abandoned via `archon workflow
abandon`, then relaunched on the same branch. The supervisor never touches
  Archon's database directly.

## Upgrade policy

After upgrading Archon, Claude Code, or Node:

```
archon validate workflows
rm -rf /tmp/foresift-smoke
archon workflow run foresift-smoke-resume          # expect failed
archon workflow resume <run-id>                    # expect completed
pnpm autopilot:selftest
```

Only then restart the services.

## Pinned versions

| Component                     | Version                                    |
| ----------------------------- | ------------------------------------------ |
| Node.js                       | v24.19.0 (`~/.nvm/versions/node/v24.19.0`) |
| pnpm                          | 11.22.0 (via corepack)                     |
| Archon CLI                    | 0.9.0 (build 671e2ee7)                     |
| Claude Code CLI               | 2.1.240 (`~/.local/bin/claude`)            |
| GitHub Spec Kit (specify-cli) | 1.0.1                                      |
