# Foresift Autopilot — operator guide

The autonomous development loop runs as two systemd **user** services on this
VPS: the Archon dashboard (`archon serve`) and the Foresift autopilot (a thin
supervisory loop over the `archon` CLI). Architecture rationale:
`docs/adr/0001-autonomous-control-plane-architecture.md`.

> **Hardening note (2026-08-22):** the continuation-loop hardening pass made
> every long workflow stage a bounded fresh-context loop under a deterministic
> `until_bash` completion guard, fixed detached run-ID discovery (no duplicate
> launches, no `PENDING→RUNNING` without a durable Archon run id), normalized
> all timestamp handling, and made corrupt implementation state fail closed.
> See `docs/setup/BOOTSTRAP_REPORT.md` for the historical setup narrative vs
> current state.

## What it does

1. Plans the current milestone from the authoritative PRD manifest via
   `foresift-milestone-control` (bounded planning loop → independent planning
   review → bounded CRITICAL/HIGH fix loop → deterministic validation loop →
   PR). Audits fully-proven milestones inside a bounded audit loop driven by a
   durable `$ARTIFACTS_DIR/milestone-audit-progress.json`, so audits survive
   any number of Claude turn boundaries.
2. Implements one work package at a time (two max post-foundation, never
   CRITICAL-parallel, never scope-overlapping) via `foresift-work-package`:
   bounded Spec Kit plan loop → bounded implementation loop → deterministic
   gate with bounded repair loop → PR → independent review (CRITICAL/HIGH
   block progression) → bounded convergence loop → deterministic gate → CI →
   squash merge. Loop bounds: planning 4 iterations, implementation 12,
   gate repair 4; each iteration gets a fresh context and continues persisted
   work from disk/git — never conversational memory.
3. Marks packages PROVEN only when their PR is actually merged; audits each
   milestone independently before declaring it proven.

## Continuation without humans

A Claude turn ending cleanly is NOT stage completion. Long stages run as
Archon `loop_group`s whose completion is decided ONLY by a deterministic
`until_bash` guard (the `until` text signals are sentinels agents are
instructed never to emit). When a guard fails, Archon automatically starts
another iteration — nobody types "continue". Two smoke workflows prove this
continuously after any upgrade:

| Smoke test                  | Property proved                                                                               |
| --------------------------- | --------------------------------------------------------------------------------------------- |
| `foresift-smoke-clean-turn` | iteration 1 exits cleanly incomplete → iteration 2 auto-starts from disk state → guard passes |
| `foresift-smoke-resume`     | process failure mid-run → `workflow resume` skips completed nodes and finishes                |

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

`pnpm autopilot:status` reports, per tracked run: durable run id (or
`discovering-run-id`), Archon status, current DAG node and loop iteration
(parsed from Archon's structured JSONL event log), resume/restart counts, and
idle minutes; plus roadmap/milestone progress, PAUSED_FATAL reason when set,
and the next eligible package.

## Archon Web UI

Binds to loopback only. From your laptop:

```
ssh -L 3090:127.0.0.1:3090 <user>@<vps>
# then open http://127.0.0.1:3090
```

### Publishing over public HTTPS (paused as of 2026-08-22)

The sanctioned path is `ops/dashboard/deploy-public-dashboard.sh`: Caddy TLS edge
(Let's Encrypt shortlived IP certificate via certbot ≥5.4 `--ip-address`
webroot flow) + `basic_auth` (Argon2id; plaintext password lives only in
`~/.local/state/foresift/dashboard-credentials`, mode 0600) reverse-proxying to
loopback-only `:3090`. It is idempotent and fails closed until BOTH GCP
prerequisites exist: the external IP reserved as static and inbound tcp/80
open (ACME HTTP-01). Both currently require an identity with compute.admin;
exact commands are printed by the script and recorded in the bootstrap report.
Raw `:3090` must never be exposed.

## Runtime state

`~/.local/state/foresift/` holds the supervisor's runtime bookkeeping
(`autopilot-state.json`, lock). It contains no secrets and nothing durable —
durable truth lives in git (`specs/implementation/`) and Archon's own records.
Delete the directory only while the autopilot service is stopped.

Launch bookkeeping is crash-safe: a detached launch whose ack carries no run
id is tracked immediately as `awaitingDiscovery` and reconciled against the
runs table (bounded retries); exhaustion pauses fatally instead of risking a
duplicate launch. A package's status only ever becomes RUNNING once its run id
is durably known. Corrupt `specs/implementation/*.json` pauses the supervisor
(`PAUSED_FATAL`) rather than re-planning over damaged state.

## Restart safety

`foresift-autopilot.service` sets `KillMode=process`: stopping or restarting
the unit never kills in-flight detached workflow runs (they are children of
the service's cgroup, so the default kill mode would orphan them as stuck
"running" rows). The next supervisor instance re-adopts tracked runs from the
runtime state file. The dashboard unit intentionally keeps the default kill
mode — it owns nothing worth preserving across a restart.

## Recovery policy (automatic)

- Transient failures (timeouts, 429/5xx, connection resets): up to 3
  `archon workflow resume` attempts with exponential backoff.
- Unknown failures: 1 resume, then 1 fresh restart on the same branch/worktree.
- Fatal failures (auth, quota): supervisor enters PAUSED_FATAL immediately and
  stops issuing commands until an operator clears it.
- Stale runs (>90 min without activity): abandoned via `archon workflow
abandon`, then relaunched on the same branch. The supervisor never touches
  Archon's database directly.
- Unparsable activity timestamps: one-time diagnostic event; the run is kept
  alive (never abandoned on bad data).
- Undiscoverable launches (no run id after bounded discovery): PAUSED_FATAL —
  fail closed, never a blind relaunch.

## Upgrade policy

After upgrading Archon, Claude Code, or Node:

```
archon validate workflows
pnpm autopilot:selftest
rm -rf /tmp/foresift-smoke-clean
archon workflow run foresift-smoke-clean-turn       # expect completed (>=2 iterations)
rm -rf /tmp/foresift-smoke-resume && archon workflow run foresift-smoke-resume
archon workflow get <run-id> --json                 # expect failed (attempt 1)...
archon workflow resume <run-id>                     # ...then completed
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
