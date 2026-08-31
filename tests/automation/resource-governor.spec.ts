// Hyperdrive H3 P1-8 — resource governor. Host states derive from real
// memory/heavy-process samples (injected for hermeticity); admission rules
// gate launches before project-wide scale-up.
import { describe, test, expect } from 'bun:test';
import {
  classifyHostState,
  admitUnderGovernor,
  advanceGovernorRecovery,
  GOVERNOR_RECOVERY_CONFIRMATIONS,
  RESOURCE_GOVERNOR_DEFAULTS,
} from '../../scripts/automation/resource-governor.mjs';

const GiB = 1024 * 1024 * 1024;
const total = 15 * GiB; // the 15 GiB VPS that OOM-killed on 2026-08-28
const sample = (available: number, heavyProcesses: number) => ({
  total,
  available,
  heavyProcesses,
});

describe('host classification (GREEN/YELLOW/ORANGE/RED)', () => {
  test('healthy host is GREEN', () => {
    const s = classifyHostState(sample(9 * GiB, 0));
    expect(s.state).toBe('GREEN');
  });

  test('memory fractions drive thresholds (40/25/15%)', () => {
    expect(classifyHostState(sample(15 * 0.45 * GiB, 0)).state).toBe('GREEN');
    expect(classifyHostState(sample(15 * 0.35 * GiB, 0)).state).toBe('YELLOW');
    expect(classifyHostState(sample(15 * 0.2 * GiB, 0)).state).toBe('ORANGE');
    expect(classifyHostState(sample(15 * 0.1 * GiB, 0)).state).toBe('RED');
  });

  test('heavy-process counts drive thresholds (3/6/10)', () => {
    expect(classifyHostState(sample(9 * GiB, 2)).state).toBe('GREEN');
    expect(classifyHostState(sample(9 * GiB, 3)).state).toBe('YELLOW');
    expect(classifyHostState(sample(9 * GiB, 6)).state).toBe('ORANGE');
    expect(classifyHostState(sample(9 * GiB, 10)).state).toBe('RED');
  });

  test('worst signal wins (high memory + red process count ⇒ RED)', () => {
    expect(classifyHostState(sample(10 * GiB, 12)).state).toBe('RED');
  });

  test('unreadable memory info fails closed (never GREEN)', () => {
    const s = classifyHostState(sample(0, 0));
    expect(s.state).not.toBe('GREEN');
    expect(['YELLOW', 'ORANGE', 'RED']).toContain(s.state);
  });

  test('defaults are the documented thresholds', () => {
    expect(RESOURCE_GOVERNOR_DEFAULTS.redMemoryFrac).toBe(0.15);
    expect(RESOURCE_GOVERNOR_DEFAULTS.yellowHeavyProcesses).toBe(3);
  });
});

describe('launch admission under the governor', () => {
  test('GREEN: normal expansion', () => {
    const s = classifyHostState(sample(9 * GiB, 0));
    expect(admitUnderGovernor(s, { heavy: true }).allow).toBe(true);
  });

  test('YELLOW: no concurrency increase', () => {
    const s = classifyHostState(sample(9 * GiB, 3));
    const verdict = admitUnderGovernor(s, { heavy: false });
    expect(verdict.allow).toBe(false);
    expect(verdict.reason).toContain('YELLOW');
  });

  test('ORANGE: no new heavy/PGlite work, reduced AI starts', () => {
    const s = classifyHostState(sample(9 * GiB, 6));
    const heavy = admitUnderGovernor(s, { heavy: true });
    const light = admitUnderGovernor(s, { heavy: false });
    expect(heavy.allow).toBe(false);
    expect(heavy.reason).toContain('ORANGE');
    expect(light.allow).toBe(false);
    expect(light.reason).toContain('ORANGE');
  });

  test('RED: no new launches at all', () => {
    const s = classifyHostState(sample(9 * GiB, 10));
    const verdict = admitUnderGovernor(s, { heavy: false });
    expect(verdict.allow).toBe(false);
    expect(verdict.reason).toContain('RED');
  });
});

describe('upward-recovery hysteresis (mission item 5)', () => {
  test('a single healthy sample does NOT re-open expansion after pressure', () => {
    // ORANGE host → one GREEN sample → still held at the degraded floor.
    const t = advanceGovernorRecovery('ORANGE', null);
    expect(t.state).toBe('ORANGE');
    const after = advanceGovernorRecovery('GREEN', t);
    expect(after.state).toBe('ORANGE');
    expect(after.recovered).toBe(false);
    expect(admitUnderGovernor({ state: after.state }, { heavy: true }).allow).toBe(false);
  });

  test('several consecutive healthy observations recover GREEN', () => {
    let t = advanceGovernorRecovery('RED', null);
    for (let i = 0; i < GOVERNOR_RECOVERY_CONFIRMATIONS; i++)
      t = advanceGovernorRecovery('GREEN', t);
    expect(t.state).toBe('GREEN');
    expect(t.recovered).toBe(true);
    expect(t.streak).toBe(GOVERNOR_RECOVERY_CONFIRMATIONS);
  });

  test('any degraded observation resets the streak and drops IMMEDIATELY', () => {
    let t = advanceGovernorRecovery('YELLOW', null);
    t = advanceGovernorRecovery('GREEN', t);
    expect(t.state).toBe('YELLOW');
    // Climbing streak interrupted by worse pressure: instant drop, no smoothing.
    t = advanceGovernorRecovery('GREEN', t);
    t = advanceGovernorRecovery('RED', t);
    expect(t.state).toBe('RED');
    expect(t.streak).toBe(0);
  });

  test('steady GREEN stays GREEN (no oscillation penalty)', () => {
    let t = advanceGovernorRecovery('GREEN', null);
    expect(t.state).toBe('GREEN');
    t = advanceGovernorRecovery('GREEN', t);
    expect(t.state).toBe('GREEN');
    expect(t.recovered).toBe(true);
  });
});
