// Host resource governor (Hyperdrive H3, P1-8): real host memory pressure
// and heavy-process counts classify the VPS into GREEN/YELLOW/ORANGE/RED,
// gating supervisor launches BEFORE multi-package scale-up. The VPS has a
// real OOM history (15 GiB host: bare whole-tree bun test accumulated PGlite
// instances and OOM-killed the box, 2026-08-28) — the governor is the
// fail-closed floor under every scheduling ambition (ready queue, work
// stealing, higher concurrency).
//
//   GREEN   — normal adaptive expansion
//   YELLOW  — no concurrency increase
//   ORANGE  — no new launches of heavy/PGlite/AI work
//   RED     — no new launches at all
//
// Zero AI: /proc memory arithmetic + process-table counting.

import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

/** Thresholds as fractions of MemTotal; heavy-process cap is absolute. */
export const RESOURCE_GOVERNOR_DEFAULTS = Object.freeze({
  // MemAvailable below 15% of total OR >= 10 heavy processes ⇒ RED
  redMemoryFrac: 0.15,
  redHeavyProcesses: 10,
  // MemAvailable below 25% OR >= 6 heavy ⇒ ORANGE
  orangeMemoryFrac: 0.25,
  orangeHeavyProcesses: 6,
  // MemAvailable below 40% OR >= 3 heavy ⇒ YELLOW
  yellowMemoryFrac: 0.4,
  yellowHeavyProcesses: 3,
});

const HEAVY_PROCESS_PATTERNS = [
  /bun(?:\.exe)?\s/, // bun test processes (PGlite accumulation risk)
  /node\s+\S*test-authority/,
  /node\s+\S*bun-test-coordinator/,
  /node\s+\S*package-full-gate/,
  /node\s+\S*package-fast-verify/,
  /postgres|pglite/i,
];

function memInfo() {
  const text = readFileSync('/proc/meminfo', 'utf8');
  const field = (name) => {
    const m = new RegExp(`^${name}:\\s+(\\d+) kB`, 'm').exec(text);
    return m ? Number(m[1]) * 1024 : 0;
  };
  return { total: field('MemTotal'), available: field('MemAvailable') };
}

function heavyProcessCount() {
  let out;
  try {
    out = execFileSync('sh', ['-c', 'ps -eo args 2>/dev/null || true'], {
      encoding: 'utf8',
      timeout: 5000,
    });
  } catch {
    return 0;
  }
  return out
    .split('\n')
    .filter(Boolean)
    .filter((line) => HEAVY_PROCESS_PATTERNS.some((re) => re.test(line))).length;
}

/**
 * Classify the host. `sample` injection makes the classification pure and
 * hermetically testable; production callers omit it. FORESIFT_GOVERNOR_STATE
 * forces the verdict (operator drill + hermetic supervisor wiring tests) —
 * the live sample is still computed first so the returned shape carries real
 * numbers, but the STATE is the forced one.
 */
export function classifyHostState(sample = null) {
  const forced = process.env.FORESIFT_GOVERNOR_STATE;
  const { total, available, heavyProcesses } =
    sample ??
    (() => {
      const mem = memInfo();
      return { total: mem.total, available: mem.available, heavyProcesses: heavyProcessCount() };
    })();
  if (!total || total <= 0)
    return {
      state: forced ?? 'YELLOW',
      availableFrac: 0,
      heavyProcesses,
      reason: forced
        ? `FORESIFT_GOVERNOR_STATE=${forced} override`
        : 'unreadable memory info — conservative floor',
    };
  const availableFrac = available / total;
  if (forced)
    return {
      state: forced,
      availableFrac,
      heavyProcesses,
      reason: `FORESIFT_GOVERNOR_STATE=${forced} override`,
    };
  const d = RESOURCE_GOVERNOR_DEFAULTS;
  if (availableFrac < d.redMemoryFrac || heavyProcesses >= d.redHeavyProcesses)
    return {
      state: 'RED',
      availableFrac,
      heavyProcesses,
      reason: 'memory/process pressure critical',
    };
  if (availableFrac < d.orangeMemoryFrac || heavyProcesses >= d.orangeHeavyProcesses)
    return {
      state: 'ORANGE',
      availableFrac,
      heavyProcesses,
      reason: 'memory/process pressure elevated',
    };
  if (availableFrac < d.yellowMemoryFrac || heavyProcesses >= d.yellowHeavyProcesses)
    return {
      state: 'YELLOW',
      availableFrac,
      heavyProcesses,
      reason: 'memory/process pressure moderate',
    };
  return { state: 'GREEN', availableFrac, heavyProcesses, reason: 'host healthy' };
}

/** May the governor allow this launch/action? Returns { allow, reason }. */
export function admitUnderGovernor(hostState, action) {
  switch (hostState.state) {
    case 'GREEN':
      return { allow: true, reason: 'host healthy' };
    case 'YELLOW':
      // No concurrency increase; existing work continues.
      return { allow: false, reason: 'YELLOW: no concurrency increase' };
    case 'ORANGE':
      if (action?.heavy === true)
        return { allow: false, reason: 'ORANGE: no new heavy/PGlite work' };
      return { allow: false, reason: 'ORANGE: reduce new AI starts' };
    case 'RED':
    default:
      return { allow: false, reason: 'RED: no new launches' };
  }
}

// ── Upward-recovery hysteresis (H3 mission item 5) ───────────────────────────
// A single healthy sample must NOT re-open concurrency expansion: load and
// heavy-process counts oscillate naturally between waves (a finished test
// process frees memory for one /proc sample, then the next wave re-occupies
// it). Without hysteresis the supervisor oscillates GREEN↔YELLOW every tick —
// launching into pressure, backing off, launching again. Upward recovery
// requires GOVERNOR_RECOVERY_CONFIRMATIONS consecutive healthy observations;
// any degraded observation resets the streak. Downward transitions (GREEN →
// worse) are always immediate — never hysteresis on entering pressure.
export const GOVERNOR_RECOVERY_CONFIRMATIONS = 3;

/**
 * Advance the recovery streak with one observation. Returns the EFFECTIVE
 * state: a freshly recovered GREEN is only reported after enough consecutive
 * healthy samples; until then the effective state stays at the degraded floor
 * of the recent past. Pure bookkeeping — no I/O.
 *
 * @param {string} observedState the classifyHostState verdict for this tick
 * @param {{state: string, streak: number}} prior previous tracker (null ⇒ fresh)
 * @param {number} [confirmations=GOVERNOR_RECOVERY_CONFIRMATIONS]
 * @returns {{state: string, streak: number, recovered: boolean}}
 */
export function advanceGovernorRecovery(
  observedState,
  prior = null,
  confirmations = GOVERNOR_RECOVERY_CONFIRMATIONS,
) {
  const observed = String(observedState ?? 'GREEN').toUpperCase();
  const prev = prior ?? { state: observed, streak: 0 };
  if (observed === 'GREEN') {
    if (prev.state === 'GREEN') return { state: 'GREEN', streak: prev.streak + 1, recovered: true };
    // Still climbing out of pressure: count consecutive healthy samples.
    const streak = prev.streak + 1;
    const recovered = streak >= confirmations;
    return recovered
      ? { state: 'GREEN', streak, recovered: true }
      : { state: prev.state, streak, recovered: false };
  }
  // Any degraded observation: the effective state drops IMMEDIATELY and the
  // streak resets (pressure entry is never smoothed).
  return { state: observed, streak: 0, recovered: false };
}
