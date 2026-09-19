// C4 §15 regression coverage: deterministic review packet.
// Tests 39–41 of the V2 task spec:
//   39. the packet binds the exact reviewed HEAD;
//   40. a changed HEAD invalidates it;
//   41. deterministic duplicate-finding aggregation never hides disagreement.
// Plus degradation direction: missing optional evidence degrades the packet
// (valid=false + reasons) instead of fabricating context, and two builds at
// the same tree are byte-identical (no timestamp by construction).
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import {
  REVIEW_PACKET_SCHEMA,
  aggregateFindings,
  buildReviewPacket,
  validateReviewPacket,
} from '../../scripts/automation/review-packet.mjs';
import { disposeGitFixtureBase, gitFixture } from '../helpers/git-fixture.js';

const scratch = mkdtempSync(join(tmpdir(), 'foresift-c4-packet-'));
afterAll(() => {
  rmSync(scratch, { recursive: true, force: true });
  disposeGitFixtureBase();
});

const art = (name: string) => {
  const d = join(scratch, name);
  mkdirSync(d, { recursive: true });
  return d;
};

/** Real git repo carrying minimal milestone + requirements authority so the
 *  packet's capsule derivation has something deterministic to read. */
function fixtureRepo(name: string) {
  const repo = gitFixture(name);
  const msDir = join(repo.root, 'specs', 'implementation');
  mkdirSync(msDir, { recursive: true });
  writeFileSync(
    join(msDir, 'current-milestone.json'),
    JSON.stringify({
      schemaVersion: '1.0.0',
      milestoneId: 'GX',
      packages: [
        {
          id: 'pkg-a',
          objective: 'Fixture package for packet tests.',
          risk: 'HIGH',
          parallelizable: false,
          status: 'PENDING',
          dependencies: [],
          writeScopes: ['packages/a/**'],
          requirementIds: ['FR-PKT-1'],
        },
      ],
    }),
  );
  const specDir = join(repo.root, 'docs', 'spec');
  mkdirSync(specDir, { recursive: true });
  writeFileSync(
    join(specDir, 'm.requirements.json'),
    JSON.stringify({
      requirements: [
        {
          id: 'FR-PKT-1',
          section: '38. Functional requirements catalogue',
          subsection: '38.1',
          line: 7,
          acceptanceCriteria: ['AC-PKT-1'],
        },
      ],
      acceptanceCriteria: [{ id: 'AC-PKT-1' }],
      adrs: [{ id: 'ADR-009', title: 'Packet fixture', section: 'Appendix Z' }],
    }),
  );
  // Mirror the canonical manifest name deriveCapsule looks for.
  writeFileSync(
    join(specDir, 'crypto_intelligence_agent_gateway_PRD_FINAL_v6.0.requirements.json'),
    readFileSync(join(specDir, 'm.requirements.json')),
  );
  writeFileSync(join(repo.root, 'specs', 'pkg-a.tasks.md'), '- [x] T001\n');
  repo.commitAll('authority');
  return repo;
}

describe('review packet — HEAD binding and determinism (tests 39–40)', () => {
  it('binds the exact reviewed HEAD; validation passes at that HEAD', () => {
    const repo = fixtureRepo('bind');
    const p = buildReviewPacket({
      packageId: 'pkg-a',
      repoRoot: repo.root,
      artifactsDir: art('bind'),
    });
    expect(p.schema).toBe(REVIEW_PACKET_SCHEMA);
    expect(p.valid).toBe(true);
    expect(p.reviewedHeadSha).toBe(repo.baseSha());
    expect(validateReviewPacket(p, { expectedHead: repo.baseSha() }).valid).toBe(true);
    // Identity fields are populated from milestone/manifest/git reality.
    expect(p.risk).toBe('HIGH');
    expect(p.requirementIds ?? []).toEqual(['FR-PKT-1']);
    expect(p.permanentBoundaries).toMatch(/READ_ONLY_NO_TRADING_CUSTODY_SIGNING/);
    expect(p.diffIdentity).toMatch(/^[0-9a-f]{64}$/);
    expect(p.baseSource).toBe('merge-base');
  });

  it('changed HEAD after build invalidates the packet (fail-closed)', () => {
    const repo = fixtureRepo('drift');
    const p = buildReviewPacket({
      packageId: 'pkg-a',
      repoRoot: repo.root,
      artifactsDir: art('drift'),
    });
    repo.writeFile('packages/a/code.ts', 'export {};\n');
    repo.commitAll('review fix moved HEAD');
    const v = validateReviewPacket(p, { expectedHead: repo.baseSha() });
    expect(v.valid).toBe(false);
    expect(v.reasons.join(' ')).toMatch(/HEAD changed after packet build/);
  });

  it('two builds at the same tree are byte-identical (no timestamp, deterministic)', () => {
    const repo = fixtureRepo('det');
    const a = buildReviewPacket({
      packageId: 'pkg-a',
      repoRoot: repo.root,
      artifactsDir: art('det-a'),
    });
    const b = buildReviewPacket({
      packageId: 'pkg-a',
      repoRoot: repo.root,
      artifactsDir: art('det-b'),
    });
    expect(JSON.stringify(b)).toBe(JSON.stringify(a));
  });

  it('malformed/wrong-schema packets fail closed in validateReviewPacket', () => {
    expect(validateReviewPacket(null).valid).toBe(false);
    expect(validateReviewPacket({ schema: 'foresift/review-packet@0' }).valid).toBe(false);
    const empty = mkdtempSync(join(tmpdir(), 'foresift-c4-empty-'));
    try {
      const p = buildReviewPacket({ packageId: 'ghost', repoRoot: empty, artifactsDir: empty });
      const broken = { ...p, reviewedHeadSha: 'deadbeef' };
      expect(validateReviewPacket(broken).valid).toBe(false);
      expect(validateReviewPacket(broken).reasons.join(' ')).toMatch(/reviewedHeadSha/);
    } finally {
      rmSync(empty, { recursive: true, force: true });
    }
  });
});

describe('review packet — degradation is recorded, never fabricated', () => {
  it('unknown package and absent authority produce valid=false with reasons, still buildable', () => {
    const empty = mkdtempSync(join(tmpdir(), 'foresift-c4-empty2-'));
    try {
      const p = buildReviewPacket({ packageId: 'ghost', repoRoot: empty, artifactsDir: empty });
      expect(p.valid).toBe(false);
      expect(p.reasons.length).toBeGreaterThan(0);
      expect(p.reviewedHeadSha).toBeNull();
      expect(p.fullGateEvidence).toEqual({ present: false });
    } finally {
      rmSync(empty, { recursive: true, force: true });
    }
  });

  it('reads out-of-scope notes verbatim when present', () => {
    const repo = fixtureRepo('notes');
    const dir = art('notes');
    writeFileSync(join(dir, 'out-of-scope-notes.md'), '- out of scope: nothing\n');
    const p = buildReviewPacket({ packageId: 'pkg-a', repoRoot: repo.root, artifactsDir: dir });
    expect(p.outOfScopeNotes).toBe('- out of scope: nothing\n');
  });

  it('prior unresolved PR threads and unfinished tasks surface as known open issues', () => {
    const repo = fixtureRepo('open');
    const dir = art('open');
    writeFileSync(join(dir, 'review-verdict.json'), JSON.stringify({ unresolvedThreads: 2 }));
    const p = buildReviewPacket({ packageId: 'pkg-a', repoRoot: repo.root, artifactsDir: dir });
    expect(p.knownUnresolvedIssues.join(' ')).toMatch(/2 unresolved PR review threads/);
  });
});

describe('finding aggregation — exact duplicates merge, disagreement survives (test 41)', () => {
  const base = {
    severity: 'HIGH',
    category: 'correctness',
    file: 'src/a.ts',
    line: 10,
    requirementId: 'FR-1',
    finding: 'off-by-one in replay window',
    requiredFix: true,
  };

  it('exact duplicates collapse into one entry with occurrences count', () => {
    const r = aggregateFindings([base, { ...base }, { ...base }]);
    expect(r.aggregated).toHaveLength(1);
    expect(r.aggregated[0]?.occurrences).toBe(3);
    expect(r.exactDuplicatesMerged).toBe(2);
  });

  it('any differing field keeps findings separate — no semantic merging', () => {
    const r = aggregateFindings([
      base,
      { ...base, line: 11 },
      { ...base, severity: 'MEDIUM' },
      { ...base, requiredFix: false },
      { ...base, finding: 'off-by-one in replay window (disagreeing detail)' },
    ]);
    expect(r.aggregated).toHaveLength(5);
    expect(r.exactDuplicatesMerged).toBe(0);
    expect(r.aggregated.map((f) => f.occurrences)).toEqual([1, 1, 1, 1, 1]);
  });

  it('empty and undefined inputs aggregate to nothing without throwing', () => {
    expect(aggregateFindings([])).toEqual({ aggregated: [], exactDuplicatesMerged: 0 });
    expect(aggregateFindings(undefined as never)).toEqual({
      aggregated: [],
      exactDuplicatesMerged: 0,
    });
  });
});

describe('packet artifact round-trip', () => {
  it('buildReviewPacket output persists and revalidates from disk bytes', () => {
    const repo = fixtureRepo('persist');
    const dir = art('persist');
    const p = buildReviewPacket({ packageId: 'pkg-a', repoRoot: repo.root, artifactsDir: dir });
    writeFileSync(join(dir, 'review-packet.json'), JSON.stringify(p, null, 2));
    const back = JSON.parse(readFileSync(join(dir, 'review-packet.json'), 'utf8'));
    expect(validateReviewPacket(back, { expectedHead: repo.baseSha() }).valid).toBe(true);
  });
});
