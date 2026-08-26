// Regression tests for the throughput-optimization control surface (task spec
// §25 items 11–23). Every behavioral claim made in ADR-0006 and the PRD-
// subordinate task spec gets a positive AND a negative test: profiles are
// deterministic, checkpoints invalidate on any source change, attestations
// reuse ONLY on full identity match, and dedupe is provable-or-nothing.

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import {
  buildCheckpoint,
  parseTasksMd,
  sha256File,
  validateCheckpoint,
} from '../../scripts/automation/package-checkpoint.mjs';
import {
  attestationDrift,
  attestationIdentity,
} from '../../scripts/automation/package-full-gate.mjs';
import { classifyCommand } from '../../scripts/automation/verify-dedupe.mjs';
import { throughputProfile } from '../../scripts/automation/work-package-throughput-profile.mjs';

const SCRIPTS = join(import.meta.dirname, '..', '..', 'scripts', 'automation');

let fx: string;
beforeAll(() => {
  fx = mkdtempSync(join(tmpdir(), 'foresift-throughput-'));
});
afterAll(() => {
  rmSync(fx, { recursive: true, force: true });
});

const write = (rel: string, content: string) => {
  const p = join(fx, rel);
  mkdirSync(join(p, '..'), { recursive: true });
  writeFileSync(p, content);
  return p;
};

describe('11–12. deterministic throughput profile', () => {
  it('maps g0-contracts-data-truth to LEGACY and every other package to OPTIMIZED', () => {
    expect(throughputProfile('g0-contracts-data-truth')).toBe('LEGACY');
    expect(throughputProfile('g1-security-perimeter')).toBe('OPTIMIZED');
    expect(throughputProfile('anything-at-all')).toBe('OPTIMIZED');
    // Deterministic across repeats — no environment or state input.
    expect(throughputProfile('g0-contracts-data-truth')).toBe(
      throughputProfile('g0-contracts-data-truth'),
    );
  });

  it('CLI prints JSON and refuses usage errors (exit 2)', () => {
    const ok = execFileSync(
      'node',
      [join(SCRIPTS, 'work-package-throughput-profile.mjs'), 'g0-contracts-data-truth'],
      {
        encoding: 'utf8',
      },
    );
    expect(JSON.parse(ok)).toEqual({ packageId: 'g0-contracts-data-truth', profile: 'LEGACY' });
    let code = 0;
    try {
      execFileSync('node', [join(SCRIPTS, 'work-package-throughput-profile.mjs')], {
        stdio: 'pipe',
      });
    } catch (e) {
      code = (e as { status?: number }).status ?? -1;
    }
    expect(code).toBe(2);
  });

  it('NEGATIVE: no package id can be smuggled into the LEGACY lane by casing', () => {
    expect(throughputProfile('G0-Contracts-Data-Truth')).toBe('OPTIMIZED');
  });
});

// (The §13 FAST touched-file selection tests were superseded by the impact-
// aware classifier coverage in v2-throughput.spec.ts — V2 task spec §7.)

describe('14. durable implementation checkpoint', () => {
  it('counts Spec Kit checkboxes and hashes sources at build time', () => {
    expect(parseTasksMd('- [x] T001\n- [ ] T002\n- [x] T003\n')).toEqual({
      completed: 2,
      total: 3,
      remaining: 1,
    });
    const src = write('cp/tasks.md', '- [x] T001\n');
    const cp = buildCheckpoint({
      packageId: 'p',
      headSha: 'deadbeef',
      tasks: parseTasksMd('- [x] T001\n- [ ] T002'),
      slice: { id: 'S1', taskIds: ['T001'] },
      sources: { tasks: src },
    });
    expect(cp.sourceHashes.tasks?.sha256).toBe(sha256File(src));
    expect(validateCheckpoint(cp)).toEqual({ valid: true, reasons: [] });
  });

  it('NEGATIVE: invalidates when HEAD moves or ANY source hash changes', () => {
    const src = write('cp/invalidate.md', 'original\n');
    const cp = buildCheckpoint({
      packageId: 'p',
      headSha: 'aaa111',
      tasks: { completed: 1, total: 2, remaining: 1 },
      slice: {},
      sources: { s: src },
    });
    write('cp/invalidate.md', 'tampered\n');
    const verdict = validateCheckpoint(cp, { packageId: 'p', headSha: 'bbb222' });
    expect(verdict.valid).toBe(false);
    expect(verdict.reasons.join(' | ')).toMatch(/HEAD moved/);
    expect(verdict.reasons.join(' | ')).toMatch(/source 's' changed/);
  });

  it('NEGATIVE: wrong schema is rejected; present-at-build sources may not vanish', () => {
    expect(validateCheckpoint({ schema: 'other' }).valid).toBe(false);
    const ghost = write('cp/vanished.md', 'here at build time\n');
    const cp = buildCheckpoint({
      packageId: 'p',
      headSha: 'h',
      tasks: { completed: 0, total: 0, remaining: 0 },
      slice: {},
      sources: { ghost },
    });
    rmSync(ghost);
    expect(validateCheckpoint(cp).reasons.join(' ')).toMatch(/no longer exists/);
  });

  it('sources absent at build stay valid while absent and invalidate when they appear', () => {
    // Optional plan artifacts are recorded with a null hash when they do not
    // exist yet. Still-absent means nothing drifted; appearing later means the
    // cached context never saw a file now sitting at a tracked path.
    const absent = write('cp/placeholder-not-created-yet', 'x');
    rmSync(absent);
    const cp = buildCheckpoint({
      packageId: 'p',
      headSha: 'h',
      tasks: { completed: 0, total: 0, remaining: 0 },
      slice: {},
      sources: { plan: absent },
    });
    expect(cp.sourceHashes.plan?.sha256).toBeNull();
    expect(validateCheckpoint(cp)).toEqual({ valid: true, reasons: [] });
    write('cp/placeholder-not-created-yet', 'appeared after build\n');
    const verdict = validateCheckpoint(cp);
    expect(verdict.valid).toBe(false);
    expect(verdict.reasons.join(' ')).toMatch(/source 'plan' appeared since checkpoint/);
  });

  it('buildCheckpoint requires the identity fields it cannot derive', () => {
    expect(() =>
      buildCheckpoint({
        packageId: '',
        headSha: 'h',
        tasks: { completed: 0, total: 0, remaining: 0 },
        slice: {},
      }),
    ).toThrow(/packageId.*required/);
  });
});

describe('15. FULL-gate attestation identity', () => {
  it('identity is complete: head, risk, lock, authorities, gate code, toolchain', () => {
    const id = attestationIdentity({
      packageId: 'g0-contracts-data-truth',
      repoRoot: process.cwd(),
    });
    expect(id.headSha).toMatch(/^[0-9a-f]{40}$/);
    expect(id.risk).toBeDefined();
    expect(id.pnpmLockHash).toMatch(/^[0-9a-f]{64}$/);
    for (const v of Object.values(id.authorityHashes)) expect(v).toMatch(/^([0-9a-f]{64}|null)$/);
    for (const v of Object.values(id.gateImplementationHashes)) expect(v).toMatch(/^[0-9a-f]{64}$/);
    expect(Object.keys(id.toolchain)).toContain('node');
  });

  it('POSITIVE: identical identities produce zero drift → reuse allowed', () => {
    const id = attestationIdentity({
      packageId: 'g0-contracts-data-truth',
      repoRoot: process.cwd(),
    });
    expect(attestationDrift(structuredClone(id), id)).toBeNull();
  });

  it('NEGATIVE: any single changed field — head, lock, risk, gate code — is reported', () => {
    const current = attestationIdentity({
      packageId: 'g0-contracts-data-truth',
      repoRoot: process.cwd(),
    });
    for (const mutate of [
      (c: typeof current) => void (c.headSha = '0'.repeat(40)),
      (c: typeof current) => void (c.pnpmLockHash = 'f'.repeat(64)),
      (c: typeof current) => void (c.risk = c.risk === 'HIGH' ? 'CRITICAL' : 'HIGH'),
      (c: typeof current) => void (c.gateImplementationHashes.gate = 'a'.repeat(64)),
      (c: typeof current) => void (c.authorityHashes.currentMilestone = 'b'.repeat(64)),
      (c: typeof current) => void (c.toolchain.node = 'v0.0.0'),
    ]) {
      const mutated = structuredClone(current);
      mutate(mutated);
      const drift = attestationDrift(current, mutated);
      expect(drift).not.toBeNull();
      expect(drift?.length).toBe(1);
    }
  });

  it('attested record shape round-trips through the drift checker (flat form)', () => {
    const id = attestationIdentity({
      packageId: 'g0-contracts-data-truth',
      repoRoot: process.cwd(),
    });
    const record = { ...structuredClone(id), result: 'PASS', timestamp: new Date().toISOString() };
    expect(attestationDrift(record, id)).toBeNull();
    const tampered = structuredClone(record);
    tampered.gateImplementationHashes.runner = createHash('sha256').update('x').digest('hex');
    expect(attestationDrift(tampered, id)).toEqual(['gateImplementationHashes.runner']);
  });
});

describe('16–17. proven-only verification dedupe classifier', () => {
  const pkgRoot = () => {
    const root = mkdtempSync(join(fx, '/dedupe-'));
    mkdirSync(join(root, 'packages', 'alpha'), { recursive: true });
    writeFileSync(
      join(root, 'packages', 'alpha', 'package.json'),
      JSON.stringify({ name: '@foresift/alpha', scripts: { test: 'vitest run' } }),
    );
    writeFileSync(join(root, 'packages', 'alpha', 'core.test.ts'), 'it("x", () => {});\n');
    return root;
  };
  const cmdFor = (root: string) =>
    `test -d ${join(root, 'packages', 'alpha')} && pnpm --filter @foresift/alpha test`;

  it('POSITIVE: plain vitest run + no local config ⇒ PROVEN duplicate of the full suite', () => {
    const root = pkgRoot();
    const verdict = classifyCommand(cmdFor(root), root);
    expect(verdict.class).toBe('DUPLICATE_COVERED_BY_FULL_SUITE');
    expect(verdict.reason).toMatch(/root suite covers all of them/);
  });

  it('NEGATIVE: a package-local vitest config destroys the proof ⇒ unique', () => {
    const root = pkgRoot();
    writeFileSync(join(root, 'packages', 'alpha', 'vitest.config.ts'), 'export default {};\n');
    expect(classifyCommand(cmdFor(root), root).class).toBe('UNIQUE_MANDATORY');
  });

  it.each([
    ['wrapped test script', { test: 'vitest run --coverage' }],
    ['composite test script', { test: 'eslint . && vitest run' }],
    ['missing test script', {}],
  ])('NEGATIVE: %s ⇒ unique (deduped only with proof)', (_name, scripts) => {
    const root = pkgRoot();
    writeFileSync(
      join(root, 'packages', 'alpha', 'package.json'),
      JSON.stringify({ name: '@foresift/alpha', scripts }),
    );
    expect(classifyCommand(cmdFor(root), root).class).toBe('UNIQUE_MANDATORY');
  });

  it('prohibited-capabilities scan is ALWAYS unique-mandatory', () => {
    expect(classifyCommand('node scripts/scan-prohibited-capabilities/cli.mjs', fx).class).toBe(
      'UNIQUE_MANDATORY',
    );
  });

  it('NEGATIVE: unknown command shapes never get deduped', () => {
    expect(classifyCommand('pnpm --filter @weird/x custom-check', fx).class).toBe(
      'UNIQUE_MANDATORY',
    );
    expect(classifyCommand('echo hello', fx).class).toBe('UNIQUE_MANDATORY');
  });
});
