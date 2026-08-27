// tests/automation/ci-diff-classifier.spec.ts — Behavioral tests for semantic CI diff classification.
// Matrix from Task Spec §22.

import { describe, expect, it } from 'bun:test';
import { gitFixture } from '../helpers/git-fixture.js';
import { classifyCiDiff } from '../../scripts/automation/classify-ci-diff.mjs';

describe('State-Only CI Semantic Classifier Matrix (§22)', () => {
  const baseMilestone = {
    milestoneId: 'g0',
    packages: [
      {
        id: 'g0-test-pkg',
        objective: 'Test objective for package',
        requirementIds: ['FR-001', 'FR-002'],
        dependencies: [],
        risk: 'LOW',
        parallelizable: true,
        writeScopes: ['packages/test/**'],
        verificationCommands: ['pnpm test'],
        status: 'PENDING',
        generation: 0,
      },
    ],
  };

  it('1. ONLY status transition in current-milestone.json → STATE_ONLY', () => {
    const gitFix = gitFixture('cls-status-only');
    gitFix.writeFile(
      'specs/implementation/current-milestone.json',
      JSON.stringify(baseMilestone, null, 2) + '\n',
    );
    gitFix.commitAll('chore: base milestone');
    gitFix.g(['push', 'origin', 'main']);
    const baseSha = gitFix.baseSha();

    const afterMilestone = JSON.parse(JSON.stringify(baseMilestone));
    afterMilestone.packages[0].status = 'RUNNING';

    gitFix.writeFile(
      'specs/implementation/current-milestone.json',
      JSON.stringify(afterMilestone, null, 2) + '\n',
    );
    gitFix.commitAll('chore: PENDING -> RUNNING');
    const headSha = gitFix.baseSha();

    const result = classifyCiDiff({
      repoDir: gitFix.root,
      baseSha,
      headSha,
    });

    expect(result.mode).toBe('STATE_ONLY');
    expect(result.changedFiles).toEqual(['specs/implementation/current-milestone.json']);
  });

  it('2. ONLY allowed generation transition in current-milestone.json → STATE_ONLY', () => {
    const gitFix = gitFixture('cls-gen-only');
    gitFix.writeFile(
      'specs/implementation/current-milestone.json',
      JSON.stringify(baseMilestone, null, 2) + '\n',
    );
    gitFix.commitAll('chore: base milestone');
    gitFix.g(['push', 'origin', 'main']);
    const baseSha = gitFix.baseSha();

    const afterMilestone = JSON.parse(JSON.stringify(baseMilestone));
    afterMilestone.packages[0].generation = 1;

    gitFix.writeFile(
      'specs/implementation/current-milestone.json',
      JSON.stringify(afterMilestone, null, 2) + '\n',
    );
    gitFix.commitAll('chore: generation 0 -> 1');
    const headSha = gitFix.baseSha();

    const result = classifyCiDiff({
      repoDir: gitFix.root,
      baseSha,
      headSha,
    });

    expect(result.mode).toBe('STATE_ONLY');
  });

  it('3. Change package objective → FULL', () => {
    const gitFix = gitFixture('cls-change-objective');
    gitFix.writeFile(
      'specs/implementation/current-milestone.json',
      JSON.stringify(baseMilestone, null, 2) + '\n',
    );
    gitFix.commitAll('chore: base milestone');
    const baseSha = gitFix.baseSha();

    const afterMilestone = JSON.parse(JSON.stringify(baseMilestone));
    afterMilestone.packages[0].objective = 'Altered objective';

    gitFix.writeFile(
      'specs/implementation/current-milestone.json',
      JSON.stringify(afterMilestone, null, 2) + '\n',
    );
    gitFix.commitAll('chore: edit objective');
    const headSha = gitFix.baseSha();

    const result = classifyCiDiff({
      repoDir: gitFix.root,
      baseSha,
      headSha,
    });

    expect(result.mode).toBe('FULL');
    expect(result.reason).toContain('objective');
  });

  it('4. Change dependency → FULL', () => {
    const gitFix = gitFixture('cls-change-dep');
    gitFix.writeFile(
      'specs/implementation/current-milestone.json',
      JSON.stringify(baseMilestone, null, 2) + '\n',
    );
    gitFix.commitAll('chore: base milestone');
    const baseSha = gitFix.baseSha();

    const afterMilestone = JSON.parse(JSON.stringify(baseMilestone));
    afterMilestone.packages[0].dependencies = ['g0-other'];

    gitFix.writeFile(
      'specs/implementation/current-milestone.json',
      JSON.stringify(afterMilestone, null, 2) + '\n',
    );
    gitFix.commitAll('chore: edit dependencies');
    const headSha = gitFix.baseSha();

    const result = classifyCiDiff({
      repoDir: gitFix.root,
      baseSha,
      headSha,
    });

    expect(result.mode).toBe('FULL');
  });

  it('5. Change writeScopes → FULL', () => {
    const gitFix = gitFixture('cls-change-scopes');
    gitFix.writeFile(
      'specs/implementation/current-milestone.json',
      JSON.stringify(baseMilestone, null, 2) + '\n',
    );
    gitFix.commitAll('chore: base milestone');
    const baseSha = gitFix.baseSha();

    const afterMilestone = JSON.parse(JSON.stringify(baseMilestone));
    afterMilestone.packages[0].writeScopes = ['packages/**'];

    gitFix.writeFile(
      'specs/implementation/current-milestone.json',
      JSON.stringify(afterMilestone, null, 2) + '\n',
    );
    gitFix.commitAll('chore: edit writeScopes');
    const headSha = gitFix.baseSha();

    const result = classifyCiDiff({
      repoDir: gitFix.root,
      baseSha,
      headSha,
    });

    expect(result.mode).toBe('FULL');
  });

  it('6. Change requirementIds → FULL', () => {
    const gitFix = gitFixture('cls-change-reqs');
    gitFix.writeFile(
      'specs/implementation/current-milestone.json',
      JSON.stringify(baseMilestone, null, 2) + '\n',
    );
    gitFix.commitAll('chore: base milestone');
    const baseSha = gitFix.baseSha();

    const afterMilestone = JSON.parse(JSON.stringify(baseMilestone));
    afterMilestone.packages[0].requirementIds = ['FR-001'];

    gitFix.writeFile(
      'specs/implementation/current-milestone.json',
      JSON.stringify(afterMilestone, null, 2) + '\n',
    );
    gitFix.commitAll('chore: edit requirementIds');
    const headSha = gitFix.baseSha();

    const result = classifyCiDiff({
      repoDir: gitFix.root,
      baseSha,
      headSha,
    });

    expect(result.mode).toBe('FULL');
  });

  it('7. Change roadmap.json → FULL', () => {
    const gitFix = gitFixture('cls-change-roadmap');
    gitFix.writeFile('specs/implementation/roadmap.json', '{"milestones":[]}\n');
    gitFix.commitAll('chore: base roadmap');
    const baseSha = gitFix.baseSha();

    gitFix.writeFile('specs/implementation/roadmap.json', '{"milestones":[{"id":"g0"}]}\n');
    gitFix.commitAll('chore: edit roadmap');
    const headSha = gitFix.baseSha();

    const result = classifyCiDiff({
      repoDir: gitFix.root,
      baseSha,
      headSha,
    });

    expect(result.mode).toBe('FULL');
  });

  it('8. Change plan.md, spec.md, or tasks.md → FULL', () => {
    const gitFix = gitFixture('cls-change-md');
    gitFix.writeFile('specs/g0-test/plan.md', '# Plan\n');
    gitFix.writeFile('specs/g0-test/spec.md', '# Spec\n');
    gitFix.writeFile('specs/g0-test/tasks.md', '# Tasks\n');
    gitFix.commitAll('chore: base specs');
    const baseSha = gitFix.baseSha();

    gitFix.writeFile('specs/g0-test/plan.md', '# Plan v2\n');
    gitFix.commitAll('chore: edit plan');
    const headSha = gitFix.baseSha();

    const result = classifyCiDiff({
      repoDir: gitFix.root,
      baseSha,
      headSha,
    });

    expect(result.mode).toBe('FULL');
  });

  it('9. Unknown file / Product file → FULL', () => {
    const gitFix = gitFixture('cls-product-file');
    gitFix.writeFile('packages/core/index.ts', 'export const a = 1;\n');
    gitFix.commitAll('chore: base code');
    const baseSha = gitFix.baseSha();

    gitFix.writeFile('packages/core/index.ts', 'export const a = 2;\n');
    gitFix.commitAll('chore: edit code');
    const headSha = gitFix.baseSha();

    const result = classifyCiDiff({
      repoDir: gitFix.root,
      baseSha,
      headSha,
    });

    expect(result.mode).toBe('FULL');
  });

  it('10. Classifier error or empty diff → FULL (fail-closed)', () => {
    const result = classifyCiDiff({
      repoDir: '/invalid/path',
      baseSha: '000000',
      headSha: '000000',
    });

    expect(result.mode).toBe('FULL');
  });
});
