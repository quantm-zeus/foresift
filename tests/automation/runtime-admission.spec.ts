// Hyperdrive H2 — runtime admission bridge regression tests (mission §17/§20/
// §41/§73): global permits + exact-file leases join the supervisor's launch
// path, and every terminal path (PROVEN, cancelled, fatal pause) releases.
import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, rmSync, existsSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  admitPackageLaunch,
  releasePackageRuntime,
  providersForProfile,
} from '../../scripts/automation/runtime-admission.mjs';
import {
  observeCodexOutcome,
  acquireLanePermit,
  releaseLanePermit,
} from '../../scripts/automation/provider-pool.mjs';
import { activeLeases } from '../../scripts/automation/exact-leases.mjs';

let stateDir: string;

const PKG = { id: 'pkg-a', writeScopes: ['packages/a/**'] };

beforeEach(() => {
  stateDir = mkdtempSync(join(tmpdir(), 'runtime-admission-'));
});

afterEach(() => {
  rmSync(stateDir, { recursive: true, force: true });
});

describe('profile → provider sets', () => {
  test('every profile requires claude (the §20 fallback engine)', () => {
    expect(providersForProfile('HYBRID_AGY')).toContain('claude');
    expect(providersForProfile('CODEX_AGY')).toContain('claude');
    expect(providersForProfile('CLAUDE_AGY')).toContain('claude');
    expect(providersForProfile('CODEX_AGY')).toContain('codex');
    expect(providersForProfile('HYBRID_AGY')).toContain('codex');
    expect(providersForProfile('CLAUDE_AGY')).not.toContain('codex');
  });

  test('unknown profiles fail closed', () => {
    expect(() => providersForProfile('LEGACY_AGY')).toThrow();
    expect(admitPackageLaunch(stateDir, PKG, 'LEGACY_AGY').ok).toBe(false);
  });
});

describe('launch admission (§17 global pool, §41 leases)', () => {
  test('admitted launch holds no run-level permits (lane permits own runtime counts); co-runner with distinct scopes co-admits', () => {
    const a = admitPackageLaunch(stateDir, PKG, 'HYBRID_AGY');
    expect(a.ok).toBe(true);
    // Review finding 2: writers hold their own lane permits at dispatch — a
    // package-level claude/codex reservation would double-count and deny the
    // third concurrent lane under default policy.
    expect(a.providers).toEqual([]);
    // Disjoint scopes co-run against the same global pools.
    const c = admitPackageLaunch(
      stateDir,
      { id: 'pkg-c', writeScopes: ['packages/c/**'] },
      'CLAUDE_AGY',
    );
    expect(c.ok).toBe(true);
    releasePackageRuntime(stateDir, { providers: a.providers, packageId: 'pkg-a', runId: 'r1' });
    releasePackageRuntime(stateDir, { providers: c.providers, packageId: 'pkg-c' });
  });

  test('§41: shared-surface overlap serializes through the lease file', () => {
    // Both packages declare scopes that reach the root package.json surface.
    const rootScope = { id: 'pkg-root', writeScopes: ['package.json', 'packages/x/**'] };
    const a = admitPackageLaunch(stateDir, rootScope, 'HYBRID_AGY');
    expect(a.ok).toBe(true);
    expect(a.leases).toContain('package.json');
    const b = admitPackageLaunch(
      stateDir,
      { id: 'pkg-other', writeScopes: ['package.json'] },
      'HYBRID_AGY',
    );
    expect(b.ok).toBe(false);
    expect(b.reason).toContain('LEASE_CONFLICT');
    expect(b.reason).toContain('pkg-root');
    // release frees the surface
    releasePackageRuntime(stateDir, { providers: a.providers, packageId: 'pkg-root' });
    const c = admitPackageLaunch(
      stateDir,
      { id: 'pkg-other', writeScopes: ['package.json'] },
      'HYBRID_AGY',
    );
    expect(c.ok).toBe(true);
    releasePackageRuntime(stateDir, { providers: c.providers, packageId: 'pkg-other' });
  });

  test('claude pool saturation denies every profile (fallback engine unavailable) — probe sees lanes too', () => {
    // Review finding 2: the admission probe acquires against the SAME pool
    // the lanes do, so three admitted lanes saturate a limit-3 pool and the
    // next launch is refused even though nothing is held at package level.
    const policy = JSON.stringify({
      claude: { initial: 3, normalTarget: 5, burstTarget: 8, hardCap: 10 },
    });
    writeFileSync(join(stateDir, 'provider-pools.policy.json'), policy);
    const lanes = ['l1', 'l2', 'l3'].map((l) =>
      acquireLanePermit(stateDir, `pkg-a:0:${l}`, 'claude'),
    );
    for (const p of lanes) expect(p.ok).toBe(true);
    const denied = admitPackageLaunch(stateDir, PKG, 'CLAUDE_AGY');
    expect(denied.ok).toBe(false);
    expect(denied.reason).toContain('POOL_AT_LIMIT');
    for (const l of ['l1', 'l2', 'l3']) releaseLanePermit(stateDir, `pkg-a:0:${l}`, 'claude');
    const admitted = admitPackageLaunch(stateDir, PKG, 'CLAUDE_AGY');
    expect(admitted.ok).toBe(true);
    releasePackageRuntime(stateDir, { providers: admitted.providers, packageId: 'pkg-a' });
  });

  test('§20: Codex exhaustion still admits HYBRID (Codex rides per-lane routing); CODEX_AGY keeps run-level codex permit', () => {
    observeCodexOutcome(stateDir, { event: 'exhausted', resetAt: Date.now() + 3_600_000 });
    const hybrid = admitPackageLaunch(stateDir, PKG, 'HYBRID_AGY');
    expect(hybrid.ok).toBe(true);
    // Lane-bearing engines hold nothing at run level (review finding 2) —
    // HYBRID admission proceeds; per-lane codex writers will be denied by
    // the quota state and reroute to Claude via routing.
    expect(hybrid.providers).toEqual([]);
    releasePackageRuntime(stateDir, { providers: hybrid.providers, packageId: 'pkg-a' });
    // CODEX_AGY holds a package-level codex permit: exhausted quota denies it outright.
    const codexOnly = admitPackageLaunch(stateDir, PKG, 'CODEX_AGY');
    expect(codexOnly.ok).toBe(false);
    expect(codexOnly.reason).toContain('CODEX_QUOTA_');
  });

  test('denied admission leaves no partial permits or leases (fail-closed unwind)', () => {
    const r = admitPackageLaunch(stateDir, null, 'HYBRID_AGY');
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('INVALID_PACKAGE');
    expect(existsSync(join(stateDir, 'provider-pools.json'))).toBe(false);
    expect(activeLeases(stateDir)).toHaveLength(0);
  });
});

describe('releasePackageRuntime (§73 idempotent terminal release)', () => {
  test('safe on pre-H2 entries with no providers field', () => {
    const r = releasePackageRuntime(stateDir, { packageId: 'pkg-old', runId: 'r0' });
    expect(r.providers).toEqual([]); // nothing to release, no throw
    expect(r.leases).toBe(0);
  });

  test('releases twice without error and never resurrects leases', () => {
    const a = admitPackageLaunch(
      stateDir,
      { id: 'pkg-root', writeScopes: ['package.json'] },
      'HYBRID_AGY',
    );
    expect(a.ok).toBe(true);
    releasePackageRuntime(stateDir, { providers: a.providers, packageId: 'pkg-root', runId: 'r1' });
    const again = releasePackageRuntime(stateDir, {
      providers: a.providers,
      packageId: 'pkg-root',
      runId: 'r1',
    });
    expect(again.leases).toBe(0);
    expect(activeLeases(stateDir).filter((l) => l.holder === 'pkg-root')).toHaveLength(0);
  });
});
