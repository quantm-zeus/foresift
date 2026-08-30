// V3-B §28 — state-machine / property tests for the supervisor's runtime
// selection path, with DETERMINISTIC SEEDS PERSISTED IN THIS FILE (no
// Math.random anywhere: every generated DAG comes from a hardcoded seed, so a
// failure reproduces forever).
//
// Three layers:
//   1. rankPendingPackages — the exact ORDER the supervisor iterates each tick.
//      Properties: deterministic, total, consistent with the documented score
//      comparison, and pure (never mutates milestone state).
//   2. Same-tick slot-fill simulation — replicates selectAndLaunch's loop over
//      seeded random DAGs using the PRODUCTION packageEligible + canStartPackage
//      as the only eligibility authority. Invariants per launch: concurrency cap,
//      CRITICAL serialization, deps-PROVEN-before-launch; liveness across the
//      whole run: no valid DAG deadlocks; determinism: same seed ⇒ same launch
//      sequence. G0 stays capped at 1 by the same production policy.
//   3. nextPollDelayMs — adaptive handoff cadence table + bounded-streak
//      property sweep (60s base; ~10s fast handoff after launches/discovery;
//      fast streak hard-bounded; quiet tick resets).
import { describe, expect, it } from 'bun:test';
import { canStartPackage, findPackage, packageEligible } from '../../scripts/automation/schema.mjs';
import {
  criticalPathScore,
  rankPendingPackages,
} from '../../scripts/automation/milestone-scheduler.mjs';
import {
  HANDOFF_FAST_STREAK_MAX,
  HANDOFF_POLL_MS,
  POLL_INTERVAL_MS,
  nextPollDelayMs,
} from '../../scripts/automation/foresift-autopilot.mjs';

// ── deterministic PRNG + DAG generation ──────────────────────────────────────

/** mulberry32 — tiny seeded PRNG; seeds below are committed so failures replay. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const RISKS = ['LOW', 'MEDIUM', 'HIGH'] as const;

/** Random acyclic DAG: edges point strictly from lower to higher index. */
function randomDag(
  seed: number,
  n: number,
  edgeProbability: number,
  milestoneId = 'GX',
): { milestoneId: string; packages: SynthPkg[] } {
  const rnd = mulberry32(seed);
  const packages: SynthPkg[] = [];
  for (let i = 0; i < n; i++) {
    const id = `n${String(i).padStart(2, '0')}`;
    const deps: string[] = [];
    if (i > 0) {
      for (let j = 0; j < i; j++) {
        if (rnd() < edgeProbability) deps.push(`n${String(j).padStart(2, '0')}`);
      }
    }
    // Occasional CRITICAL node exercises serialization inside random graphs;
    // non-parallelizable nodes exercise pairing/write-scope refusals.
    const risk = rnd() < 0.12 ? 'CRITICAL' : (RISKS[Math.floor(rnd() * RISKS.length)] ?? 'MEDIUM');
    packages.push({
      id,
      objective: `Deliver ${id}`,
      requirementIds: [`FR-${id.toUpperCase()}-001`],
      dependencies: deps,
      risk,
      parallelizable: rnd() >= 0.15,
      writeScopes: [`packages/${id}/**`],
      verificationCommands: ['pnpm test'],
      status: 'PENDING',
    });
  }
  return { milestoneId, packages };
}

interface SynthPkg {
  id: string;
  objective?: string;
  requirementIds?: string[];
  dependencies?: string[];
  risk?: string;
  parallelizable?: boolean;
  writeScopes?: string[];
  verificationCommands?: string[];
  status?: string;
}

const POLICY = {
  foundationMilestones: ['G0'],
  maxParallelCodingPackagesFoundation: 1,
  maxParallelCodingPackages: 2,
  serialWhenRisk: ['CRITICAL'],
};

const roadmapOf = (milestoneId: string) =>
  ({ policy: { ...POLICY }, currentMilestoneId: milestoneId }) as unknown as Parameters<
    typeof canStartPackage
  >[0];

type CanStartArgs = Parameters<typeof canStartPackage>;
type Ms = Parameters<typeof canStartPackage>[1];
const asMs = (ms: unknown): Ms => ms as Ms;

// ── 1. rankPendingPackages properties ────────────────────────────────────────

describe('rankPendingPackages (V3-B runtime order)', () => {
  it('is deterministic and total: same inputs ⇒ identical full ordering', () => {
    for (const seed of [20260823, 7, 424242]) {
      const dag = randomDag(seed, 18, 0.18) as Ms;
      const first = rankPendingPackages(dag).map((p) => p.id);
      const second = rankPendingPackages(dag).map((p) => p.id);
      expect(second).toEqual(first);
      // Total: EVERY pending package appears exactly once.
      const pendingIds = dag.packages
        .filter((p) => p.status === 'PENDING')
        .map((p) => p.id)
        .sort();
      expect([...first].sort()).toEqual(pendingIds);
    }
  });

  it('ordering agrees with the documented score comparison at every adjacent pair', () => {
    for (const seed of [99, 123456, 555000111]) {
      const dag = asMs(randomDag(seed, 20, 0.22));
      const ranked = rankPendingPackages(dag);
      expect(ranked.length).toBeGreaterThan(1);
      for (let i = 0; i + 1 < ranked.length; i++) {
        const a = criticalPathScore(dag, ranked[i]!);
        const b = criticalPathScore(dag, ranked[i + 1]!);
        const better =
          a.longestDownstreamPath !== b.longestDownstreamPath
            ? a.longestDownstreamPath > b.longestDownstreamPath
            : a.unlockedDownstreamCount !== b.unlockedDownstreamCount
              ? a.unlockedDownstreamCount > b.unlockedDownstreamCount
              : a.riskRank !== b.riskRank
                ? a.riskRank > b.riskRank
                : a.id <= b.id;
        expect(better, `${ranked[i]!.id} must outrank ${ranked[i + 1]!.id}`).toBe(true);
      }
    }
  });

  it('is pure: ranking never mutates milestone state', () => {
    const dag = asMs(randomDag(31337, 14, 0.25));
    const before = JSON.stringify(dag);
    rankPendingPackages(dag);
    expect(JSON.stringify(dag)).toBe(before);
  });

  it('ranks only PENDING packages regardless of dependency shape', () => {
    const ms = asMs({
      milestoneId: 'GX',
      packages: [
        { id: 'done-a', status: 'PROVEN' },
        { id: 'run-b', status: 'RUNNING' },
        { id: 'pend-c', status: 'PENDING', dependencies: ['done-a'] },
        { id: 'pend-d', status: undefined, dependencies: [] },
      ],
    });
    expect(rankPendingPackages(ms).map((p) => p.id)).toEqual(['pend-c', 'pend-d']);
  });
});

// ── 2. same-tick slot-fill state machine over seeded DAGs ────────────────────

/**
 * Mirror of selectAndLaunch's work-package loop (V3-B): candidate order is
 * computed ONCE per tick via rankPendingPackages; every candidate is gated
 * through production packageEligible + canStartPackage against the LIVE
 * running set, which grows with each same-tick launch. Returns this tick's
 * launch sequence (ids in launch order) and mutates statuses like the real
 * supervisor does (PENDING→RUNNING on launch; caller drives RUNNING→PROVEN).
 */
function simulateTick(roadmap: ReturnType<typeof roadmapOf>, ms: Ms, running: SynthPkg[]) {
  const launchedThisTick: string[] = [];
  for (const cand of rankPendingPackages(ms)) {
    if (running.some((r) => r.id === cand.id)) continue; // tracked-active guard
    const elig = packageEligible(ms as never, cand as never) as { eligible: boolean };
    if (!elig.eligible) continue;
    const verdict = canStartPackage(
      roadmap as CanStartArgs[0],
      ms,
      cand as CanStartArgs[2],
      running as unknown as CanStartArgs[3],
    );
    if (!verdict.ok) continue;
    cand.status = 'RUNNING';
    running.push(cand);
    launchedThisTick.push(cand.id);
  }
  return launchedThisTick;
}

/** Full run: fill slots, then complete exactly one running package per round
 *  (worst-case completion order), until everything is PROVEN or rounds stall. */
function simulateRun(seed: number, n: number, milestoneId: string) {
  const roadmap = roadmapOf(milestoneId);
  const ms = asMs(randomDag(seed, n, 0.18, milestoneId));
  const running: SynthPkg[] = [];
  const launchSequence: string[] = [];
  let stalledAtRound: number | null = null;

  for (let round = 0; round <= n * n; round++) {
    const tickLaunches = simulateTick(roadmap, ms, running);
    launchSequence.push(...tickLaunches);

    // Invariants after the tick's fills.
    const foundation = milestoneId === 'G0';
    const max = foundation
      ? POLICY.maxParallelCodingPackagesFoundation
      : POLICY.maxParallelCodingPackages;
    if (running.length > max)
      throw new Error(`cap violated in seed ${seed}: ${running.length} > ${max}`);
    if (running.filter((r) => r.risk === 'CRITICAL').length > 1)
      throw new Error(`CRITICAL co-run in seed ${seed}`);
    for (const cand of tickLaunches) {
      const pkg = findPackage(ms, cand)!;
      for (const dep of pkg.dependencies ?? []) {
        if (findPackage(ms, dep)?.status !== 'PROVEN')
          throw new Error(`dep not PROVEN at launch (${cand}←${dep}) in seed ${seed}`);
      }
    }

    if (running.length === 0) {
      // Nothing running: either everything PROVEN (normal completion) or the
      // scheduler deadlocked on a valid DAG (the bug class this catches).
      if (!ms.packages.every((p) => p.status === 'PROVEN')) stalledAtRound = round;
      break;
    }
    // Complete exactly ONE running package per round (FIFO), forcing many
    // re-selections — a scheduler that could deadlock on a valid DAG fails
    // this bound.
    const finished = running.shift()!;
    finished.status = 'PROVEN';
  }
  const allProven = ms.packages.every((p) => p.status === 'PROVEN');
  return { launchSequence, allProven, stalledAtRound };
}

describe('same-tick slot filling over seeded random DAGs (state machine)', () => {
  // Persisted seeds: any failure reproduces bit-for-bit from these numbers.
  const SEEDS = [8675309, 20260823, 31415926, 271828182, 161803398];

  it('launch sequence is fully deterministic per seed', () => {
    for (const seed of SEEDS) {
      const a = simulateRun(seed, 16, 'GX');
      const b = simulateRun(seed, 16, 'GX');
      expect(b.launchSequence).toEqual(a.launchSequence);
    }
  });

  it('every valid DAG completes: cap/CRITICAL/deps invariants hold throughout', () => {
    for (const seed of SEEDS) {
      const run = simulateRun(seed, 16, 'GX');
      expect({ seed: run.allProven, stalled: run.stalledAtRound }).toEqual({
        seed: true,
        stalled: null,
      });
      expect(run.launchSequence.length).toBe(16); // each package launched exactly once
    }
  });

  it('one tick fills BOTH standard-policy slots when two candidates are eligible', () => {
    // Sparse graphs have multiple dependency-free roots; the very first tick
    // must fill BOTH slots under policy max 2 (launch A → re-evaluate against
    // A → launch B in one cycle).
    for (const seed of SEEDS) {
      const ms = asMs(randomDag(seed, 16, 0.08)); // sparse → several roots
      const roadmap = roadmapOf('GX');
      const running: SynthPkg[] = [];
      const first = simulateTick(roadmap, ms, running);
      expect(first.length).toBe(2);
    }
  });

  it('G0 stays capped at ONE concurrent package even with many eligible roots', () => {
    for (const seed of SEEDS) {
      const ms = asMs(randomDag(seed, 16, 0.05, 'G0'));
      const roadmap = roadmapOf('G0');
      const running: SynthPkg[] = [];
      const first = simulateTick(roadmap, ms, running);
      expect(first.length).toBe(1);
      const second = simulateTick(roadmap, ms, running);
      expect(second).toEqual([]); // foundation slot occupied
    }
  });
});

// ── 3. adaptive handoff cadence ──────────────────────────────────────────────

describe('nextPollDelayMs (V3-B §18 adaptive handoff)', () => {
  it('base cadence is the 60s poll on quiet ticks and resets the streak', () => {
    expect(nextPollDelayMs({ launched: 0, awaitingDiscovery: false, fastStreak: 0 })).toEqual({
      delayMs: POLL_INTERVAL_MS,
      fastStreak: 0,
    });
    expect(nextPollDelayMs({ launched: 0, awaitingDiscovery: false, fastStreak: 6 })).toEqual({
      delayMs: POLL_INTERVAL_MS,
      fastStreak: 0,
    });
    expect(POLL_INTERVAL_MS).toBe(60_000);
  });

  it('drops to the fast handoff rate right after a launch or during discovery', () => {
    expect(nextPollDelayMs({ launched: 1, awaitingDiscovery: false, fastStreak: 0 })).toEqual({
      delayMs: HANDOFF_POLL_MS,
      fastStreak: 1,
    });
    expect(nextPollDelayMs({ launched: 0, awaitingDiscovery: true, fastStreak: 3 })).toEqual({
      delayMs: HANDOFF_POLL_MS,
      fastStreak: 4,
    });
    expect(HANDOFF_POLL_MS).toBe(10_000);
  });

  it('hard-bounds the fast streak, then holds FAST while work stays active/ready (§49)', () => {
    // Streak reaching the bound holds the fast rate while a tracked entry is
    // active — a live wave or waiting CI must not idle the scheduler…
    expect(
      nextPollDelayMs({
        launched: 1,
        awaitingDiscovery: true,
        fastStreak: HANDOFF_FAST_STREAK_MAX,
      }),
    ).toEqual({ delayMs: HANDOFF_POLL_MS, fastStreak: HANDOFF_FAST_STREAK_MAX });
    // …and overshoot inputs are clamped, never amplified.
    expect(nextPollDelayMs({ launched: 2, awaitingDiscovery: true, fastStreak: 999 })).toEqual({
      delayMs: HANDOFF_POLL_MS,
      fastStreak: HANDOFF_FAST_STREAK_MAX,
    });
    // No active work and no ready work: saturated streak reverts to base…
    expect(
      nextPollDelayMs({ launched: 0, awaitingDiscovery: false, fastStreak: 999 }),
    ).toEqual({ delayMs: POLL_INTERVAL_MS, fastStreak: 0 });
    // …but a non-empty ready queue keeps the fast rate even with nothing in flight.
    expect(
      nextPollDelayMs({
        launched: 0,
        awaitingDiscovery: false,
        fastStreak: HANDOFF_FAST_STREAK_MAX,
        readyWork: true,
      }),
    ).toEqual({ delayMs: HANDOFF_POLL_MS, fastStreak: HANDOFF_FAST_STREAK_MAX });
    // Quiet tick (no active, no ready) resets even after a saturated streak.
    expect(
      nextPollDelayMs({
        launched: 0,
        awaitingDiscovery: false,
        fastStreak: 999,
        activeWork: false,
        readyWork: false,
      }),
    ).toEqual({ delayMs: POLL_INTERVAL_MS, fastStreak: 0 });
  });

  it('§49: ACTIVE work or a non-empty ready queue pulls the fast cadence without a fresh launch', () => {
    expect(
      nextPollDelayMs({ launched: 0, awaitingDiscovery: false, fastStreak: 0, activeWork: true }),
    ).toEqual({ delayMs: HANDOFF_POLL_MS, fastStreak: 1 });
    expect(
      nextPollDelayMs({ launched: 0, awaitingDiscovery: false, fastStreak: 3, readyWork: true }),
    ).toEqual({ delayMs: HANDOFF_POLL_MS, fastStreak: 4 });
    // Fully idle project: base cadence, streak reset.
    expect(
      nextPollDelayMs({
        launched: 0,
        awaitingDiscovery: false,
        fastStreak: 0,
        activeWork: false,
        readyWork: false,
      }),
    ).toEqual({ delayMs: POLL_INTERVAL_MS, fastStreak: 0 });
  });

  it('property sweep: output is always a known cadence with a sane streak', () => {
    for (let launched = 0; launched <= 2; launched++) {
      for (const awaitingDiscovery of [false, true]) {
        for (let fastStreak = 0; fastStreak <= 10; fastStreak++) {
          const out = nextPollDelayMs({ launched, awaitingDiscovery, fastStreak });
          expect([POLL_INTERVAL_MS, HANDOFF_POLL_MS]).toContain(out.delayMs);
          expect(out.fastStreak).toBeGreaterThanOrEqual(0);
          expect(out.fastStreak).toBeLessThanOrEqual(HANDOFF_FAST_STREAK_MAX);
          // Deterministic: recomputation is bit-identical.
          expect(nextPollDelayMs({ launched, awaitingDiscovery, fastStreak })).toEqual(out);
        }
      }
    }
  });
});
