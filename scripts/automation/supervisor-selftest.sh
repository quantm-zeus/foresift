#!/usr/bin/env bash
# Hermetic selftest for scripts/automation/foresift-autopilot.mjs.
#
# Proves the supervisor contract with a fixture repo + stub archon/git/gh CLIs:
#   S1  dependency ordering, G0 concurrency limit 1, PROVEN finalize, status UX
#   S2  transient-failure resume loop -> bounded retries -> PAUSED_FATAL -> clear
#   S3  fatal failures pause immediately (no retry hammering)
#   S4  CRITICAL packages never co-run; post-foundation concurrency cap of 2
#   S5  cancelled runs requeue the package; stale runs are abandoned + restarted
#   S6  opaque detach acks -> runs-table discovery, no duplicates, PENDING until durable id
#   S7  milestone-control launches always tracked; discovery; no duplicate launches
#   S8  undiscoverable launch fails closed (PAUSED_FATAL), never relaunched
#   S9  corrupt/invalid implementation state fails closed before any launch
#   S10 unparsable activity timestamps are diagnostics, never abandons
#   S11 daily-quota 429 -> durable backoff WITHOUT burning the transient budget
#   S12 quota probes are bounded (exponential hours-scale) -> operator-gated fatal pause
#   S13 legacy stranded state (RUNNING, no tracked run) self-heals; live runs re-adopted
#   S14 --recover-fatal: same-run resume; fail-closed --clear-fatal; single fresh continuation
#   S15 ack-ok-but-noop resume is VERIFIED and falls back to one fresh continuation
#   S16 ack-ok-but-noop quota probe escalates instead of burning the probe budget
#   S17 throughput profile selects the workflow variant (LEGACY original DAG,
#       OPTIMIZED -optimized variant) for launches AND stranded-run adoption
#   S18 critical-path ordering drives selection; one tick fills both slots
#   S19 corrupt autopilot-state.json self-heals; live runs re-adopted, no relaunch
#   S20 singleton lock refuses a second writer (exit 3); stale locks are taken over
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
# Scenario vars must be EXPORTED for awk's ENVIRON lookups (per-run statuses in
# the runs table); `set -a` covers both the shell-expansion and awk readers.
[ -f "${FAKE_SCENARIO:-}" ] && { set -a; . "$FAKE_SCENARIO"; set +a; }
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
    # Real Archon CLI emits snake_case started_at / last_activity_at (the latter
    # as "YYYY-MM-DD HH:MM:SS" strings); the ms-number form below is one of the
    # formats the supervisor's normalizeTimestampMs accepts.
    if [ "${LAST_ACTIVITY_GARBAGE:-}" = "1" ]; then
      la='"last_activity_at":"not-a-timestamp","started_at":null'
    else
      la="\"last_activity_at\":${ts},\"started_at\":${ts}"
    fi
    if [ -n "$er" ]; then
      printf '{"id":"%s","status":"%s",%s,"error":"%s"}\n' "$arg" "$st" "$la" "$er"
    else
      printf '{"id":"%s","status":"%s",%s}\n' "$arg" "$st" "$la"
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
    if [ "${RESUME_REFUSE:-}" = "1" ]; then
      printf '{"ok":false,"error":"stub: run lifecycle refuses resume"}\n'
    else
      printf '{"ok":true,"runId":"%s"}\n' "$arg"
    fi
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
# `git show HEAD:<path>` emulates a FULLY-COMMITTED tree by catting the file
# from the fixture repo (fixtures never really commit, so the committed view
# equals the working-tree view here; the committed-vs-file divergence itself —
# defect #11 — is pinned hermetically by
# tests/automation/selection-committed-view.spec.ts).
case "${1:-}" in
  rev-list) echo 0 ;;
  show)
    p="${2#HEAD:}"
    [ -n "$p" ] && [ "$p" != "$2" ] && [ -f "${FORESIFT_AUTOPILOT_REPO:?}/$p" ] \
      && cat "${FORESIFT_AUTOPILOT_REPO}/$p"
    ;;
esac
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

# New contract: exhaustion retains the tracked entry + structured recovery identity.
assert_match "exhaustion retains a TRACKED paused entry (identity survives)" "$(state)" '"paused": "fatal"'
IDENTITY="$(node -e '
const s = JSON.parse(require("fs").readFileSync(process.env.FORESIFT_AUTOPILOT_STATE_DIR + "/autopilot-state.json", "utf8"));
const e = s.activeRuns.find((x) => x.paused === "fatal");
console.log([e.runId, e.packageId, e.workflow, e.branch, e.message, String(e.done === undefined)].join(" "));
')"
assert_eq "paused entry carries full recovery identity, never done-filtered" \
  "$IDENTITY" "run-1 t-alpha foresift-work-package-optimized foresift/t-alpha t-alpha true"
PF_KEYS="$(node -e '
const s = JSON.parse(require("fs").readFileSync(process.env.FORESIFT_AUTOPILOT_STATE_DIR + "/autopilot-state.json", "utf8"));
console.log(Object.keys(s.pausedFatal).sort().join(","));
')"
for k in runId kind packageId workflow branch message; do
  assert_match "pausedFatal carries structured identity: $k" "$PF_KEYS" "(^|,)$k(,|$)"
done

# --clear-fatal is fail-closed against orphaning the RUNNING package.
CLEAR_ALLOWED=true
node "$ROOT/scripts/automation/foresift-autopilot.mjs" --clear-fatal >/dev/null 2>&1 || CLEAR_ALLOWED=false
assert_eq "--clear-fatal REFUSES to orphan a RUNNING package" "$CLEAR_ALLOWED" "false"
assert_eq "refused clear leaves the fatal pause intact (fail-closed, no mutation)" \
  "$(node -e 'const s=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"));console.log(String(Boolean(s.pausedFatal)))' \
    "$FORESIFT_AUTOPILOT_STATE_DIR/autopilot-state.json")" "true"

# Supported operator recovery: resume the SAME run under authoritative tracking.
RESUMES_BEFORE="$(resume_count)"
node "$ROOT/scripts/automation/foresift-autopilot.mjs" --recover-fatal >/dev/null
assert_eq "supported recovery resumes the SAME Archon run" "$(resume_count)" "$((RESUMES_BEFORE + 1))"
assert_eq "recovery clears the fatal pause" \
  "$(node -e 'const s=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"));console.log(String(s.pausedFatal===null))' \
    "$FORESIFT_AUTOPILOT_STATE_DIR/autopilot-state.json")" "true"
printf 'STATUS_run_1="running"\n' >>"$FAKE_SCENARIO"
RECOVERED="$(node -e '
const s = JSON.parse(require("fs").readFileSync(process.env.FORESIFT_AUTOPILOT_STATE_DIR + "/autopilot-state.json", "utf8"));
const e = s.activeRuns.find((x) => !x.done);
console.log([e.runId, e.paused ?? "live", e.packageId].join(" "));
')"
assert_eq "supervisor tracking restored for same package and run" "$RECOVERED" "run-1 live t-alpha"
tick
assert_eq "no duplicate launch after recovery" "$(launch_count)" "1"
printf 'STATUS_run_1="completed"\nMERGED_HEAD="foresift/t-alpha"\n' >>"$FAKE_SCENARIO"
tick
assert_eq "recovered implementation completes persisted work to PROVEN" "$(pkg_field t-alpha status)" "PROVEN"

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
assert_eq "package stays PENDING until a durable run id exists" "$(pkg_field d-alpha status)" "PENDING"
tick
assert_eq "undiscovered run is NOT relaunched" "$(launch_count)" "1"
fast_forward_resumes
tick
assert_match "run id recovered from runs table" "$(state)" 'run_id_discovered'
STATE_RUNID="$(node -e 'const s=JSON.parse(require("fs").readFileSync(process.env.FORESIFT_AUTOPILOT_STATE_DIR+"/autopilot-state.json","utf8"));console.log(s.activeRuns[0].runId)')"
assert_eq "tracked run matches stub registry" "$STATE_RUNID" "run-1"
assert_eq "discovery flips package to RUNNING" "$(pkg_field d-alpha status)" "RUNNING"
assert_eq "still exactly one run end-to-end" "$(launch_count)" "1"

# ── S7: milestone-control launches are always tracked, never duplicated ──────
echo "S7: milestone-control tracked without ack id; discovery; no duplicate launch"
new_sandbox s7
roadmap_fixture G0   # no current-milestone.json → milestone-control is due
cat >>"$FAKE_SCENARIO" <<'SCEN'
NO_ACK_ID="1"
RUNS_LAG="2"
SCEN
tick
assert_eq "milestone-control launched exactly once" "$(launch_count)" "1"
MS_TRACKED="$(node -e 'const s=JSON.parse(require("fs").readFileSync(process.env.FORESIFT_AUTOPILOT_STATE_DIR+"/autopilot-state.json","utf8"));console.log(s.milestoneRuns.length)')"
assert_eq "milestone launch tracked even without a run id" "$MS_TRACKED" "1"
assert_match "milestone entry awaits discovery" "$(state)" '"awaitingDiscovery": true'
tick
assert_eq "undiscovered milestone run is NOT relaunched" "$(launch_count)" "1"
fast_forward_resumes
tick
assert_match "milestone run id discovered from runs table" "$(state)" 'run_id_discovered'
assert_eq "still exactly one milestone launch" "$(launch_count)" "1"
printf 'STATUS_run_1="completed"\n' >>"$FAKE_SCENARIO"
tick
assert_match "milestone completion recorded" "$(state)" 'milestone_workflow_completed'

# ── S8: undiscoverable launch fails closed instead of double-launching ───────
echo "S8: discovery exhaustion -> PAUSED_FATAL, package never RUNNING"
new_sandbox s8
roadmap_fixture G0
milestone_fixture "G0" \
  "$(pkg_json u-alpha "" HIGH true)" \
  "$(pkg_json u-beta "" MEDIUM true)"
cat >>"$FAKE_SCENARIO" <<'SCEN'
NO_ACK_ID="1"
RUNS_LAG="9999"
SCEN
tick
assert_eq "launch issued exactly once" "$(launch_count)" "1"
PAUSED=false
for _ in $(seq 1 12); do
  fast_forward_resumes
  tick
  if node -e 'const s=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"));process.exit(s.pausedFatal?0:1)' \
    "$FORESIFT_AUTOPILOT_STATE_DIR/autopilot-state.json"; then PAUSED=true; break; fi
done
assert_eq "discovery exhaustion pauses fatally (bounded loop terminates)" "$PAUSED" "true"
assert_eq "untrackable workflow was NEVER relaunched" "$(launch_count)" "1"
assert_eq "package stays PENDING (never RUNNING without a durable run id)" "$(pkg_field u-alpha status)" "PENDING"
FATAL_REASON="$(node -e 'const s=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"));console.log(s.pausedFatal&&s.pausedFatal.reason||"")' \
  "$FORESIFT_AUTOPILOT_STATE_DIR/autopilot-state.json")"
assert_match "fatal reason explains the run-id problem" "$FATAL_REASON" "durable Archon run id"

# ── S9: corrupt implementation state fails closed before any launch ──────────
echo "S9: corrupt current-milestone.json / roadmap fail closed"
new_sandbox s9
roadmap_fixture G0
printf '{ this is not valid json' >"$FORESIFT_AUTOPILOT_REPO/specs/implementation/current-milestone.json"
tick
assert_match "corrupt milestone JSON pauses fatally" "$(state)" 'paused_fatal_corrupt_state'
assert_eq "zero launches against corrupt state" "$(launch_count)" "0"
STATUS_OUT="$(node "$ROOT/scripts/automation/foresift-autopilot.mjs" --status)"
assert_match "--status flags invalid implementation state" "$STATUS_OUT" "INVALID"

new_sandbox s9b
roadmap_fixture G0
milestone_fixture "G0" "$(pkg_json v-alpha "" HIGH true)"
node -e '
const fs = require("fs");
const f = process.env.FORESIFT_AUTOPILOT_REPO + "/specs/implementation/current-milestone.json";
const ms = JSON.parse(fs.readFileSync(f, "utf8"));
ms.packages[0].status = "BOGUS";
fs.writeFileSync(f, JSON.stringify(ms, null, 2));
'
tick
assert_match "schema-invalid milestone pauses fatally (no silent re-plan)" "$(state)" 'paused_fatal_corrupt_state'
assert_eq "still zero launches" "$(launch_count)" "0"

new_sandbox s9c
roadmap_fixture G0
printf '{"broken": true' >"$FORESIFT_AUTOPILOT_REPO/specs/implementation/roadmap.json"
milestone_fixture "G0" "$(pkg_json r-alpha "" HIGH true)"
tick
assert_match "corrupt roadmap pauses fatally" "$(state)" 'paused_fatal_corrupt_state'
assert_eq "roadmap corruption also blocks launches" "$(launch_count)" "0"

# ── S10: unparsable activity timestamps are diagnostics, never abandons ──────
echo "S10: garbage remote timestamps keep a possibly-healthy run alive"
new_sandbox s10
roadmap_fixture G0
milestone_fixture "G0" \
  "$(pkg_json w-alpha "" HIGH true)" \
  "$(pkg_json w-beta "" MEDIUM true)"
tick
printf 'LAST_ACTIVITY_GARBAGE="1"\n' >>"$FAKE_SCENARIO"
backdate_entry
tick
assert_eq "garbage timestamps do NOT abandon the run" "$(grep -c '^ABANDON' "$FAKE_LAUNCHES" 2>/dev/null || true)" "0"
assert_match "one-time diagnostic recorded" "$(state)" 'run_activity_timestamp_unparsable'
assert_eq "healthy run still tracked, not relaunched" "$(launch_count)" "1"

# ── S11: daily-quota 429 → durable backoff, transient budget untouched ───────
echo "S11: daily-quota failure enters durable supervisor-owned backoff"
new_sandbox s11
roadmap_fixture G0
milestone_fixture "G0" \
  "$(pkg_json q-alpha "" HIGH true)" \
  "$(pkg_json q-beta "" MEDIUM true)"
tick
cat >"$FAKE_SCENARIO" <<'SCEN'
STATUS_run_1="failed"
ERR_run_1="Claude API error (rate_limit): API Error: Request rejected (429) · Rate limit exceeded: free-models-per-day-stealth."
SCEN
tick
assert_match "quota failure recorded as durable backoff (not a resume)" "$(state)" 'quota_pause_scheduled'
assert_eq "ordinary transient budget untouched (zero resumes)" "$(resume_count)" "0"
assert_eq "no PAUSED_FATAL for plain quota exhaustion (tracked pause instead)" \
  "$(node -e 'const s=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"));console.log(String(!s.pausedFatal))' \
    "$FORESIFT_AUTOPILOT_STATE_DIR/autopilot-state.json")" "true"
IN_HOURS="$(node -e '
const s = JSON.parse(require("fs").readFileSync(process.env.FORESIFT_AUTOPILOT_STATE_DIR + "/autopilot-state.json", "utf8"));
console.log(Math.round((s.activeRuns[0].quotaNextProbeAt - Date.now()) / 3600000));
')"
assert_eq "first automatic probe scheduled ~6h out, not minutes" "$IN_HOURS" "6"
LOG_BEFORE="$(wc -l <"$FAKE_LOG")"
tick
assert_eq "idle quota pause issues zero commands (no busy-loop)" "$(wc -l <"$FAKE_LOG")" "$LOG_BEFORE"
STATUS_OUT="$(node "$ROOT/scripts/automation/foresift-autopilot.mjs" --status)"
assert_match "--status shows the quota backoff with probe budget" "$STATUS_OUT" "QUOTA BACKOFF"

# ── S12: quota probes are bounded; exhaustion escalates to operator-gated fatal ──
echo "S12: bounded quota probes -> operator-gated PAUSED_FATAL with identity preserved"
ff_quota() { # pull probe schedule + in-flight window into the past
  node -e '
const fs = require("fs");
const f = process.env.FORESIFT_AUTOPILOT_STATE_DIR + "/autopilot-state.json";
const st = JSON.parse(fs.readFileSync(f, "utf8"));
for (const e of [...(st.activeRuns ?? []), ...(st.milestoneRuns ?? [])]) {
  if (e.quotaNextProbeAt) e.quotaNextProbeAt = Date.now() - 1000;
  if (e.quotaProbeStartedAt) e.quotaProbeStartedAt = Date.now() - 16 * 60_000;
}
fs.writeFileSync(f, JSON.stringify(st, null, 2));
'
}
new_sandbox s12
roadmap_fixture G0
milestone_fixture "G0" \
  "$(pkg_json b-alpha "" HIGH true)" \
  "$(pkg_json b-beta "" MEDIUM true)"
tick
cat >"$FAKE_SCENARIO" <<'SCEN'
STATUS_run_1="failed"
ERR_run_1="Rate limit exceeded: free-models-per-day quota exhausted."
SCEN
tick # enter quota pause (probes=0)
for _ in 1 2 3; do
  ff_quota; tick # due probe resumes the run
  ff_quota; tick # run re-fails the daily wall -> re-pause with doubled interval
done
assert_eq "exactly QUOTA_PROBE_LIMIT automatic probes issued" "$(resume_count)" "3"
assert_eq "no fresh relaunches against the quota wall" "$(launch_count)" "1"
ff_quota; tick # one more due probe -> budget exhausted
assert_match "probe-budget exhaustion escalates to operator-gated pause" "$(state)" 'daily-quota probe budget'
assert_eq "escalated entry stays TRACKED with branch identity for --recover-fatal" \
  "$(node -e '
const s = JSON.parse(require("fs").readFileSync(process.env.FORESIFT_AUTOPILOT_STATE_DIR + "/autopilot-state.json", "utf8"));
const e = s.activeRuns.find((x) => !x.done);
console.log([String(Boolean(s.pausedFatal)), e.paused, e.branch, String(e.done === undefined)].join(" "));
')" "true fatal foresift/b-alpha true"

# ── S13: legacy stranded state self-heals; live untracked runs are adopted ────
echo "S13: RUNNING-without-tracking can never survive a tick (invariant guard)"
new_sandbox s13
roadmap_fixture G0
milestone_fixture "G0" \
  "$(pkg_json s-alpha "" HIGH true)" \
  "$(pkg_json s-beta "" MEDIUM true)"
node -e '
const fs = require("fs");
const f = process.env.FORESIFT_AUTOPILOT_REPO + "/specs/implementation/current-milestone.json";
const ms = JSON.parse(fs.readFileSync(f, "utf8"));
ms.packages[0].status = "RUNNING";
fs.writeFileSync(f, JSON.stringify(ms, null, 2));
fs.writeFileSync(process.env.FORESIFT_AUTOPILOT_STATE_DIR + "/autopilot-state.json",
  JSON.stringify({ activeRuns: [], milestoneRuns: [], pausedFatal: null, history: [] }, null, 2));
' # exact defect state produced by the pre-fix supervisor: RUNNING ∧ activeRuns=[] ∧ pausedFatal=null
tick
assert_match "stranded package converted to TRACKED fatal pause" "$(state)" 'was RUNNING with no supervisor-tracked active run'
assert_eq "healing launches nothing (never a duplicate product run)" "$(launch_count)" "0"

new_sandbox s13b
roadmap_fixture G0
milestone_fixture "G0" \
  "$(pkg_json u2-alpha "" HIGH true)" \
  "$(pkg_json u2-beta "" MEDIUM true)"
printf 'DEFAULT_STATUS="running"\n' >"$FAKE_SCENARIO"
printf 'LAUNCH rid=run-5 workflow=foresift-work-package-optimized branch=foresift/u2-alpha msg=u2-alpha\n' >>"$FAKE_LAUNCHES"
node -e '
const fs = require("fs");
const f = process.env.FORESIFT_AUTOPILOT_REPO + "/specs/implementation/current-milestone.json";
const ms = JSON.parse(fs.readFileSync(f, "utf8"));
ms.packages[0].status = "RUNNING";
fs.writeFileSync(f, JSON.stringify(ms, null, 2));
fs.writeFileSync(process.env.FORESIFT_AUTOPILOT_STATE_DIR + "/autopilot-state.json",
  JSON.stringify({ activeRuns: [], milestoneRuns: [], pausedFatal: null, history: [] }, null, 2));
'
LAUNCHES_BEFORE="$(launch_count)"
tick
assert_eq "live Archon run of an untracked RUNNING package is RE-ADOPTED" \
  "$(node -e '
const s = JSON.parse(require("fs").readFileSync(process.env.FORESIFT_AUTOPILOT_STATE_DIR + "/autopilot-state.json", "utf8"));
console.log([s.activeRuns[0]?.runId, String(!s.pausedFatal)].join(" "));
')" "run-5 true"
assert_eq "adoption issues no new launch" "$(launch_count)" "$LAUNCHES_BEFORE"

# ── S14: recovery falls back to exactly ONE fresh continuation when resume refused ──
echo "S14: refused resume -> single fresh continuation on the SAME branch/worktree"
new_sandbox s14
roadmap_fixture G0
milestone_fixture "G0" \
  "$(pkg_json z-alpha "" HIGH true)" \
  "$(pkg_json z-beta "" MEDIUM true)"
tick
cat >"$FAKE_SCENARIO" <<'SCEN'
STATUS_run_1="failed"
ERR_run_1="authentication failed: 401 Unauthorized"
RESUME_REFUSE="1"
SCEN
tick # FATAL class -> immediate operator-gated pause
LAUNCHES_BEFORE="$(launch_count)"
node "$ROOT/scripts/automation/foresift-autopilot.mjs" --recover-fatal >/dev/null
assert_eq "refused resume triggers exactly ONE fresh continuation" "$(launch_count)" "$((LAUNCHES_BEFORE + 1))"
assert_match "fresh continuation targets the SAME branch" "$(grep '^LAUNCH.*run-2' "$FAKE_LAUNCHES")" "branch=foresift/z-alpha"
RECOVERED="$(node -e '
const s = JSON.parse(require("fs").readFileSync(process.env.FORESIFT_AUTOPILOT_STATE_DIR + "/autopilot-state.json", "utf8"));
const e = s.activeRuns.find((x) => !x.done);
console.log([e.runId, String(!e.paused), String(!s.pausedFatal)].join(" "));
')"
assert_eq "supervisor tracks the fresh continuation authoritatively" "$RECOVERED" "run-2 true true"
tick
assert_eq "post-recovery tick is stable (no duplicate launch)" "$(launch_count)" "2"

# ── S15: ack-ok-but-noop resume is verified and falls back to ONE fresh continuation ──
echo "S15: silent no-op resume detected; single fresh continuation follows"
new_sandbox s15
roadmap_fixture G0
milestone_fixture "G0" \
  "$(pkg_json n-alpha "" HIGH true)" \
  "$(pkg_json n-beta "" MEDIUM true)"
tick
cat >"$FAKE_SCENARIO" <<'SCEN'
STATUS_run_1="failed"
ERR_run_1="authentication failed: 401 Unauthorized"
# The live zombie signature (run b0a82481): the run row exists but its activity
# froze hours before any recovery attempt — resume acks ok yet nothing restarts.
UPDATED_AT_MS=$(( $(date +%s) * 1000 - 6 * 3600 * 1000 ))
SCEN
tick # fatal class -> operator-gated pause with retained identity
LAUNCHES_BEFORE="$(launch_count)"
node "$ROOT/scripts/automation/foresift-autopilot.mjs" --recover-fatal >/dev/null
assert_match "noop resume recorded before falling back" "$(state)" 'operator_recovery_resume_noop'
assert_eq "verified noop triggers exactly ONE fresh continuation" "$(launch_count)" "$((LAUNCHES_BEFORE + 1))"
assert_match "fresh continuation targets the SAME branch" "$(grep '^LAUNCH.*run-2' "$FAKE_LAUNCHES")" "branch=foresift/n-alpha"
assert_match "dead run retired via supported lifecycle op first" "$(grep '^ABANDON' "$FAKE_LAUNCHES" || true)" "run-1"
RECOVERED="$(node -e '
const s = JSON.parse(require("fs").readFileSync(process.env.FORESIFT_AUTOPILOT_STATE_DIR + "/autopilot-state.json", "utf8"));
const e = s.activeRuns.find((x) => !x.done);
console.log([e.runId, String(!e.paused), String(!s.pausedFatal)].join(" "));
')"
assert_eq "supervisor tracks the fresh continuation authoritatively" "$RECOVERED" "run-2 true true"
cat >"$FAKE_SCENARIO" <<'SCEN'
DEFAULT_STATUS="running"
SCEN
tick
assert_eq "post-recovery tick is stable (no duplicate launch)" "$(launch_count)" "$((LAUNCHES_BEFORE + 1))"
printf 'STATUS_run_2="completed"\nMERGED_HEAD="foresift/n-alpha"\n' >>"$FAKE_SCENARIO"
tick
assert_eq "recovered implementation completes persisted work to PROVEN" "$(pkg_field n-alpha status)" "PROVEN"

# ── S16: ack-ok-but-noop quota probe escalates instead of burning the budget ──
echo "S16: silent no-op quota probe escalates to the operator-gated pause"
new_sandbox s16
roadmap_fixture G0
milestone_fixture "G0" \
  "$(pkg_json m-alpha "" HIGH true)" \
  "$(pkg_json m-beta "" MEDIUM true)"
tick
cat >"$FAKE_SCENARIO" <<'SCEN'
STATUS_run_1="failed"
ERR_run_1="Rate limit exceeded: free-models-per-day quota exhausted."
UPDATED_AT_MS=$(( $(date +%s) * 1000 - 8 * 3600 * 1000 ))
SCEN
tick # enters the durable quota pause
assert_match "quota pause entered" "$(state)" 'quota_pause_scheduled'
ff_quota; tick # due probe: resume acks ok, but the frozen row proves nothing restarted
assert_match "noop probe recorded for the operator trail" "$(state)" 'quota_probe_resume_noop'
assert_eq "escalation reaches the operator-gated pause" \
  "$(node -e 'const s=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"));console.log(String(Boolean(s.pausedFatal)))' \
    "$FORESIFT_AUTOPILOT_STATE_DIR/autopilot-state.json")" "true"
assert_eq "exactly ONE probe spent (budget never burned against a dead run)" "$(resume_count)" "1"
assert_eq "daemon itself issues no fresh relaunch against the dead run" "$(launch_count)" "1"
RETAINED="$(node -e '
const s = JSON.parse(require("fs").readFileSync(process.env.FORESIFT_AUTOPILOT_STATE_DIR + "/autopilot-state.json", "utf8"));
const e = s.activeRuns.find((x) => !x.done);
console.log([e.paused, e.branch, String(e.done === undefined)].join(" "));
')"
assert_eq "escalated entry stays TRACKED with branch identity for --recover-fatal" "$RETAINED" "fatal foresift/m-alpha true"

# ── S17: throughput profile selects the workflow variant (ADR 0006/0007) ─────
launch_wf_names() { grep '^LAUNCH' "$FAKE_LAUNCHES" | sed 's/.*workflow=\([^ ]*\).*/\1/' | tr '\n' ' '; }
echo "S17: OPTIMIZED packages launch the optimized DAG; LEGACY keeps the original"
new_sandbox s17
roadmap_fixture G0
milestone_fixture "G0" \
  "$(pkg_json g0-contracts-data-truth "" CRITICAL false)" \
  "$(pkg_json z-optimized "" HIGH true)"
tick # G0 serial rule: the CRITICAL dependency-free package runs alone first
assert_eq "LEGACY package launches the ORIGINAL work-package workflow" \
  "$(launch_wf_names)" "foresift-work-package "
printf 'STATUS_run_1="completed"\nMERGED_HEAD="foresift/g0-contracts-data-truth"\n' >>"$FAKE_SCENARIO"
tick
tick # g0-contracts-data-truth now PROVEN; next eligible package may start
assert_eq "OPTIMIZED package launches the OPTIMIZED variant" \
  "$(launch_wf_names)" "foresift-work-package foresift-work-package-optimized "
STATE_WF="$(node -e '
const s = JSON.parse(require("fs").readFileSync(process.env.FORESIFT_AUTOPILOT_STATE_DIR + "/autopilot-state.json", "utf8"));
const e = s.activeRuns.find((x) => x.packageId === "z-optimized");
console.log(e.workflow);
')"
assert_eq "tracked entry records the optimized workflow for recovery identity" "$STATE_WF" "foresift-work-package-optimized"

# ── S18: C4 critical-path order drives selection; one tick fills both slots ──
echo "S18: critical-path ordering + same-tick slot filling"
new_sandbox s18
roadmap_fixture G1
# The two hub packages each unlock a downstream child; the loner unlocks
# nothing. Hubs are placed AFTER the loner in the file so array order can
# never explain the selection — only critical-path priority can.
milestone_fixture "G1" \
  "$(pkg_json s-loner "" LOW true)" \
  "$(pkg_json s-hub-b "" HIGH true)" \
  "$(pkg_json s-d2 s-hub-b MEDIUM true)" \
  "$(pkg_json s-hub-a "" HIGH true)" \
  "$(pkg_json s-d1 s-hub-a MEDIUM true)"
tick
LAUNCHED_S18="$(launch_workflows)"
assert_eq "ONE tick fills BOTH post-foundation slots" "$(launch_count)" "2"
assert_match "hub-a selected despite later array position" "$LAUNCHED_S18" "foresift/s-hub-a"
assert_match "hub-b selected in the SAME tick" "$LAUNCHED_S18" "foresift/s-hub-b"
case "$LAUNCHED_S18" in
  *s-loner*) bad "loner must not outrank critical-path hubs"; FAIL=$((FAIL + 1)) ;;
  *) ok "dependency-free loner correctly deferred by critical-path order"; PASS=$((PASS + 1)) ;;
esac
tick
assert_eq "third package stays blocked while both slots are busy" "$(launch_count)" "2"

# ── S19: corrupt autopilot-state.json self-heals; live runs re-adopted ───────
echo "S19: garbage state bytes fall back to the default state WITHOUT double-launching"
new_sandbox s19
roadmap_fixture G0
milestone_fixture "G0" \
  "$(pkg_json c-alpha "" HIGH true)" \
  "$(pkg_json c-beta "" MEDIUM true)"
printf 'DEFAULT_STATUS="running"\n' >"$FAKE_SCENARIO"
printf 'LAUNCH rid=run-9 workflow=foresift-work-package-optimized branch=foresift/c-alpha msg=c-alpha\n' >>"$FAKE_LAUNCHES"
node -e '
const fs = require("fs");
const f = process.env.FORESIFT_AUTOPILOT_REPO + "/specs/implementation/current-milestone.json";
const ms = JSON.parse(fs.readFileSync(f, "utf8"));
ms.packages[0].status = "RUNNING";
fs.writeFileSync(f, JSON.stringify(ms, null, 2));
'
printf 'CORRUPT {{ NOT JSON' >"$FORESIFT_AUTOPILOT_STATE_DIR/autopilot-state.json"
LAUNCHES_BEFORE="$(launch_count)"
tick
assert_eq "unparsable state falls back to default and RE-ADOPTS the live run" \
  "$(node -e '
const s = JSON.parse(require("fs").readFileSync(process.env.FORESIFT_AUTOPILOT_STATE_DIR + "/autopilot-state.json", "utf8"));
console.log([s.activeRuns[0]?.runId, String(!s.pausedFatal)].join(" "));
')" "run-9 true"
assert_eq "healing issues no new launch (never a duplicate product run)" \
  "$(launch_count)" "$LAUNCHES_BEFORE"

# ── S20: singleton lock — live holder refuses, stale holder is taken over ────
echo "S20: lock exclusivity refuses a second writer; stale locks never wedge the supervisor"
new_sandbox s20
roadmap_fixture G0
milestone_fixture "G0" \
  "$(pkg_json l-alpha "" HIGH true)" \
  "$(pkg_json l-beta "" MEDIUM true)"
printf 'DEFAULT_STATUS="running"\n' >"$FAKE_SCENARIO"
printf 'LAUNCH rid=run-l1 workflow=foresift-work-package-optimized branch=foresift/l-alpha msg=l-alpha\n' >>"$FAKE_LAUNCHES"
printf '%s\n' "$$" >"$FORESIFT_AUTOPILOT_STATE_DIR/autopilot.lock" # live pid (this shell)
LAUNCHES_BEFORE="$(launch_count)"
set +e
node "$ROOT/scripts/automation/foresift-autopilot.mjs" --once >"$SB/s20-refused.log" 2>&1
LOCK_RC=$?
set -e
assert_eq "second instance refuses with exit 3 while a live process holds the lock" \
  "$LOCK_RC" "3"
assert_match "refusal names the singleton rule" "$(cat "$SB/s20-refused.log")" 'holds the lock'
assert_eq "refused instance launched nothing" "$(launch_count)" "$LAUNCHES_BEFORE"
printf '999999\n' >"$FORESIFT_AUTOPILOT_STATE_DIR/autopilot.lock" # dead pid → stale
tick
assert_eq "stale lock is taken over; the tick proceeds and launches normally" \
  "$(launch_count)" "$((LAUNCHES_BEFORE + 1))"

echo
echo "selftest result: PASS=$PASS FAIL=$FAIL"
