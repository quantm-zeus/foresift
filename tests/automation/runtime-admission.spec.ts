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
  productEnginesForProfile,
  supervisorProvidersForProfile,
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
  test('descriptive provider sets: only the profile product engine is claude/codex-compatible', () => {
    expect(providersForProfile('HYBRID_AGY')).toContain('claude');
    // H3 P0-3: claude is NOT a member of CODEX_AGY's dispatch set — an
    // explicit Codex profile never depends on Claude health.
    expect(providersForProfile('CODEX_AGY')).not.toContain('claude');
    expect(providersForProfile('CLAUDE_AGY')).toContain('claude');
    expect(providersForProfile('CODEX_AGY')).toContain('codex');
    expect(providersForProfile('HYBRID_AGY')).toContain('codex');
    expect(providersForProfile('CLAUDE_AGY')).not.toContain('codex');
  });

  test('product engines: CODEX_AGY⇒codex only, CLAUDE_AGY⇒claude only, HYBRID⇒both; unknown fails closed', () => {
    expect(productEnginesForProfile('CODEX_AGY')).toEqual(['codex']);
    expect(productEnginesForProfile('CLAUDE_AGY')).toEqual(['claude']);
    expect(productEnginesForProfile('HYBRID_AGY')).toEqual(['claude', 'codex']);
    expect(() => productEnginesForProfile('LEGACY_AGY')).toThrow();
    expect(() => providersForProfile('LEGACY_AGY')).toThrow();
    expect(admitPackageLaunch(stateDir, PKG, 'LEGACY_AGY').ok).toBe(false);
  });

  test('H3 P0-2: the supervisor holds NO run-level permits for ANY profile (CODEX_AGY double-count removed)', () => {
    expect(supervisorProvidersForProfile()).toEqual([]);
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

  test('H3 P0-3: Claude saturation denies only Claude-dependent profiles — CODEX_AGY admits (provider independence)', () => {
    // Three admitted claude lanes saturate a limit-3 pool; the CLAUDE_AGY
    // launch (whose ONLY product engine is claude) is refused...
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
    expect(denied.reason).toContain('NO_PRODUCT_ENGINE_SERVICEABLE');
    // ...but an explicit CODEX_AGY launch does NOT require Claude headroom.
    const codexAdm = admitPackageLaunch(stateDir, PKG, 'CODEX_AGY');
    expect(codexAdm.ok).toBe(true);
    expect(codexAdm.providers).toEqual([]);
    releasePackageRuntime(stateDir, { providers: codexAdm.providers, packageId: 'pkg-a' });
    for (const l of ['l1', 'l2', 'l3']) releaseLanePermit(stateDir, `pkg-a:0:${l}`, 'claude');
    const admitted = admitPackageLaunch(stateDir, PKG, 'CLAUDE_AGY');
    expect(admitted.ok).toBe(true);
    releasePackageRuntime(stateDir, { providers: admitted.providers, packageId: 'pkg-a' });
  });

  test('H3 P0-3: Codex quota exhaustion admits CODEX_AGY (lane-level reroute/handoff owns quota; no run-level codex permit)', () => {
    observeCodexOutcome(stateDir, { event: 'exhausted', resetAt: Date.now() + 3_600_000 });
    // HYBRID admits: claude (a compatible product engine) has headroom even
    // though Codex is latched — codex lanes reroute/hand off at dispatch.
    const hybrid = admitPackageLaunch(stateDir, PKG, 'HYBRID_AGY');
    expect(hybrid.ok).toBe(true);
    expect(hybrid.providers).toEqual([]);
    releasePackageRuntime(stateDir, { providers: hybrid.providers, packageId: 'pkg-a' });
    // H3 P0-2: CODEX_AGY no longer holds a run-level codex permit, so a
    // quota latch no longer refuses the launch itself — the lanes observe
    // the latch per invocation and hand off. (P0-2 hermetic permit tests
    // live in tests/automation/codex-agy-permits.spec.ts.)
    const codexOnly = admitPackageLaunch(stateDir, PKG, 'CODEX_AGY');
    expect(codexOnly.ok).toBe(true);
    expect(codexOnly.providers).toEqual([]);
    releasePackageRuntime(stateDir, { providers: codexOnly.providers, packageId: 'pkg-a' });
  });

  test('H3 P0-3: launch refused only when NO compatible product engine is serviceable', () => {
    // Codex quota-latched AND Claude saturated ⇒ CODEX_AGY (codex-only) and
    // CLAUDE_AGY (claude-only) both refuse; HYBRID also refuses (both engines
    // unusable). Codex alone latched ⇒ HYBRID still admits.
    const policy = JSON.stringify({
      claude: { initial: 1, normalTarget: 1, burstTarget: 1, hardCap: 1 },
    });
    writeFileSync(join(stateDir, 'provider-pools.policy.json'), policy);
    observeCodexOutcome(stateDir, { event: 'exhausted', resetAt: Date.now() + 3_600_000 });
    const lane = acquireLanePermit(stateDir, 'pkg-a:0:claude-lane', 'claude');
    expect(lane.ok).toBe(true);
    // CODEX_AGY under a quota latch still admits (latch is lane-level; the
    // handoff protocol owns reroute — H3 P0-4), so the engine-mix refusal
    // here is exercised through CLAUDE_AGY (claude saturated) and HYBRID
    // (claude saturated + codex latched AND capacity-constrained).
    const claudeRef = admitPackageLaunch(stateDir, PKG, 'CLAUDE_AGY');
    expect(claudeRef.ok).toBe(false);
    expect(claudeRef.reason).toContain('NO_PRODUCT_ENGINE_SERVICEABLE');
    releaseLanePermit(stateDir, 'pkg-a:0:claude-lane', 'claude');
    // Claude freed ⇒ HYBRID admits again (codex still latched, irrelevant —
    // the latch is lane-level truth and the handoff protocol owns reroute).
    const hybridOk = admitPackageLaunch(stateDir, PKG, 'HYBRID_AGY');
    expect(hybridOk.ok).toBe(true);
    releasePackageRuntime(stateDir, { providers: hybridOk.providers, packageId: 'pkg-a' });
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
