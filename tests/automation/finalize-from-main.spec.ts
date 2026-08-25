import { describe, expect, it } from 'vitest';
import {
  evaluateFinalizationFromMain,
  scanScopedTasks,
  titleCarriesPackage,
} from '../../scripts/automation/finalize-from-main.mjs';

const PKG = 'g0-security-perimeter';
const MAIN = 'a'.repeat(40);

function okFacts(overrides: Record<string, unknown> = {}) {
  return {
    packageId: PKG,
    milestone: { errors: [] as string[], pkg: { id: PKG, status: 'RUNNING' } },
    checkout: { branch: 'main', trackedDirty: false, headSha: MAIN },
    mainSha: MAIN,
    mergedEvidence: {
      number: 52,
      title: `feat(${PKG}): stand up the read-only security perimeter`,
      url: 'https://github.com/quantm-zeus/foresift/pull/52',
      mergeCommitOid: 'b'.repeat(40),
    },
    artifacts: {
      spec: '# spec\n',
      plan: '# plan\n',
      tasks: '- [x] T118 Implement egress allowlists\n- [x] T119 Implement isolation\n',
    },
    ciRuns: [{ databaseId: 1, headSha: MAIN, conclusion: 'success', url: 'ci/1' }],
    archonRows: [],
    trackedRows: [],
    pausedFatal: null,
    ...overrides,
  };
}

describe('finalize-from-main — deterministic fail-closed RUNNING→PROVEN (defect #16 follow-up)', () => {
  it('finalizes when landed truth proves everything, and records the evidence chain', () => {
    const v = evaluateFinalizationFromMain(okFacts());
    expect(v.ok).toBe(true);
    expect(v.reasons).toEqual([]);
    expect(v.evidence.pr?.number).toBe(52);
    expect(v.evidence.ci?.databaseId).toBe(1);
    expect(v.evidence.mainSha).toBe(MAIN);
  });

  it('refuses anything but a RUNNING package', () => {
    for (const status of ['PENDING', 'PROVEN', 'DONE']) {
      const v = evaluateFinalizationFromMain(
        okFacts({ milestone: { errors: [], pkg: { id: PKG, status } } }),
      );
      expect(v.ok).toBe(false);
      expect(v.reasons.join(' ')).toContain(status);
    }
    const bad = evaluateFinalizationFromMain(
      okFacts({ milestone: { errors: ['milestone: missing field status'], pkg: null } }),
    );
    expect(bad.ok).toBe(false);
  });

  it('refuses while a PAUSED_FATAL latch exists', () => {
    const v = evaluateFinalizationFromMain(
      okFacts({ pausedFatal: { reason: 'exhausted recovery policy' } }),
    );
    expect(v.ok).toBe(false);
    expect(v.reasons.join(' ')).toMatch(/PAUSED_FATAL/i);
  });

  it('refuses a checkout that is not clean main at origin/main HEAD', () => {
    for (const checkout of [
      { branch: 'feature-x', trackedDirty: false, headSha: MAIN },
      { branch: 'main', trackedDirty: true, headSha: MAIN },
      { branch: 'main', trackedDirty: false, headSha: 'c'.repeat(40) },
    ]) {
      const v = evaluateFinalizationFromMain(okFacts({ checkout }));
      expect(v.ok).toBe(false);
    }
  });

  it('refuses when no merged PR carries the package identity reachable from main', () => {
    const v = evaluateFinalizationFromMain(okFacts({ mergedEvidence: null }));
    expect(v.ok).toBe(false);
    expect(v.reasons.join(' ')).toMatch(/MERGED PR/);
  });

  it('refuses unchecked T-scoped tasks — completeness is never fabricated', () => {
    const v = evaluateFinalizationFromMain(
      okFacts({
        artifacts: {
          spec: '# spec\n',
          plan: '# plan\n',
          tasks: '- [x] T118 done\n- [ ] T151 address CRITICAL review finding\n',
        },
      }),
    );
    expect(v.ok).toBe(false);
    expect(v.reasons.join(' ')).toMatch(/T-scoped task\(s\) unchecked/);
  });

  it('a T-scoped obligation REOPENED on current main refuses finalization even though the historical merge carried it checked (authority is CURRENT main, never the merge commit)', () => {
    // V4 §9 pin: the merged PR proves landing ANCESTRY only. The artifact
    // snapshot is read at CURRENT origin/main HEAD — so if someone reopens
    // (unchecks) a T task on main after the merge, the finalizer must refuse
    // exactly as if the work had never landed.
    const v = evaluateFinalizationFromMain(
      okFacts({
        // mergedEvidence stays fully intact from okFacts: PR #52 merged,
        // merge commit reachable from main, green CI on main HEAD.
        artifacts: {
          spec: '# spec\n',
          plan: '# plan\n',
          tasks: '- [ ] T118 Implement egress allowlists\n- [x] T119 Implement isolation\n',
        },
      }),
    );
    expect(v.ok).toBe(false);
    expect(v.reasons.join(' ')).toMatch(/T-scoped task\(s\) unchecked.*T118|T118.*unchecked/s);
    expect(v.reasons.join(' ')).not.toMatch(/no MERGED PR/);
  });

  it('never blocks on governance-deferred non-T items but keeps them visible as evidence', () => {
    // Exactly the live g0-security-perimeter shape on current main: all T
    // work checked; R3–R7 recorded per governance, wiring outside writeScopes.
    const scan = scanScopedTasks(
      [
        '- [x] T118 done',
        '- [ ] R3 Step-up PROOF CONSUMPTION seam (review M11b, priority P1)',
        '- [ ] R4 Durable webhook dedupe backing (review M6, priority P1)',
      ].join('\n'),
    );
    expect(scan.uncheckedT).toHaveLength(0);
    expect(scan.deferred).toHaveLength(2);
    const v = evaluateFinalizationFromMain(
      okFacts({
        artifacts: {
          spec: '# spec\n',
          plan: '# plan\n',
          tasks: '- [x] T118 done\n- [ ] R3 deferred seam\n- [ ] R7 audit\n',
        },
      }),
    );
    expect(v.ok).toBe(true);
    expect(v.evidence.deferredNonScopeItems).toBe(2);
  });

  it('refuses unresolved markers in scoped authority artifacts', () => {
    for (const f of ['spec', 'plan', 'tasks'] as const) {
      const artifacts = { spec: '# s\n', plan: '# p\n', tasks: '- [x] T1 x\n' } as Record<
        string,
        string
      >;
      artifacts[f] += '\nTODO: decide\n';
      const v = evaluateFinalizationFromMain(okFacts({ artifacts }));
      expect(v.ok).toBe(false);
      expect(v.reasons.join(' ')).toContain(`specs/${PKG}/${f}.md`);
    }
  });

  it('refuses missing scoped artifacts at the main commit', () => {
    const v = evaluateFinalizationFromMain(
      okFacts({ artifacts: { spec: null, plan: '# p\n', tasks: '- [x] T1 x\n' } }),
    );
    expect(v.ok).toBe(false);
    expect(v.reasons.join(' ')).toMatch(/spec\.md.*missing|missing.*spec/s);
  });

  it('refuses red, pending, or absent CI evidence on exactly origin/main HEAD', () => {
    const red = evaluateFinalizationFromMain(
      okFacts({
        ciRuns: [{ databaseId: 9, headSha: MAIN, conclusion: 'failure', url: 'ci/9' }],
      }),
    );
    expect(red.ok).toBe(false);
    expect(red.reasons.join(' ')).toMatch(/no green CI/);

    const pending = evaluateFinalizationFromMain(
      okFacts({ ciRuns: [{ databaseId: 9, headSha: MAIN, conclusion: null, url: 'ci/9' }] }),
    );
    expect(pending.ok).toBe(false);

    // Green CI on an OLDER sha is stale once main moved.
    const stale = evaluateFinalizationFromMain(
      okFacts({
        ciRuns: [{ databaseId: 8, headSha: 'd'.repeat(40), conclusion: 'success', url: 'ci/8' }],
      }),
    );
    expect(stale.ok).toBe(false);
    expect(stale.reasons.join(' ')).toMatch(/missing\/stale|no green CI/);
  });

  it('refuses while any live Archon execution or unpaused tracked run can still mutate the package', () => {
    const liveArchon = evaluateFinalizationFromMain(
      okFacts({
        archonRows: [{ id: '7bb356d4865e', userMessage: PKG, status: 'running' }],
      }),
    );
    expect(liveArchon.ok).toBe(false);
    expect(liveArchon.reasons.join(' ')).toMatch(/live Archon execution/);

    const genSuffixed = evaluateFinalizationFromMain(
      okFacts({
        archonRows: [{ id: 'aaaa', userMessage: `${PKG}@g2`, status: 'pending' }],
      }),
    );
    expect(genSuffixed.ok).toBe(false);

    // A terminal Archon run under an unpaused supervisor row is NOT live competition.
    const terminal = evaluateFinalizationFromMain(
      okFacts({
        archonRows: [{ id: '7bb356d4865e', userMessage: PKG, status: 'cancelled' }],
        trackedRows: [
          {
            runId: '7bb356d4865e',
            packageId: PKG,
            done: false,
            paused: false,
            archonStatus: 'cancelled',
          },
        ],
      }),
    );
    expect(terminal.ok).toBe(true);

    const liveTracked = evaluateFinalizationFromMain(
      okFacts({
        archonRows: [{ id: 'ffff', userMessage: PKG, status: 'running' }],
        trackedRows: [
          { runId: 'ffff', packageId: PKG, done: false, paused: false, archonStatus: 'running' },
        ],
      }),
    );
    expect(liveTracked.ok).toBe(false);
    expect(liveTracked.reasons.join(' ')).toMatch(/still tracks live run/);
  });

  describe('titleCarriesPackage token-boundary semantics', () => {
    it('accepts conventional landing titles', () => {
      expect(titleCarriesPackage(PKG, `feat(${PKG}): stand up security`)).toBe(true);
      expect(titleCarriesPackage(PKG, `chore: ${PKG} follow-ups`)).toBe(true);
      expect(titleCarriesPackage(PKG, PKG)).toBe(true);
    });
    it('rejects longer ids merely sharing this id as a dash-prefix', () => {
      expect(titleCarriesPackage(PKG, `feat(${PKG}-extra): different package`)).toBe(false);
    });
    it('rejects unrelated titles and empty input', () => {
      expect(titleCarriesPackage(PKG, 'feat(g0-tool-core): tools')).toBe(false);
      expect(titleCarriesPackage(PKG, undefined)).toBe(false);
      expect(titleCarriesPackage(PKG, '')).toBe(false);
    });
  });
});
