import { describe, expect, it } from 'bun:test';
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
    operatorCiBypassReason: null,
    ...overrides,
  };
}

interface AuditedCiEvidence {
  databaseId?: number;
  url?: string;
  bypassed?: boolean;
  reason?: string | null;
  mainSha?: string | null;
}

interface AuditedPauseEvidence {
  runId: string;
  archonStatus: string;
}

interface AuditedFinalizationEvidence {
  packageId?: string;
  mainSha?: string | null;
  pr?: { number: number; url: string; mergeCommit: string };
  ci?: AuditedCiEvidence;
  terminalPauseRetired?: AuditedPauseEvidence;
  taskBoxes?: number;
  deferredNonScopeItems?: number;
}

function auditEvidence(
  v: ReturnType<typeof evaluateFinalizationFromMain>,
): AuditedFinalizationEvidence {
  return v.evidence as unknown as AuditedFinalizationEvidence;
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

  describe('audited operator CI bypass finalization semantics', () => {
    it('no green exact-head CI and no explicit bypass still refuses fail-closed', () => {
      const absentCi = evaluateFinalizationFromMain(
        okFacts({
          ciRuns: [],
          operatorCiBypassReason: null,
        }),
      );
      expect(absentCi.ok).toBe(false);
      expect(absentCi.reasons.join(' ')).toMatch(/no CI run exists for origin\/main HEAD/);

      const redCi = evaluateFinalizationFromMain(
        okFacts({
          ciRuns: [{ databaseId: 9, headSha: MAIN, conclusion: 'failure', url: 'ci/9' }],
          operatorCiBypassReason: undefined,
        }),
      );
      expect(redCi.ok).toBe(false);
      expect(redCi.reasons.join(' ')).toMatch(/no green CI on origin\/main HEAD/);

      const emptyStringBypass = evaluateFinalizationFromMain(
        okFacts({
          ciRuns: [{ databaseId: 9, headSha: MAIN, conclusion: 'failure', url: 'ci/9' }],
          operatorCiBypassReason: '',
        }),
      );
      expect(emptyStringBypass.ok).toBe(false);
      expect(emptyStringBypass.reasons.join(' ')).toMatch(/no green CI on origin\/main HEAD/);

      const staleCiNoBypass = evaluateFinalizationFromMain(
        okFacts({
          ciRuns: [{ databaseId: 8, headSha: 'c'.repeat(40), conclusion: 'success', url: 'ci/8' }],
          operatorCiBypassReason: null,
        }),
      );
      expect(staleCiNoBypass.ok).toBe(false);
      expect(staleCiNoBypass.reasons.join(' ')).toMatch(/no CI run exists for origin\/main HEAD/);
    });

    it('a non-empty explicit operatorCiBypassReason permits the CI evidence slot only and records {bypassed: true, reason, mainSha}', () => {
      const bypassNoCi = evaluateFinalizationFromMain(
        okFacts({
          ciRuns: [],
          operatorCiBypassReason: 'manual operator audit: staging smoke test verified by @lead',
        }),
      );
      expect(bypassNoCi.ok).toBe(true);
      expect(bypassNoCi.reasons).toEqual([]);
      expect(auditEvidence(bypassNoCi).ci).toEqual({
        bypassed: true,
        reason: 'manual operator audit: staging smoke test verified by @lead',
        mainSha: MAIN,
      });
      expect(bypassNoCi.evidence.pr?.number).toBe(52);

      const bypassRedCi = evaluateFinalizationFromMain(
        okFacts({
          ciRuns: [{ databaseId: 9, headSha: MAIN, conclusion: 'failure', url: 'ci/9' }],
          operatorCiBypassReason: 'flaky linter infra outage, landed commits verified offline',
        }),
      );
      expect(bypassRedCi.ok).toBe(true);
      expect(bypassRedCi.reasons).toEqual([]);
      expect(auditEvidence(bypassRedCi).ci).toEqual({
        bypassed: true,
        reason: 'flaky linter infra outage, landed commits verified offline',
        mainSha: MAIN,
      });
    });

    it('operatorCiBypassReason permits the CI evidence slot ONLY — all other fail-closed gates still refuse', () => {
      const bypassReason = 'manual audit approved';

      // 1. Checkout dirty
      const dirty = evaluateFinalizationFromMain(
        okFacts({
          ciRuns: [],
          operatorCiBypassReason: bypassReason,
          checkout: { branch: 'main', trackedDirty: true, headSha: MAIN },
        }),
      );
      expect(dirty.ok).toBe(false);
      expect(dirty.reasons.join(' ')).toContain('product checkout has uncommitted tracked changes');
      expect(auditEvidence(dirty).ci).toEqual({
        bypassed: true,
        reason: bypassReason,
        mainSha: MAIN,
      });

      // 2. Checkout on non-main branch
      const nonMain = evaluateFinalizationFromMain(
        okFacts({
          ciRuns: [],
          operatorCiBypassReason: bypassReason,
          checkout: { branch: 'feature/unmerged', trackedDirty: false, headSha: MAIN },
        }),
      );
      expect(nonMain.ok).toBe(false);
      expect(nonMain.reasons.join(' ')).toContain(
        "product checkout is on 'feature/unmerged', not main",
      );

      // 3. Checkout HEAD detached / not matching mainSha
      const headMismatch = evaluateFinalizationFromMain(
        okFacts({
          ciRuns: [],
          operatorCiBypassReason: bypassReason,
          checkout: { branch: 'main', trackedDirty: false, headSha: 'e'.repeat(40) },
        }),
      );
      expect(headMismatch.ok).toBe(false);
      expect(headMismatch.reasons.join(' ')).toMatch(/checkout HEAD .* ≠ origin\/main/);

      // 4. Missing merged PR evidence
      const noMergedPr = evaluateFinalizationFromMain(
        okFacts({
          ciRuns: [],
          operatorCiBypassReason: bypassReason,
          mergedEvidence: null,
        }),
      );
      expect(noMergedPr.ok).toBe(false);
      expect(noMergedPr.reasons.join(' ')).toMatch(/no MERGED PR/);

      // 5. Unchecked T-scoped tasks
      const uncheckedTask = evaluateFinalizationFromMain(
        okFacts({
          ciRuns: [],
          operatorCiBypassReason: bypassReason,
          artifacts: {
            spec: '# spec\n',
            plan: '# plan\n',
            tasks: '- [x] T118 done\n- [ ] T119 unfinished task\n',
          },
        }),
      );
      expect(uncheckedTask.ok).toBe(false);
      expect(uncheckedTask.reasons.join(' ')).toMatch(/T-scoped task\(s\) unchecked/);

      // 6. Unresolved markers in artifacts
      const unresolvedMarker = evaluateFinalizationFromMain(
        okFacts({
          ciRuns: [],
          operatorCiBypassReason: bypassReason,
          artifacts: {
            spec: '# spec\nTODO: write implementation details\n',
            plan: '# plan\n',
            tasks: '- [x] T118 done\n',
          },
        }),
      );
      expect(unresolvedMarker.ok).toBe(false);
      expect(unresolvedMarker.reasons.join(' ')).toContain(`specs/${PKG}/spec.md`);

      // 7. Live Archon execution
      const liveArchon = evaluateFinalizationFromMain(
        okFacts({
          ciRuns: [],
          operatorCiBypassReason: bypassReason,
          archonRows: [{ id: 'live-archon-1', userMessage: PKG, status: 'running' }],
        }),
      );
      expect(liveArchon.ok).toBe(false);
      expect(liveArchon.reasons.join(' ')).toMatch(/live Archon execution/);

      // 8. Live tracked supervisor row
      const liveTracked = evaluateFinalizationFromMain(
        okFacts({
          ciRuns: [],
          operatorCiBypassReason: bypassReason,
          trackedRows: [
            {
              runId: 'live-run-1',
              packageId: PKG,
              done: false,
              paused: false,
              archonStatus: 'running',
            },
          ],
        }),
      );
      expect(liveTracked.ok).toBe(false);
      expect(liveTracked.reasons.join(' ')).toMatch(/supervisor still tracks live run/);
    });

    it('records genuine CI evidence rather than bypass when green exact-head CI run is found', () => {
      const v = evaluateFinalizationFromMain(
        okFacts({
          ciRuns: [{ databaseId: 42, headSha: MAIN, conclusion: 'success', url: 'ci/42' }],
          operatorCiBypassReason: 'unnecessary bypass',
        }),
      );
      expect(v.ok).toBe(true);
      expect(v.evidence.ci).toEqual({ databaseId: 42, url: 'ci/42' });
    });
  });

  describe('PAUSED_FATAL retirement and ownership semantics', () => {
    it('permits a PAUSED_FATAL owned by this exact package/run when the matching tracked row is paused and Archon-terminal, and returns retirement evidence', () => {
      for (const archonStatus of ['failed', 'cancelled', 'completed'] as const) {
        const runId = `archon-run-${archonStatus}`;
        const v = evaluateFinalizationFromMain(
          okFacts({
            pausedFatal: {
              packageId: PKG,
              runId,
              reason: `recovered ${archonStatus} run`,
            },
            trackedRows: [
              {
                runId,
                packageId: PKG,
                done: false,
                paused: true,
                archonStatus,
              },
            ],
          }),
        );
        expect(v.ok).toBe(true);
        expect(v.reasons).toEqual([]);
        expect(auditEvidence(v).terminalPauseRetired).toEqual({
          runId,
          archonStatus,
        });
      }
    });

    it('refuses a pause owned by another package even if tracked row exists and is terminal', () => {
      const v = evaluateFinalizationFromMain(
        okFacts({
          pausedFatal: {
            packageId: 'g0-contracts-data-truth',
            runId: 'run-other-pkg',
            reason: 'crash on other package',
          },
          trackedRows: [
            {
              runId: 'run-other-pkg',
              packageId: 'g0-contracts-data-truth',
              done: false,
              paused: true,
              archonStatus: 'failed',
            },
          ],
        }),
      );
      expect(v.ok).toBe(false);
      expect(v.reasons.join(' ')).toMatch(/supervisor is latched in PAUSED_FATAL/);
      expect(auditEvidence(v).terminalPauseRetired).toBeUndefined();
    });

    it('refuses a pause when the matching tracked run is live (running or pending) or unknown', () => {
      // Live running
      const vRunning = evaluateFinalizationFromMain(
        okFacts({
          pausedFatal: {
            packageId: PKG,
            runId: 'run-live-1',
            reason: 'paused midway',
          },
          trackedRows: [
            {
              runId: 'run-live-1',
              packageId: PKG,
              done: false,
              paused: true,
              archonStatus: 'running',
            },
          ],
        }),
      );
      expect(vRunning.ok).toBe(false);
      expect(vRunning.reasons.join(' ')).toMatch(/supervisor is latched in PAUSED_FATAL/);
      expect(auditEvidence(vRunning).terminalPauseRetired).toBeUndefined();

      // Live pending
      const vPending = evaluateFinalizationFromMain(
        okFacts({
          pausedFatal: {
            packageId: PKG,
            runId: 'run-live-2',
            reason: 'paused in queue',
          },
          trackedRows: [
            {
              runId: 'run-live-2',
              packageId: PKG,
              done: false,
              paused: true,
              archonStatus: 'pending',
            },
          ],
        }),
      );
      expect(vPending.ok).toBe(false);
      expect(vPending.reasons.join(' ')).toMatch(/supervisor is latched in PAUSED_FATAL/);
      expect(auditEvidence(vPending).terminalPauseRetired).toBeUndefined();

      // Unknown status
      const vUnknown = evaluateFinalizationFromMain(
        okFacts({
          pausedFatal: {
            packageId: PKG,
            runId: 'run-unk',
            reason: 'unknown status',
          },
          trackedRows: [
            {
              runId: 'run-unk',
              packageId: PKG,
              done: false,
              paused: true,
              archonStatus: 'unknown',
            },
          ],
        }),
      );
      expect(vUnknown.ok).toBe(false);
      expect(vUnknown.reasons.join(' ')).toMatch(/supervisor is latched in PAUSED_FATAL/);
      expect(auditEvidence(vUnknown).terminalPauseRetired).toBeUndefined();
    });

    it('refuses a pause when the matching tracked row is NOT paused (paused: false)', () => {
      const v = evaluateFinalizationFromMain(
        okFacts({
          pausedFatal: {
            packageId: PKG,
            runId: 'run-unpaused',
            reason: 'unpaused mismatch',
          },
          trackedRows: [
            {
              runId: 'run-unpaused',
              packageId: PKG,
              done: false,
              paused: false,
              archonStatus: 'failed',
            },
          ],
        }),
      );
      expect(v.ok).toBe(false);
      expect(v.reasons.join(' ')).toMatch(/supervisor is latched in PAUSED_FATAL/);
      expect(auditEvidence(v).terminalPauseRetired).toBeUndefined();
    });

    it('refuses a pause when runId is not found in trackedRows (unknown run)', () => {
      const v = evaluateFinalizationFromMain(
        okFacts({
          pausedFatal: {
            packageId: PKG,
            runId: 'run-missing-from-tracked',
            reason: 'orphan pause latch',
          },
          trackedRows: [
            {
              runId: 'some-other-run',
              packageId: PKG,
              done: false,
              paused: true,
              archonStatus: 'failed',
            },
          ],
        }),
      );
      expect(v.ok).toBe(false);
      expect(v.reasons.join(' ')).toMatch(/supervisor is latched in PAUSED_FATAL/);
      expect(auditEvidence(v).terminalPauseRetired).toBeUndefined();
    });

    it('refuses a pause when tracked row packageId mismatches package under evaluation', () => {
      const v = evaluateFinalizationFromMain(
        okFacts({
          pausedFatal: {
            packageId: PKG,
            runId: 'run-pkg-mismatch',
            reason: 'mismatch',
          },
          trackedRows: [
            {
              runId: 'run-pkg-mismatch',
              packageId: 'g0-different-pkg',
              done: false,
              paused: true,
              archonStatus: 'failed',
            },
          ],
        }),
      );
      expect(v.ok).toBe(false);
      expect(v.reasons.join(' ')).toMatch(/supervisor is latched in PAUSED_FATAL/);
      expect(auditEvidence(v).terminalPauseRetired).toBeUndefined();
    });
  });

  describe('composite CI-bypass and terminal-pause finalization', () => {
    it('finalizes successfully when both audited CI bypass and terminal PAUSED_FATAL retirement co-occur on valid landed main', () => {
      const runId = 'archon-dead-run-55';
      const bypassReason = 'manual audit: CI pipeline timeout on main after successful PR merge';
      const v = evaluateFinalizationFromMain(
        okFacts({
          ciRuns: [{ databaseId: 99, headSha: MAIN, conclusion: 'failure', url: 'ci/99' }],
          operatorCiBypassReason: bypassReason,
          pausedFatal: {
            packageId: PKG,
            runId,
            reason: 'fatal failure recovered by landed PR #52',
          },
          trackedRows: [
            {
              runId,
              packageId: PKG,
              done: false,
              paused: true,
              archonStatus: 'failed',
            },
          ],
        }),
      );
      expect(v.ok).toBe(true);
      expect(v.reasons).toEqual([]);
      expect(auditEvidence(v).ci).toEqual({
        bypassed: true,
        reason: bypassReason,
        mainSha: MAIN,
      });
      expect(auditEvidence(v).terminalPauseRetired).toEqual({
        runId,
        archonStatus: 'failed',
      });
      expect(v.evidence.pr?.number).toBe(52);
      expect(v.evidence.mainSha).toBe(MAIN);
    });
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
