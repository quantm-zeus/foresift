#!/usr/bin/env bash
# Foresift maintainer watcher (directive §12/§13, zero AI). Recreates exactly
# ONE maintainer tmux session resuming the durable receipt's Claude session,
# only when: no live maintainer exists, intentionalStop != true, and the
# receipt names an active project state. Bounded: one start attempt per probe
# (systemd timer cadence provides the backoff); flock guarantees singleton.
set -euo pipefail
RECEIPT="$HOME/.local/state/foresift/maintainer/receipt.json"
LOCK="/run/user/$(id -u)/foresift-maintainer-watcher.lock"
SESSION="foresift-maintainer"
# Dedicated socket: the maintainer tmux server lives in its OWN systemd unit
# cgroup (foresift-maintainer-tmux.service) — never inside the agy daemon's
# control group, whose midnight update restart killed the server (and every
# Claude maintainer in it) three nights running.
TMUX="tmux -L foresift-maintainer"
exec 9>"$LOCK"
flock -n 9 || exit 0  # another probe is running

[ -f "$RECEIPT" ] || exit 0
INTENTIONAL_STOP=$(jq -r '.intentionalStop // false' "$RECEIPT")
[ "$INTENTIONAL_STOP" = "true" ] && exit 0
SESSION_ID=$(jq -r '.currentClaudeSessionId // empty' "$RECEIPT")
[ -n "$SESSION_ID" ] || exit 0
REPO=$(jq -r '.repo' "$RECEIPT")
# Project has active/pending work? (milestone JSON on the checkout decides)
MS="$REPO/specs/implementation/current-milestone.json"
[ -f "$MS" ] || exit 0
PROVEN=$(grep -o '"status": *"PROVEN"' "$MS" | wc -l)
TOTAL=$(grep -o '"id": *"g[01]-' "$MS" | wc -l)
if [ -n "$TOTAL" ] && [ "$TOTAL" -gt 0 ] && [ "$PROVEN" -eq "$TOTAL" ]; then
  exit 0  # milestone complete — never respawn
fi

# Live maintainer already exists? (claude process resuming the session id)
if pgrep -f "claude --resume $SESSION_ID" >/dev/null 2>&1; then
  exit 0
fi
# Session alive in tmux but Claude died inside? Recreate the window.
if ! $TMUX has-session -t "$SESSION" 2>/dev/null; then
  $TMUX new-session -d -s "$SESSION" -c "$REPO" -x 160 -y 50 \
    "claude --resume $SESSION_ID"
  # Persist a wake receipt line (append; fingerprint dedupe upstream)
  echo "$(date -u +%FT%TZ) watcher: recreated tmux $SESSION resuming $SESSION_ID" \
    >> "$HOME/.local/state/foresift/maintainer/watcher.log"
  exit 0
fi
# tmux exists but no claude in it: launch claude into the live session
$TMUX send-keys -t "$SESSION" "claude --resume $SESSION_ID" C-m 2>/dev/null || true
echo "$(date -u +%FT%TZ) watcher: relaunched claude $SESSION_ID into live $SESSION" \
  >> "$HOME/.local/state/foresift/maintainer/watcher.log"
