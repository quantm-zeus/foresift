# V3 §29 — Fault-injection matrix (34 cases)

Every fault class the control plane claims to survive, with the exact in-repo
evidence and an honest tier. A row is only as strong as its tier says:

| Tier       | Meaning                                                                                 |
| ---------- | --------------------------------------------------------------------------------------- |
| PROVEN     | Deterministic automated proof runs in `pnpm verify` / selftest at every HEAD            |
| E2E-PROVEN | Proven once against the REAL machinery (real archon binary/worktree), not just fixtures |
| PARTIAL    | Core decision logic proven; the physical injection itself is not scripted               |
| CODE-ONLY  | Route exists and was manually exercised; no automated proof (open gap)                  |

Evidence pointers: `S<N>` = scenario in `scripts/automation/supervisor-selftest.sh`
(hermetic: stub archon/gh/git, real supervisor process); `BD` =
`tests/automation/v3-base-drift.spec.ts`; `GEN` = `tests/automation/v3-generations.spec.ts`;
`FL` = final-land admission tests (BD §4 + `tests/automation/v3-mechanical-landing.spec.ts`);
file paths otherwise as written.

## A — Process death

| ID  | Fault injected                                     | Required behavior                                                                                                        | Evidence                                                                              | Tier    |
| --- | -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------- | ------- |
| A1  | Supervisor SIGKILL'd between launch and state save | Dead-pid lock is taken over next tick; untracked RUNNING package re-adopted from Archon discovery, never double-launched | S20b (stale takeover) + S13b/S19 (re-adoption, zero new launches)                     | PROVEN  |
| A2  | Writer agent dies mid-run                          | Idle-staleness backstop abandons after hours of silence; exactly-one fresh continuation on the same branch/worktree      | S5 (stale orphan), backdate_entry helper, S14 (single fresh continuation)             | PROVEN  |
| A3  | Lander SIGKILL'd during CI wait                    | Nothing merged (merge is one terminal call after all guards); rerun discovers the existing PR instead of duplicating     | BD happy path proves pr-list idempotency; kill injection not scripted                 | PARTIAL |
| A4  | Crash between FULL-gate pass and merge             | Attestation reuse stays bound to baseMainSha + head; a drifted world forces a fresh FULL gate                            | BD attestation describe (baseMainSha binding, legacy fail-closed); FL admission tests | PROVEN  |

## B — State corruption

| ID  | Fault injected                                                           | Required behavior                                                                   | Evidence | Tier   |
| --- | ------------------------------------------------------------------------ | ----------------------------------------------------------------------------------- | -------- | ------ |
| B1  | `autopilot-state.json` replaced by garbage bytes                         | loadState falls back to default state; live run RE-ADOPTED; zero duplicate launches | S19      | PROVEN |
| B2  | Stranded invariant state (`RUNNING` ∧ empty activeRuns ∧ no fatal pause) | Healed to a TRACKED operator-visible fatal pause; launches nothing                  | S13a     | PROVEN |
| B3  | Corrupt implementation/milestone state                                   | Fails closed BEFORE any launch — no product work starts on unreadable authority     | S9       | PROVEN |
| B4  | Unparsable remote activity timestamps                                    | Diagnostics only; never abandons a possibly-healthy run                             | S10      | PROVEN |

Known limitation (recorded, accepted): `saveState` is a plain
`writeFileSync`, not atomic — a torn write produces exactly the B1 input, whose
fallback path (default state + re-adoption, no relaunch) is proven. The cost of
a torn write is therefore one lost history array, never a duplicate run.

## C — Archon CLI faults

| ID  | Fault injected                               | Required behavior                                                                       | Evidence | Tier   |
| --- | -------------------------------------------- | --------------------------------------------------------------------------------------- | -------- | ------ |
| C1  | Workflow fails transiently N times           | Resume loop with bounded retries → PAUSED_FATAL; budget visible in state                | S2       | PROVEN |
| C2  | Failure classified FATAL                     | Immediate operator-gated pause; no retry hammering                                      | S3       | PROVEN |
| C3  | Launch returns opaque ack without durable id | Runs-table discovery resolves it; package stays PENDING until durable; never duplicated | S6       | PROVEN |
| C4  | Launched id undiscoverable afterwards        | Fail closed to PAUSED_FATAL; never blindly relaunched                                   | S8       | PROVEN |

## D — Quota exhaustion

| ID  | Fault injected                       | Required behavior                                                                       | Evidence | Tier   |
| --- | ------------------------------------ | --------------------------------------------------------------------------------------- | -------- | ------ |
| D1  | Daily-quota 429 from provider        | Durable supervisor-owned backoff WITHOUT burning the transient-retry budget             | S11      | PROVEN |
| D2  | Repeated quota probes while paused   | Bounded exponential hours-scale probes → operator-gated fatal pause, identity preserved | S12      | PROVEN |
| D3  | Quota probe acks ok but does nothing | Silent no-op VERIFIED; escalates instead of burning the probe budget                    | S16      | PROVEN |

## E — Landing routes (mechanical lander + final-land)

| ID  | Fault injected                                            | Required behavior                                                                                                      | Evidence                                                                   | Tier   |
| --- | --------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- | ------ |
| E1  | Red CI at the pinned head                                 | `ci-red` refusal naming the failing check; red is never bypassed                                                       | BD §29-E21                                                                 | PROVEN |
| E2  | Zero check-runs ever appear at pinned head                | Diagnose-and-fail-fast INSIDE the deadline (`no-check-runs`, names since-squash cause); not a silent 30-minute timeout | BD §29-E22 (deadline 12s, poll 5s ⇒ trips ~10s, asserts NOT timeout route) | PROVEN |
| E3  | Origin feature branch moves DURING the CI wait            | `head-moved` abort (`aborted-drift`) — never merge a moving target                                                     | BD §29-E24 (sibling pushes same branch mid-wait)                           | PROVEN |
| E4  | origin/main advances DURING the CI wait (TOCTOU)          | Pre-merge base re-check refuses (`aborted-pre-merge-base`) despite green CI                                            | BD TOCTOU test (GHSTUB_ADVANCE_MAIN)                                       | PROVEN |
| E5  | Branch pushed without current main (sibling landed first) | Pre-push `base-drift` refusal BEFORE any PR work (no PR created, nothing merged)                                       | BD early-drift test                                                        | PROVEN |
| E6  | Final-land invoked on a provably drifted branch           | Refusal BEFORE burning any FULL gate work (exit 4, verdict persisted to land-result.json)                              | FL runFinalLand admission test (gate fns untouched)                        | PROVEN |

## F — Git/GitHub substrate

| ID  | Fault injected                                    | Required behavior                                                                                                 | Evidence                                                                                             | Tier      |
| --- | ------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- | --------- |
| F1  | Shallow checkout asked "is main an ancestor?"     | Detection returns null-on-unverifiable; lander refuses fail-closed instead of trusting a truncated-history answer | BD isShallowCheckout mapping + real depth-1 clone probe (file:// URL); admitBase shallow route wired | PARTIAL   |
| F2  | Pre-V3D attestation lacking baseMainSha           | Fails closed against a resolved base — old evidence cannot vouch for new landings                                 | BD attestation legacy test                                                                           | PROVEN    |
| F3  | origin/main moved past the attested base          | FULL-gate reuse INVALID (drift list contains baseMainSha)                                                         | BD attestation drift test                                                                            | PROVEN    |
| F4  | Push rejected (non-fast-forward / remote refusal) | Lander aborts before merge; no partial GitHub state beyond the already-pushed branch                              | Git-level rejection exercised indirectly via admission routes                                        | CODE-ONLY |

## G — Concurrency & scheduling

| ID  | Fault injected                                       | Required behavior                                                                     | Evidence | Tier   |
| --- | ---------------------------------------------------- | ------------------------------------------------------------------------------------- | -------- | ------ |
| G1  | Two CRITICAL packages eligible simultaneously        | Strict serial exclusion — never co-run                                                | S4       | PROVEN |
| G2  | Post-foundation demand exceeds capacity              | Concurrency cap 2 enforced across ticks                                               | S4       | PROVEN |
| G3  | Run cancelled out-of-band                            | Package requeued; stale orphan rows abandoned + restarted cleanly                     | S5       | PROVEN |
| G4  | Multiple packages eligible in one tick               | Critical-path order selects; BOTH free slots filled same-tick; blocked loner deferred | S18      | PROVEN |
| G5  | Second supervisor instance started while first alive | Singleton lock: exit 3, explicit refusal message, launches NOTHING                    | S20a     | PROVEN |

## H — Generation identity & salvage

| ID  | Fault injected                                              | Required behavior                                                             | Evidence                                                                                                                                                                                                                                                 | Tier                 |
| --- | ----------------------------------------------------------- | ----------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------- |
| H1  | Gen-N message against a seeded branch carrying current main | Adopted at the seed sha onto `foresift/<id>-g<N>`; seed content preserved     | GEN adoptGenerationBranch ADOPTED case; also E2E-proven through the REAL archon launcher (smoke workflow `.archon/workflows/foresift/foresift-smoke-gen-adoption.yaml`, run 2026-08-23: "SEEDED-GENERATION ADOPTION PROVEN", marker survived at aa96411) | PROVEN (+E2E-PROVEN) |
| H2  | Seed exists but predates current main (stale)               | Fail-closed REFUSED naming reconciliation — never builds gen N on a dead base | GEN stale-seed case                                                                                                                                                                                                                                      | PROVEN               |
| H3  | Ancestry unverifiable (shallow checkout) at adoption time   | REFUSED shallow-unverifiable — no guessing from truncated history             | Route implemented (adopt-generation-branch.mjs); detection primitive proven in BD                                                                                                                                                                        | PARTIAL              |
| H4  | Dirty run worktree at adoption time                         | REFUSED even with a valid seed — never clobber existing work                  | GEN dirty-worktree case                                                                                                                                                                                                                                  | PROVEN               |

## Coverage summary

- **34 rows**: 30 PROVEN (H1 additionally E2E-proven against the real archon
  binary) · 3 PARTIAL (A3 kill-injection, F1 admitBase shallow route, H3
  adoption-time shallow refusal) · 1 CODE-ONLY (F4 push-rejection abort).
- Every PROVEN row executes at every pushed HEAD via `pnpm verify` +
  `pnpm autopilot:selftest`.
- Open gaps are exactly the four non-PROVEN rows; none of them can silently
  violate a permanent boundary — each fails toward _not landing_ or _not
  launching_, which is the safe direction.
- Every PROVEN row executes at every pushed HEAD via `pnpm verify` +
  `pnpm autopilot:selftest`.
- Open gaps are exactly the four non-PROVEN rows; none of them can silently
  violate a permanent boundary — each fails toward _not landing_ or _not
  launching_, which is the safe direction.
