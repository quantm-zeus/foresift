#!/usr/bin/env bash
# Foresift maintainer watcher (directive §12/§13, zero AI). Recreates exactly
# ONE maintainer tmux session resuming the durable receipt's Claude session,
# only when: no live maintainer exists, intentionalStop != true, and the
# receipt names an active project state. Bounded: one start attempt per probe
# (systemd timer cadence provides the backoff); flock guarantees singleton.
#
# 2026-09-08 incident (P2): with remain-on-exit on, a dead pane keeps the
# SESSION alive — `has-session` succeeds while pane_dead=1, and send-keys to
# a dead pane is a SILENT NO-OP. The watcher then logged a "relaunch" every
# probe for 2h35m (21:00→23:25) while no Claude existed. The watcher must
# (a) treat pane_dead=1 as absence, (b) respawn via `respawn-pane` (which
# replaces the dead pane's process directly, no tty typing), and (c) verify
# a Claude child actually materialized before logging success.
set -euo pipefail
RECEIPT="$HOME/.local/state/foresift/maintainer/receipt.json"
# Lock overridable ONLY for hermetic selftests
# (FORESIFT_MAINTAINER_WATCHER_LOCK); production default is the shared probe
# lock, so concurrent probes still serialize through flock.
LOCK="${FORESIFT_MAINTAINER_WATCHER_LOCK:-/run/user/$(id -u)/foresift-maintainer-watcher.lock}"
SESSION="foresift-maintainer"
LOG="$HOME/.local/state/foresift/maintainer/watcher.log"
# Dedicated socket: the maintainer tmux server lives in its OWN systemd unit
# cgroup (foresift-maintainer-tmux.service) — never inside the agy daemon's
# control group, whose midnight update restart killed the server (and every
# Claude maintainer in it) three nights running.
# Socket overridable ONLY for hermetic selftests (FORESIFT_MAINTAINER_TMUX_SOCKET);
# production default is the dedicated maintainer socket.
TMUX="tmux -L ${FORESIFT_MAINTAINER_TMUX_SOCKET:-foresift-maintainer}"

# Incident B (2026-09-10): tmux panes inherit a minimal PATH WITHOUT
# ~/.local/bin, so a bare `claude` respawn dies 127 (status "pane_dead") and
# the watcher loop fails. Resolve the binary deterministically, ONCE, before
# any spawn: explicit $CLAUDE_BIN wins, then PATH lookup, then the well-known
# install path. Every candidate is validated executable; when NOTHING
# resolves, fail LOUD (exit 1 + log line) instead of spawning a corpse pane.
resolve_claude_bin() {
  local candidate
  for candidate in "${CLAUDE_BIN:-}" "$(command -v claude 2>/dev/null || true)" \
    "$HOME/.local/bin/claude"; do
    if [ -n "$candidate" ] && [ -x "$candidate" ]; then
      printf '%s' "$candidate"
      return 0
    fi
  done
  return 1
}
CLAUDE_BIN_RESOLVED="$(resolve_claude_bin)" || true

exec 9>"$LOCK"
flock -n 9 || exit 0  # another probe is running

note() { echo "$(date -u +%FT%TZ) watcher: $*" >> "$LOG"; }

if [ -z "${CLAUDE_BIN_RESOLVED:-}" ]; then
  note "FATAL: no executable claude binary (CLAUDE_BIN/command -v/\$HOME/.local/bin/claude) — refusing to spawn; operator inspection needed"
  exit 1
fi

[ -f "$RECEIPT" ] || exit 0
INTENTIONAL_STOP=$(jq -r '.intentionalStop // false' "$RECEIPT")
[ "$INTENTIONAL_STOP" = "true" ] && exit 0
SESSION_ID=$(jq -r '.currentClaudeSessionId // empty' "$RECEIPT")
[ -n "$SESSION_ID" ] || exit 0
REPO=$(jq -r '.repo' "$RECEIPT")
# Project has active/pending work? (milestone JSON on the checkout decides)
MS="$REPO/specs/implementation/current-milestone.json"
[ -f "$MS" ] || exit 0
# grep exits 1 when it matches nothing (a milestone with zero PROVEN packages
# is a legal pre-proven state) — neutralize so pipefail doesn't kill the probe.
PROVEN=$(grep -o '"status": *"PROVEN"' "$MS" | wc -l || true)
TOTAL=$(grep -o '"id": *"g[01]-' "$MS" | wc -l || true)
if [ -n "$TOTAL" ] && [ "$TOTAL" -gt 0 ] && [ "$PROVEN" -eq "$TOTAL" ]; then
  exit 0  # milestone complete — never respawn
fi

# Live maintainer already exists? (claude process resuming the session id —
# anywhere on the host; this is the no-duplicate-maintainer proof)
if pgrep -f "claude --resume $SESSION_ID" >/dev/null 2>&1; then
  exit 0
fi

if ! $TMUX has-session -t "$SESSION" 2>/dev/null; then
  $TMUX new-session -d -s "$SESSION" -c "$REPO" -x 160 -y 50 \
    "$CLAUDE_BIN_RESOLVED --resume $SESSION_ID"
  note "recreated tmux $SESSION resuming $SESSION_ID via $CLAUDE_BIN_RESOLVED"
  exit 0
fi

# Session exists. A pane dead under remain-on-exit makes send-keys a silent
# no-op (2026-09-08: 2h35m of no-op relaunches) — detect and respawn the pane
# process instead of typing into a corpse. A LIVE pane with no Claude inside
# (e.g. sitting at a shell) still gets send-keys, but with post-launch
# verification.
PANE="$SESSION:0.0"
DEAD=$($TMUX display-message -p -t "$PANE" '#{pane_dead}' 2>/dev/null || echo 1)
if [ "$DEAD" = "1" ]; then
  $TMUX respawn-pane -k -t "$PANE" -c "$REPO" "$CLAUDE_BIN_RESOLVED --resume $SESSION_ID" 2>/dev/null \
    || $TMUX respawn-pane -k -t "$PANE" "$CLAUDE_BIN_RESOLVED --resume $SESSION_ID" 2>/dev/null || {
      note "respawn-pane FAILED for dead pane $PANE — operator inspection needed"
      exit 1
    }
  note "respawned dead pane $PANE resuming $SESSION_ID via $CLAUDE_BIN_RESOLVED (pane_dead=1)"
else
  $TMUX send-keys -t "$PANE" "$CLAUDE_BIN_RESOLVED --resume $SESSION_ID" C-m 2>/dev/null || true
  note "relaunched claude $SESSION_ID into live $SESSION via $CLAUDE_BIN_RESOLVED"
fi

# Post-launch verification (bounded): a Claude child must materialize, else
# the failure is logged LOUDLY instead of being reported as success.
for _ in 1 2 3 4 5 6; do
  sleep 5
  if pgrep -f "claude --resume $SESSION_ID" >/dev/null 2>&1; then
    note "verified: claude $SESSION_ID is up"
    exit 0
  fi
done
note "VERIFY FAILED: no claude --resume $SESSION_ID 30s after launch attempt"
exit 1
