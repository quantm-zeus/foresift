#!/usr/bin/env bash
# Hermetic selftest for scripts/automation/foresift-autopilot.mjs.
#
# Proves the supervisor contract with a fixture repo + stub archon/git/gh CLIs:
#   S1  dependency ordering, G0 concurrency limit 1, PROVEN finalize, status UX
#   S2  transient-failure resume loop -> bounded retries -> PAUSED_FATAL -> clear
#   S3  fatal failures pause immediately (no retry hammering)
#   S4  CRITICAL packages never co-run; post-foundation concurrency cap of 2
#   S5  cancelled runs requeue the package; stale runs are abandoned + restarted
#
# No network, no AI spend, no writes outside a mktemp sandbox, no access to the
# real Archon database. Run via `pnpm autopilot:selftest`.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
SBX="$(mktemp -d /tmp/foresift-selftest.XXXXXX)"
trap 'rm -rf "$SBX"' EXIT

PASS=0 FAIL=0
ok() { PASS=$((PASS + 1)); printf '  \033[32m✓\033[0m %s\n' "$1"; }
bad() { FAIL=$((FAIL + 1)); printf '  \033[31m✗\033[0m %s\n' "$1"; }
assert_eq() {
  if [ "$2" = "$3" ]; then ok "$1"; else bad "$1 (expected '$3', got '$2')"; fi
}
assert_match() {
  if printf '%s' "$2" | grep -qE "$3"; then ok "$1"; else bad "$1 — no match for /$3/ in: $(printf '%s' "$2" | head -c 300)"; fi
}

# ── stub CLIs ────────────────────────────────────────────────────────────────
mkdir -p "$SBX/bin"
cat >"$SBX/bin/archon" <<'SHIM'
#!/usr/bin/env bash
# Stub archon CLI driven by $FAKE_SCENARIO vars: STATUS_<run_id_underscored>,
# ERR_<run_id_underscored>, DEFAULT_STATUS, UPDATED_AT_MS. Appends every
# invocation to $FAKE_LOG and lifecycle events to $FAKE_LAUNCHES.
set -u
[ -f "${FAKE_SCENARIO:-}" ] && . "$FAKE_SCENARIO"
echo "$*" >>"${FAKE_LOG:?}"
cmd="${1:-}"; sub="${2:-}"; arg="${3:-}"
case "$cmd/$sub" in
  workflow/run)
    n=$(($(cat "${FAKE_RUNSEQ:?}" 2>/dev/null || echo 0) + 1))
    echo "$n" >"$FAKE_RUNSEQ"
    rid="run-$n"; br=""; ms=""; prev=""
    for a in "$@"; do
      [ "$prev" = "--branch" ] && br="$a"
      [ "$prev" = "--json" ] && ms="$a"
      prev="$a"
    done
    echo "LAUNCH rid=$rid workflow=$arg branch=$br msg=$ms" >>"${FAKE_LAUNCHES:?}"
    if [ "${NO_ACK_ID:-}" = "1" ]; then
      printf '{"ok":true,"action":"run","detached":true,"workflow":"%s"}\n' "$arg"
    else
      printf '{"runId":"%s","status":"started"}\n' "$rid"
    fi
    ;;
  workflow/get)
    k="STATUS_${arg//-/_}"; e="ERR_${arg//-/_}"
    st="${!k:-${DEFAULT_STATUS:-running}}"
    er="${!e:-}"
    ts="${UPDATED_AT_MS:-$(date +%s)000}"
    if [ -n "$er" ]; then
      printf '{"runId":"%s","status":"%s","updatedAt":%s,"error":"%s"}\n' "$arg" "$st" "$ts" "$er"
    else
      printf '{"runId":"%s","status":"%s","updatedAt":%s}\n' "$arg" "$st" "$ts"
    fi
    ;;
  workflow/runs)
    nreads=$(($(cat "${FAKE_RUNSEQ:?}.reads" 2>/dev/null || echo 0) + 1))
    echo "$nreads" >"${FAKE_RUNSEQ:?}.reads"
    printf '{"runs":['
    if [ -f "$FAKE_LAUNCHES" ] && [ "$nreads" -gt "${RUNS_LAG:-0}" ]; then
      tac "$FAKE_LAUNCHES" | awk -v dflt="${DEFAULT_STATUS:-running}" '
        FNR > 1 { printf "," }
        {
          rid = ""; wf = ""; ms = "";
          for (i = 1; i <= NF; i++) {
            if ($i ~ /^rid=/)           rid = substr($i, 5)
            else if ($i ~ /^workflow=/) wf = substr($i, 10)
            else if ($i ~ /^msg=/)      ms = substr($i, 5)
          }
          key = rid; gsub(/-/, "_", key)
          st = ENVIRON["STATUS_" key]; if (st == "") st = dflt
          printf "{\"id\":\"%s\",\"workflow_name\":\"%s\",\"user_message\":\"%s\",\"status\":\"%s\",\"started_at\":%d}", rid, wf, ms, st, systime() * 1000
        }' "$FAKE_LAUNCHES"
    fi
    printf ']}\n'
    ;;
  workflow/resume)
    echo "RESUME $arg" >>"$FAKE_LAUNCHES"
    printf '{"ok":true,"runId":"%s"}\n' "$arg"
    ;;
  workflow/abandon)
    echo "ABANDON $arg" >>"$FAKE_LAUNCHES"
    printf '{"ok":true}\n'
    ;;
  *)
    printf '{"ok":false,"error":"stub: unsupported invocation: %s"}\n' "$*"
    exit 1
    ;;
esac
SHIM
cat >"$SBX/bin/git" <<'SHIM'
#!/usr/bin/env bash
# Stub git: everything succeeds, working tree always clean, never behind.
case "${1:-}" in rev-list) echo 0 ;; esac
exit 0
SHIM
cat >"$SBX/bin/gh" <<'SHIM'
#!/usr/bin/env bash
# Stub gh: reports a merged PR for the head branch iff $MERGED_HEAD equals it
# (sourced from the same scenario file the archon stub reads).
set -u
[ -f "${FAKE_SCENARIO:-}" ] && . "$FAKE_SCENARIO"
head=""; prev=""
for a in "$@"; do [ "$prev" = "--head" ] && head="$a"; prev="$a"; done
if [ -n "${MERGED_HEAD:-}" ] && [ "$head" = "$MERGED_HEAD" ]; then
  printf '[{"number":7,"url":"https://github.com/quantm-zeus/foresift/pull/7"}]'
else
  echo '[]'
fi
exit 0
SHIM
chmod +x "$SBX/bin/archon" "$SBX/bin/git" "$SBX/bin/gh"
export PATH="$SBX/bin:$PATH"

# ── fixture helpers ──────────────────────────────────────────────────────────
new_sandbox() {
  SB="$SBX/$1"
  mkdir -p "$SB/repo/specs/implementation" "$SB/state"
  export FORESIFT_AUTOPILOT_REPO="$SB/repo"
  export FORESIFT_AUTOPILOT_STATE_DIR="$SB/state"
  export FAKE_SCENARIO="$SB/scenario.sh" FAKE_LOG="$SB/archon.log"
  export FAKE_LAUNCHES="$SB/launches.log" FAKE_RUNSEQ="$SB/runseq"
  : >"$FAKE_SCENARIO"; : >"$FAKE_LOG"; : >"$FAKE_LAUNCHES"; echo 0 >"$FAKE_RUNSEQ"
  unset DEFAULT_STATUS UPDATED_AT_MS MERGED_HEAD NO_ACK_ID RUNS_LAG 2>/dev/null || true
}
roadmap_fixture() { # $1 = currentMilestoneId ('null' allowed)
  node -e '
const cur = process.argv[1] === "null" ? null : process.argv[1];
console.log(JSON.stringify({
  schemaVersion: "1.0.0",
  derivedFrom: "docs/spec/crypto_intelligence_agent_gateway_PRD_FINAL_v6.0.requirements.json",
  policy: {
    foundationMilestones: ["G0"],
    maxParallelCodingPackagesFoundation: 1,
    maxParallelCodingPackages: 2,
    serialWhenRisk: ["CRITICAL"],
  },
  currentMilestoneId: cur,
  milestones: [
    { id: "G0", name: "foundation", dependsOn: [], status: "PLANNED" },
    { id: "G1", name: "core", dependsOn: ["G0"], status: "PLANNED" },
  ],
}, null, 2));
' "$1" >"$FORESIFT_AUTOPILOT_REPO/specs/implementation/roadmap.json"
}
pkg_json() { # id deps risk parallelizable
  node -e '
const [id, deps, risk, par] = process.argv.slice(1);
const p = {
  id,
  objective: `Deliver ${id} outcomes for the milestone`,
  requirementIds: [`FR-${id.toUpperCase().replace(/-/g, "")}-001`],
  dependencies: deps ? deps.split(",") : [],
  risk: risk ?? "HIGH",
  parallelizable: par !== "false",
  writeScopes: [`packages/${id.replace(/[^a-z0-9]/g, "")}/**`],
  verificationCommands: ["pnpm test"],
  status: "PENDING",
};
process.stdout.write(JSON.stringify(p));
' "$1" "${2:-}" "${3:-}" "${4:-}"
}
milestone_fixture() { # milestoneId, then pkg_json argument tuples separated by ';'
  local mid="$1"; shift
  NODE_PATH="$FORESIFT_AUTOPILOT_REPO/node_modules" node -e '
const [mid, ...defs] = process.argv.slice(1);
const pkgs = defs.map((d) => JSON.parse(d));
console.log(JSON.stringify({
  schemaVersion: "1.0.0", milestoneId: mid, status: "ACTIVE",
  plannedAt: "2026-08-22T00:00:00Z", packages: pkgs,
}, null, 2));
' "$mid" "$@" >"$FORESIFT_AUTOPILOT_REPO/specs/implementation/current-milestone.json"
}
tick() { node "$ROOT/scripts/automation/foresift-autopilot.mjs" --once >"$SB/sup.log" 2>&1; }
launch_count() { grep -c '^LAUNCH' "$FAKE_LAUNCHES" 2>/dev/null || true; }
resume_count() { grep -c '^RESUME' "$FAKE_LAUNCHES" 2>/dev/null || true; }
launch_workflows() { grep '^LAUNCH' "$FAKE_LAUNCHES" | sed 's/.*branch=\([^ ]*\).*/\1/' | tr '\n' ' '; }
state() { cat "${FORESIFT_AUTOPILOT_STATE_DIR:?}/autopilot-state.json"; }
pkg_field() { # packageId, field
  node -e '
const m = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"));
const p = m.packages.find((x) => x.id === process.argv[2]);
console.log(p ? String(p[process.argv[3]]) : "<missing>");
' "$FORESIFT_AUTOPILOT_REPO/specs/implementation/current-milestone.json" "$1" "$2"
}
fast_forward_resumes() { # rewrite scheduled attempts into the past
  node -e '
const fs = require("fs");
const f = process.env.FORESIFT_AUTOPILOT_STATE_DIR + "/autopilot-state.json";
const st = JSON.parse(fs.readFileSync(f, "utf8"));
for (const e of [...(st.activeRuns ?? []), ...(st.milestoneRuns ?? [])])
  if (e.nextAttemptAt) e.nextAttemptAt = Date.now() - 60_000;
fs.writeFileSync(f, JSON.stringify(st, null, 2));
'
}
backdate_entry() { # make every tracked run look idle for hours
  node -e '
const fs = require("fs");
const f = process.env.FORESIFT_AUTOPILOT_STATE_DIR + "/autopilot-state.json";
const st = JSON.parse(fs.readFileSync(f, "utf8"));
for (const e of [...(st.activeRuns ?? []), ...(st.milestoneRuns ?? [])]) {
  e.startedAt = Date.now() - 120 * 60_000;
  delete e.lastSeenAt;
}
fs.writeFileSync(f, JSON.stringify(st, null, 2));
'
}

echo "Foresift supervisor selftest — sandbox $SBX"

# ── S1: ordering, G0 limit 1, PROVEN finalize, status ────────────────────────
echo "S1: dependency ordering, G0 concurrency 1, finalize-to-PROVEN"
new_sandbox s1
roadmap_fixture G0
milestone_fixture "G0" \
  "$(pkg_json g1-alpha "" HIGH true)" \
  "$(pkg_json g1-beta "" MEDIUM true)" \
  "$(pkg_json g1-gamma g1-alpha LOW true)"
tick
assert_eq "first tick launches exactly one package (G0 limit)" "$(launch_count)" "1"
assert_match "dependency-free package selected first" "$(launch_workflows)" "^foresift/g1-alpha "
assert_eq "launched package marked RUNNING" "$(pkg_field g1-alpha status)" "RUNNING"
STATUS_OUT="$(node "$ROOT/scripts/automation/foresift-autopilot.mjs" --status)"
assert_match "--status is usable" "$STATUS_OUT" "AUTOPILOT STATUS"
assert_match "--status shows milestone progress" "$STATUS_OUT" "current milestone: G0"
printf 'STATUS_run_1="completed"\nMERGED_HEAD="foresift/g1-alpha"\n' >>"$FAKE_SCENARIO"
tick
assert_eq "completed+merged run finalizes to PROVEN" "$(pkg_field g1-alpha status)" "PROVEN"
assert_eq "still only one concurrent slot used after PROVEN" "$(launch_count)" "2"
assert_match "next eligible package launched" "$(launch_workflows)" "foresift/g1-beta "

# ── S2: transient recovery loop, bounded retries, PAUSED_FATAL ───────────────
echo "S2: transient failure -> bounded auto-resume -> PAUSED_FATAL"
new_sandbox s2
roadmap_fixture G0
milestone_fixture "G0" \
  "$(pkg_json t-alpha "" HIGH true)" \
  "$(pkg_json t-beta "" MEDIUM true)"
tick
cat >"$FAKE_SCENARIO" <<'SCEN'
STATUS_run_1="failed"
ERR_run_1="ETIMEDOUT while contacting model provider"
SCEN
tick
assert_match "transient failure schedules a resume" "$(state)" "resume_scheduled"
assert_eq "resume is deferred, not immediate" "$(resume_count)" "0"
PAUSED=false
for _ in 1 2 3 4 5 6 7 8 9 10; do
  fast_forward_resumes
  tick
  if node -e 'const s=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"));process.exit(s.pausedFatal?0:1)' \
    "$FORESIFT_AUTOPILOT_STATE_DIR/autopilot-state.json"; then PAUSED=true; break; fi
done
assert_eq "recovery exhaustion pauses fatally (bounded loop terminates)" "$PAUSED" "true"
assert_eq "exactly RESUME_LIMIT resumes attempted" "$(resume_count)" "3"
assert_eq "no fresh relaunch ever happened" "$(launch_count)" "1"
LOG_BEFORE="$(wc -l <"$FAKE_LOG")"
tick
assert_eq "paused supervisor stops issuing commands" "$(wc -l <"$FAKE_LOG")" "$LOG_BEFORE"
node "$ROOT/scripts/automation/foresift-autopilot.mjs" --clear-fatal >/dev/null
assert_eq "--clear-fatal releases the pause" \
  "$(node -e 'const s=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"));console.log(String(s.pausedFatal===null||s.pausedFatal===undefined))' \
    "$FORESIFT_AUTOPILOT_STATE_DIR/autopilot-state.json")" "true"

# ── S3: fatal classification pauses immediately ───────────────────────────────
echo "S3: fatal failure pauses immediately"
new_sandbox s3
roadmap_fixture G0
milestone_fixture "G0" \
  "$(pkg_json f-alpha "" HIGH true)" \
  "$(pkg_json f-beta "" MEDIUM true)"
tick
cat >"$FAKE_SCENARIO" <<'SCEN'
STATUS_run_1="failed"
ERR_run_1="authentication failed: 401 Unauthorized"
SCEN
tick
assert_match "fatal error pauses without any retry" "$(state)" "paused_fatal"
assert_eq "zero resumes for fatal errors" "$(resume_count)" "0"

# ── S4: CRITICAL serial + post-foundation cap 2 ───────────────────────────────
echo "S4: CRITICAL seriality and post-foundation concurrency 2"
new_sandbox s4
roadmap_fixture G0
milestone_fixture "G0" \
  "$(pkg_json c-core "" CRITICAL false)" \
  "$(pkg_json c-side "" LOW true)"
tick
assert_eq "CRITICAL runs alone" "$(launch_count)" "1"
assert_match "CRITICAL package was the one selected" "$(launch_workflows)" "foresift/c-core"
printf 'STATUS_run_1="completed"\nMERGED_HEAD="foresift/c-core"\n' >>"$FAKE_SCENARIO"
tick
assert_eq "next package starts only after CRITICAL finishes" "$(launch_count)" "2"
assert_match "remaining package launched" "$(launch_workflows)" "foresift/c-side"

new_sandbox s4b
node -e '
const fs = require("fs");
const f = process.env.FORESIFT_AUTOPILOT_REPO + "/specs/implementation/roadmap.json";
const rm = JSON.parse(fs.readFileSync(f, "utf8"));
rm.currentMilestoneId = "G1";
fs.writeFileSync(f, JSON.stringify(rm, null, 2));
' 2>/dev/null || true
roadmap_fixture G1
milestone_fixture "G1" \
  "$(pkg_json p-one "" LOW true)" \
  "$(pkg_json p-two "" LOW true)" \
  "$(pkg_json p-three "" LOW true)"
tick
assert_eq "post-foundation allows exactly 2 concurrent packages" "$(launch_count)" "2"
tick
assert_eq "third package blocked while 2 slots busy" "$(launch_count)" "2"

# ── S5: cancelled requeue + stale orphan handling ─────────────────────────────
echo "S5: cancelled runs requeue; stale runs are abandoned and restarted"
new_sandbox s5
roadmap_fixture G0
milestone_fixture "G0" \
  "$(pkg_json x-alpha "" HIGH true)" \
  "$(pkg_json x-beta "" MEDIUM true)"
tick
printf 'DEFAULT_STATUS="cancelled"\n' >>"$FAKE_SCENARIO"
tick
assert_eq "cancelled run is replaced by a fresh launch in one tick" "$(launch_count)" "2"
assert_eq "requeued package runs again" "$(pkg_field x-alpha status)" "RUNNING"

new_sandbox s5b
roadmap_fixture G0
milestone_fixture "G0" \
  "$(pkg_json y-alpha "" HIGH true)" \
  "$(pkg_json y-beta "" MEDIUM true)"
tick
cat >"$FAKE_SCENARIO" <<'SCEN'
DEFAULT_STATUS="running"
UPDATED_AT_MS=$(( $(date +%s) - 7200 * 1000 ))
SCEN
backdate_entry
tick
assert_match "idle run abandoned via supported CLI" "$(grep '^ABANDON' "$FAKE_LAUNCHES" || true)" "run-1"
fast_forward_resumes
tick
assert_eq "fresh restart issued on the SAME branch" "$(launch_count)" "2"
assert_match "restart targets original branch" "$(grep '^LAUNCH.*run-2' "$FAKE_LAUNCHES")" "branch=foresift/y-alpha"

# ── S6: detach acks without a run id are discovered, never double-launched ────
echo "S6: missing ack run id -> runs-table discovery without duplicate launch"
new_sandbox s6
roadmap_fixture G0
milestone_fixture "G0" \
  "$(pkg_json d-alpha "" HIGH true)" \
  "$(pkg_json d-beta "" MEDIUM true)"
cat >>"$FAKE_SCENARIO" <<'SCEN'
NO_ACK_ID="1"
RUNS_LAG="2"
SCEN
tick
assert_eq "launch happened despite opaque ack" "$(launch_count)" "1"
assert_match "entry awaits discovery" "$(state)" '"awaitingDiscovery": true'
tick
assert_eq "undiscovered run is NOT relaunched" "$(launch_count)" "1"
fast_forward_resumes
tick
assert_match "run id recovered from runs table" "$(state)" 'run_id_discovered'
STATE_RUNID="$(node -e 'const s=JSON.parse(require("fs").readFileSync(process.env.FORESIFT_AUTOPILOT_STATE_DIR+"/autopilot-state.json","utf8"));console.log(s.activeRuns[0].runId)')"
assert_eq "tracked run matches stub registry" "$STATE_RUNID" "run-1"
assert_eq "still exactly one run end-to-end" "$(launch_count)" "1"

echo
echo "selftest result: PASS=$PASS FAIL=$FAIL"
