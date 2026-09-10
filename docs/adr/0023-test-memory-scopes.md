# ADR-0023: Coordinator test groups run in memory-bounded systemd scopes

Status: accepted (2026-09-10).

## Context

Kernel OOM at 2026-09-10 19:24:26 UTC killed `bun` (pid 3695090) at ~9.55 GiB
anon RSS. The process was a bare `bun test tests/acceptance/` run in a
maintainer tmux pane. The pane was supposed to be contained by the maintainer
tmux unit's `MemoryHigh=6G`/`MemoryMax=8G`
(`foresift-maintainer-tmux.service.d/oom-containment.conf`, 2026-09-08) — the
limits never applied.

## Root cause (journal-proven)

tmux requests a **transient per-pane scope** over D-Bus for every child pane:

```
systemd[54527]: Started tmux-spawn-<uuid>.scope - tmux child pane <pid> launched by process <pid>
```

Observed scope properties: `Slice=app.slice`, `Transient=yes`,
`MemoryMax=infinity`, `MemoryHigh=infinity`. Pane processes are therefore
**siblings** of the tmux service unit under `app.slice`, never members of it.
The `oom-containment.conf` limits bind only the tmux SERVER process (~6 MB
RSS) — pane children (Claude, shells, bun test runs) were never bounded.
Containment was placed on the wrong cgroup level.

## Decision

Containment travels **with the command**, not the shell:

1. Every `bun-test-coordinator` group spawns inside its own
   `systemd-run --user --scope` with `MemoryHigh`/`MemoryMax` (policy
   `testMemoryHigh`/`testMemoryMax`, env override
   `FORESIFT_TEST_MEMORY_HIGH`/`_MAX`, defaults `6G`/`8G` — the pane law,
   never higher).
2. The scope unit name pins the coordinator PID
   (`foresift-test-<group>-<pid>`) so concurrent coordinators never collide.
3. The probe runs once per coordinator invocation; hosts without a user bus
   (CI runners without systemd, macOS) fall back to a direct spawn with one
   loud advisory line — function preserved, bounds best-effort.
4. Concurrency stays as-is and bounded (PROCESS/PGLITE/META 1×1, PURE 2×8,
   groups sequential, `--isolate` per file) — pinned by regression.
5. Full suites run ONLY through the coordinator (standing test runtime
   contract); bare `bun test` over large trees remains forbidden.

`detached` + process-group SIGTERM semantics are unchanged: `systemd-run`
does not re-group its scoped child, so group-timeout kills still terminate
the whole bun tree (the drained scope is then collected).

## Consequences

- A repeat of the 9.55 GiB bare-run shape inside a coordinator group hits
  the 8G scope wall (per-group accounting + throttle/kill) instead of the
  host OOM killer.
- `oom-containment.conf` on the tmux service is retained as a (weak)
  backstop for the server itself; its comment now states the pane-scope
  truth instead of claiming pane coverage.
- Ad-hoc heavy commands outside the coordinator remain the operator's
  responsibility: prefer focused specs; full verification only at the final
  gate, via the coordinator.
