# OOM containment (2026-09-08/09 incident)

Kernel OOM killed `bun` three times on 2026-09-08 (19:34 anon-rss 5.47GB,
20:09 9.79GB, 20:56 9.79GB — the last inside a tmux-spawn scope, taking the
maintainer pane at 20:57:50). Root pattern: `bun test` over wide globs
accumulates PGlite instances in one process; RSS grows to 5–10GB and the
GLOBAL oom-killer fires, threatening the control plane and the maintainer.

## Durable containment (installed on the host, mirrored here)

1. `foresift-autopilot.service.d/oom-containment.conf` → MemoryHigh=10G,
   MemoryMax=12G. Every detached Archon run (and its writers/tests) lives in
   this cgroup (KillMode=process), so a runaway test now hits a kernel-enforced
   wall instead of a host-wide OOM. The supervisor (~50MB) and dashboard
   (~4MB) are unaffected.
2. `foresift-maintainer-tmux.service.d/oom-containment.conf` → MemoryHigh=6G,
   MemoryMax=8G for the maintainer pane's own heavy commands.
3. `foresift-disk-hygiene.{service,timer}` (this repo:
   `scripts/automation/run-artifact-disk-hygiene.sh`) prunes lane worktrees of
   PROVEN-package runs older than 48h with CLEAN git status every 6h; dirty
   lanes and all evidence files are kept.

Install: copy the drop-ins to
`~/.config/systemd/user/<unit>.d/oom-containment.conf`, then
`systemctl --user daemon-reload && systemctl --user restart <unit>`.
