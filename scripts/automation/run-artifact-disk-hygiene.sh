#!/usr/bin/env bash
# Foresift run-artifact disk hygiene (2026-09-09 directive). / reached 86% with
# ~12.5GB of stale Archon run lane-worktrees whose content is squash-merged
# into origin/main. This guard prunes ONLY:
#   - lane worktrees (runs/<id>/wt/<lane>/) of runs whose package is PROVEN
#     in the current milestone,
#   - untouched for >=48h,
#   - with a CLEAN git status (any dirty lane is KEPT as evidence),
# and never touches: protected in-flight runs, briefs/results/logs evidence,
# dirty lanes, non-Foresift projects. Logs its actions to
# ~/.local/state/foresift/disk/hygiene.log for audit.
set -uo pipefail
RUNS="$HOME/.archon/workspaces/quantm-zeus/foresift/artifacts/runs"
REPO="$HOME/foresift"
LOG="$HOME/.local/state/foresift/disk/hygiene.log"
MIN_FREE_PCT=15   # alert threshold (df capacity)
mkdir -p "$(dirname "$LOG")"
note() { echo "$(date -u +%FT%TZ) hygiene: $*" >> "$LOG"; }

[ -d "$RUNS" ] || exit 0
git -C "$REPO" fetch -q origin main 2>/dev/null || true

# Map runs -> packages (evidence files), reuse identical law as the 2026-09-09 manual prune.
python3 - "$RUNS" "$REPO" <<'PYEOF' >> "$LOG" 2>&1
import os, sys, time, json, re, subprocess
RUNS, REPO = sys.argv[1], sys.argv[2]
ms_path = os.path.join(REPO, 'specs', 'implementation', 'current-milestone.json')
try:
    ms = json.load(open(ms_path))
    proven = {p['id'] for p in ms.get('packages', []) if p.get('status') == 'PROVEN'}
except Exception:
    proven = set()
protect = set()  # runs modified in the last 48h are protected by the mtime rule anyway
def pkg_of(r):
    for name in ('execution-identity.json',):
        p = os.path.join(RUNS, r, name)
        if os.path.exists(p):
            try:
                j = json.load(open(p))
                v = j.get('packageId') or (j.get('identity') or {}).get('packageId')
                if v: return v
            except Exception: pass
    b = os.path.join(RUNS, r, 'briefs')
    if os.path.isdir(b):
        for f in sorted(os.listdir(b))[:2]:
            try:
                m = re.search(r'brief — (\S+)', open(os.path.join(b, f), errors='replace').read(400))
                if m: return m.group(1)
            except Exception: pass
    return None
pruned = freed = dirty = 0
for r in sorted(os.listdir(RUNS)):
    pkg = pkg_of(r)
    if pkg not in proven: continue
    wtb = os.path.join(RUNS, r, 'wt')
    if not os.path.isdir(wtb): continue
    for d in sorted(os.listdir(wtb)):
        lane = os.path.join(wtb, d)
        if not (os.path.isfile(os.path.join(lane, '.git')) or os.path.isdir(os.path.join(lane, '.git'))): continue
        try:
            if time.time() - os.path.getmtime(lane) < 48 * 3600: continue
            dirtyOut = subprocess.run(['git', '-C', lane, 'status', '--porcelain'], capture_output=True, text=True, timeout=60).stdout.strip()
        except Exception: continue
        if dirtyOut:
            dirty += 1; continue
        try:
            size = int(subprocess.run(['du', '-sm', lane], capture_output=True, text=True).stdout.split()[0] or 0)
        except Exception: size = 0
        subprocess.run(['git', '-C', REPO, 'worktree', 'remove', '--force', lane], capture_output=True)
        if os.path.isdir(lane): subprocess.run(['rm', '-rf', lane], capture_output=True)
        pruned += 1; freed += size
print(f'pruned {pruned} lane worktrees, freed ~{freed} MB, kept {dirty} dirty as evidence')
PYEOF
df -h / | tail -1 >> "$LOG"
exit 0
