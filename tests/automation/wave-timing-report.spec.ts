// Directive 2026-09-06 §6 — wave phase-split timing telemetry.
//
// Live evidence: core-batch-1 (run fbbcb1d7) burned 64m35s of writer wall
// clock on already-satisfied units and nobody could SEE the split between
// productive writer time, reconciliation, control-plane prep, and waits — the
// reports existed as separate files but no phase accounting joined them.
//
// Laws under test:
//   1. waveTimingReport(artifactsDir): reads the run's artifact set and
//      returns a machine-readable phase table with wall-clock seconds per
//      phase: prep (base-head → task-graph), reconciliation, parallelism
//      audit, lanes (per-lane writer telemetry), fast verdict, integration.
//   2. Zero-AI: pure file arithmetic (mtime deltas + telemetry JSON), no
//      provider calls, no mutation of the artifacts.
//   3. Fail-closed-tolerant: a missing artifact contributes an UNKNOWN phase
//      entry (explicitly marked absent) — never a fabricated duration, never
//      a thrown error for absent optional files.
//   4. The lanes phase carries per-lane outcome + wallTimeMs from
//      foresift/lane-telemetry@1 so provider-sunk time is directly visible.
//   5. Wire-blindness is forbidden: the wave-settled/land tail must invoke
//      the generator and mirror the report (structural yaml proof).
import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, utimesSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const { waveTimingReport } = await import('../../scripts/automation/wave-timing-report.mjs');

let ROOT: string;
const T0 = 1_700_000_000_000; // fixed epoch base for deterministic mtimes

function touch(rel: string, atMs: number, content = '{}'): void {
  const p = join(ROOT, rel);
  mkdirSync(join(p, '..'), { recursive: true });
  writeFileSync(p, content);
  utimesSync(p, new Date(atMs), new Date(atMs));
}

function laneTelemetry(lane: string, atMs: number, over: Record<string, unknown> = {}): void {
  touch(
    join('writer-results', lane, 'telemetry.json'),
    atMs,
    JSON.stringify({
      schema: 'foresift/lane-telemetry@1',
      lane,
      wallTimeMs: 90_000,
      outcome: 'SUCCESS',
      ...over,
    }),
  );
}

beforeEach(() => {
  ROOT = mkdtempSync(join(tmpdir(), 'wave-timing-'));
  touch('base-head.txt', T0, '57bc656\n');
  touch('task-graph.json', T0 + 60_000);
});

afterEach(() => {
  try {
    rmSync(ROOT, { recursive: true, force: true });
  } catch {}
});

describe('waveTimingReport: phase-split wall-clock accounting', () => {
  test('prep phase = base-head → task-graph mtime delta', () => {
    const r = waveTimingReport({ root: ROOT });
    const prep = r.phases.find((p: { id: string }) => p.id === 'prep');
    expect(prep?.seconds).toBe(60);
  });

  test('reconciliation and parallelism phases appear when their reports exist', () => {
    // Real wiring order (prep node): graph → reconcile → audit. Each phase is
    // the delta from its predecessor's artifact.
    touch('pre-provider-reconciliation.json', T0 + 90_000);
    touch('parallelism-audit.json', T0 + 120_000);
    const r = waveTimingReport({ root: ROOT });
    const recon = r.phases.find((p: { id: string }) => p.id === 'reconciliation');
    const audit = r.phases.find((p: { id: string }) => p.id === 'parallelism_audit');
    expect(recon?.seconds).toBe(30);
    expect(audit?.seconds).toBe(30);
  });

  test('absent optional artifacts yield explicitly-unknown phases, never fabricated durations', () => {
    const r = waveTimingReport({ root: ROOT });
    const recon = r.phases.find((p: { id: string }) => p.id === 'reconciliation');
    expect(recon?.seconds).toBeNull();
    expect(recon?.present).toBe(false);
  });

  test('lane phase aggregates per-lane telemetry with outcome and wallTimeMs', () => {
    laneTelemetry('core', T0 + 180_000, { wallTimeMs: 120_000, outcome: 'SUCCESS' });
    laneTelemetry('shard-1', T0 + 180_000, { wallTimeMs: 30_000, outcome: 'TIMEOUT' });
    const r = waveTimingReport({ root: ROOT });
    const lanes = r.phases.find((p: { id: string }) => p.id === 'lanes');
    expect(lanes?.lanes).toHaveLength(2);
    const core = lanes?.lanes?.find((l: { lane: string }) => l.lane === 'core');
    expect(core?.wallTimeMs).toBe(120_000);
    expect(core?.outcome).toBe('SUCCESS');
    expect(lanes?.writerWallTimeMs).toBe(150_000);
  });

  test('missing lane telemetry is recorded as an absent entry (no fabrication)', () => {
    const r = waveTimingReport({ root: ROOT });
    const lanes = r.phases.find((p: { id: string }) => p.id === 'lanes');
    expect(lanes?.present).toBe(false);
    expect(lanes?.writerWallTimeMs).toBeNull();
  });

  test('schema + totals: report carries schema and sums known phases', () => {
    touch('pre-provider-reconciliation.json', T0 + 90_000);
    const r = waveTimingReport({ root: ROOT });
    expect(r.schema).toBe('foresift/wave-timing@1');
    // prep(60) + recon(30): known phases only; unknown never counted
    expect(r.accountedSeconds).toBe(90);
  });
});

describe('production wiring: the wave tail mirrors the timing report', () => {
  test('sharded-wave integrate-and-fast invokes wave-timing-report.mjs', () => {
    const { readFileSync } = require('node:fs');
    const yaml = readFileSync(
      join(
        import.meta.dir,
        '..',
        '..',
        '.archon',
        'workflows',
        'foresift',
        'foresift-sharded-wave.yaml',
      ),
      'utf8',
    );
    expect(yaml).toContain('wave-timing-report.mjs');
  });
});
