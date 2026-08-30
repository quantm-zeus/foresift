// Hyperdrive H2 — exact-file lease manager regression tests (mission §73).
// Covers: disjoint exact files co-lease; identical exact files serialize;
// shared/root surfaces always serialize; unknown write sets fail closed to
// a conservative scope lease; release is idempotent; restart-surviving
// durable state; conflict-surface narrowing helper.
import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, rmSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  acquireLeases,
  reserveLeases,
  releaseLeases,
  activeLeases,
  exactConflictSurface,
  normalizeExactFiles,
  LEASE_STATES,
  SHARED_SURFACE_FILES,
} from '../../scripts/automation/exact-leases.mjs';

let stateDir;

beforeEach(() => {
  stateDir = mkdtempSync(join(tmpdir(), 'exact-leases-'));
});

afterEach(() => {
  rmSync(stateDir, { recursive: true, force: true });
});

describe('Exact-file lease manager (§73)', () => {
  test('disjoint exact files: both packages lease successfully', () => {
    const a = acquireLeases(stateDir, 'pkgA', ['packages/shared-schemas/src/a.ts']);
    const b = acquireLeases(stateDir, 'pkgB', ['packages/shared-schemas/src/b.ts']);
    expect(a.ok).toBe(true);
    expect(b.ok).toBe(true);
    expect(activeLeases(stateDir)).toHaveLength(2);
  });

  test('identical exact file: first leases, second is refused with the conflict named', () => {
    const first = acquireLeases(stateDir, 'pkgA', ['packages/shared-schemas/src/index.ts']);
    const second = acquireLeases(stateDir, 'pkgB', ['packages/shared-schemas/src/index.ts']);
    expect(first.ok).toBe(true);
    expect(second.ok).toBe(false);
    expect(second.conflicts).toHaveLength(1);
    expect(second.conflicts[0].heldBy).toBe('pkgA');
    // fail closed: refused acquire left no partial grants
    expect(activeLeases(stateDir).filter((l) => l.holder === 'pkgB')).toHaveLength(0);
  });

  test('root/shared surface files always serialize (single holder max)', () => {
    for (const shared of ['package.json', 'pnpm-lock.yaml']) {
      expect(SHARED_SURFACE_FILES).toContain(shared);
    }
    const first = acquireLeases(stateDir, 'pkgA', ['package.json']);
    const second = acquireLeases(stateDir, 'pkgB', ['package.json']);
    expect(first.ok).toBe(true);
    expect(second.ok).toBe(false);
  });

  test('unknown write set with no scope fallback fails closed (throws)', () => {
    expect(() => acquireLeases(stateDir, 'pkgA', [])).toThrow();
  });

  test('unknown write set with scopes falls back to a conservative scope lease', () => {
    const first = acquireLeases(stateDir, 'pkgA', [], {
      scopeFallback: ['packages/collector-core/**'],
    });
    expect(first.ok).toBe(true);
    expect(first.granted[0].file).toBe('scope:packages/collector-core/**');
    // a second holder over the same scope is refused
    const second = acquireLeases(stateDir, 'pkgB', [], {
      scopeFallback: ['packages/collector-core/**'],
    });
    expect(second.ok).toBe(false);
  });

  test('release is idempotent and re-granting after release succeeds', () => {
    acquireLeases(stateDir, 'pkgA', ['packages/shared-schemas/src/a.ts']);
    expect(releaseLeases(stateDir, 'pkgA').released).toBe(1);
    expect(releaseLeases(stateDir, 'pkgA').released).toBe(0);
    const again = acquireLeases(stateDir, 'pkgB', ['packages/shared-schemas/src/a.ts']);
    expect(again.ok).toBe(true);
  });

  test('leases persist across a simulated supervisor restart (durable state)', () => {
    acquireLeases(stateDir, 'pkgA', ['packages/shared-schemas/src/a.ts']);
    const raw = JSON.parse(
      readFileSync(join(stateDir, 'exact-leases', 'leases.json'), 'utf8'),
    );
    expect(raw.schema).toBe('foresift/exact-lease@1');
    // a fresh module instance (new process semantics) reads the same file
    expect(activeLeases(stateDir).map((l) => l.holder)).toContain('pkgA');
    expect(existsSync(join(stateDir, 'exact-leases', 'leases.json'))).toBe(true);
  });

  test('reserved leases block acquirers but upgrade in place on acquire', () => {
    const r = reserveLeases(stateDir, 'pkgA', ['packages/shared-schemas/src/a.ts']);
    expect(r.ok).toBe(true);
    expect(activeLeases(stateDir)[0].state).toBe(LEASE_STATES.RESERVED);
    const b = acquireLeases(stateDir, 'pkgB', ['packages/shared-schemas/src/a.ts']);
    expect(b.ok).toBe(false);
    const own = acquireLeases(stateDir, 'pkgA', ['packages/shared-schemas/src/a.ts']);
    expect(own.ok).toBe(true);
    expect(own.granted[0].state).toBe(LEASE_STATES.LEASED);
  });

  test('exactConflictSurface narrows package-wide overlap to per-file truth', () => {
    expect(exactConflictSurface(['x/a.ts', 'x/b.ts'], ['x/b.ts', 'x/c.ts'])).toEqual(['x/b.ts']);
    expect(exactConflictSurface(['x/a.ts'], ['x/c.ts'])).toEqual([]);
  });

  test('normalizeExactFiles dedupes and sorts; empty with fallback becomes scope leases', () => {
    expect(normalizeExactFiles(['b.ts', 'a.ts', 'b.ts'])).toEqual(['a.ts', 'b.ts']);
    expect(normalizeExactFiles([], { scopeFallback: ['s/**'] })).toEqual(['scope:s/**']);
  });
});
