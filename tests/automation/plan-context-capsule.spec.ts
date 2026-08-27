import { describe, expect, it, beforeAll, afterAll } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, '..', '..');
const BUILD = join(repoRoot, 'scripts', 'automation', 'build-plan-context.mjs');
const BOOTSTRAP = join(repoRoot, 'scripts', 'automation', 'bootstrap-package-spec.mjs');

let fx: string;

function rev(repo: string, ref = 'HEAD'): string {
  const r = spawnSync('git', ['rev-parse', ref], { cwd: repo, encoding: 'utf8' });
  expect(r.status).toBe(0);
  return (r.stdout ?? '').trim();
}

function commitAll(repo: string) {
  spawnSync('git', ['add', '-A'], { cwd: repo });
  const r = spawnSync(
    'git',
    ['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-qm', 'fixture'],
    { cwd: repo },
  );
  expect(r.status).toBe(0);
}

function runScript(script: string, args: string[]) {
  return spawnSync(process.execPath, [script, ...args], { encoding: 'utf8' });
}

// ── hermetic authority fixture ─────────────────────────────────────────────────
// A tiny stand-in repo carrying the exact shapes plan-context-lib reads:
// requirement manifest (+ AC catalog), committed milestone state, PRD bytes,
// docs/adr/, and a real git history so HEAD binding is meaningful.
function buildFixture(): string {
  const root = mkdtempSync(join(tmpdir(), 'plan-context-fx-'));
  mkdirSync(join(root, 'docs', 'spec'), { recursive: true });
  mkdirSync(join(root, 'docs', 'adr'), { recursive: true });
  mkdirSync(join(root, 'specs', 'implementation'), { recursive: true });

  writeFileSync(join(root, 'docs', 'spec', 'PRD.md'), '# PRD\n\nAuthoritative.\n');
  writeFileSync(join(root, 'docs', 'adr', '0001-example.md'), '# ADR 1\n');

  const manifest = {
    schemaVersion: '1.0.0',
    acceptanceCriteria: [
      {
        id: 'AC-100',
        requirementRefs: ['FR-A-001', 'FR-A-002'],
        positiveTestRef: 'tests/acceptance/AC-100.spec.ts',
        negativeOrFailureTestRef: 'tests/negative/AC-100.negative.spec.ts',
      },
      {
        id: 'AC-101',
        requirementRefs: ['FR-A-001'],
        positiveTestRef: 'tests/acceptance/AC-101.spec.ts',
        negativeOrFailureTestRef: null,
      },
      {
        id: 'AC-102',
        requirementRefs: ['FR-A-002'],
        positiveTestRef: 'tests/acceptance/AC-102.spec.ts',
        negativeOrFailureTestRef: 'tests/negative/AC-102.negative.spec.ts',
      },
    ],
    requirements: [
      {
        id: 'FR-A-001',
        text: 'The gateway SHALL validate every tool call.',
        normativeLevel: 'MUST',
        section: '38. Functional requirements',
        line: 100,
        securityRightsCostControls: 'INV-001',
        acceptanceCriteria: ['AC-100', 'AC-101'],
        schemaRefs: ['packages/shared-schemas/src/a.ts'],
        fixtureRefs: [],
        telemetryRefs: [],
        testRefs: [],
      },
      {
        id: 'FR-A-002',
        text: 'The gateway SHALL audit every executed tool call.',
        normativeLevel: 'MUST',
        section: '38. Functional requirements',
        line: 101,
        securityRightsCostControls: null,
        acceptanceCriteria: ['AC-100', 'AC-102'],
        schemaRefs: [],
        fixtureRefs: [],
        telemetryRefs: [],
        testRefs: [],
      },
    ],
  };
  writeFileSync(
    join(
      root,
      'docs',
      'spec',
      'crypto_intelligence_agent_gateway_PRD_FINAL_v6.0.requirements.json',
    ),
    JSON.stringify(manifest, null, 2),
  );
  writeFileSync(
    join(root, 'docs', 'spec', 'crypto_intelligence_agent_gateway_PRD_FINAL_v6.0.md'),
    '# PRD\n\nAuthoritative.\n',
  );

  const ms = {
    schemaVersion: '1.0.0',
    milestoneId: 'GX',
    status: 'ACTIVE',
    packages: [
      {
        id: 'pkg-a',
        objective: 'Implement subsystem A end to end with full evidence coverage.',
        requirementIds: ['FR-A-001', 'FR-A-002'],
        dependencies: [],
        risk: 'HIGH',
        parallelizable: false,
        writeScopes: ['src/a/**'],
        verificationCommands: ['pnpm test -- src/a'],
        status: 'PENDING',
      },
      {
        id: 'pkg-b',
        objective: 'Implement independent subsystem B behind its own boundary.',
        requirementIds: ['FR-B-001'],
        dependencies: ['pkg-a'],
        risk: 'LOW',
        parallelizable: true,
        writeScopes: ['src/b/**'],
        verificationCommands: ['pnpm test -- src/b'],
        status: 'PROVEN',
      },
    ],
  };
  writeFileSync(
    join(root, 'specs', 'implementation', 'current-milestone.json'),
    JSON.stringify(ms),
  );

  spawnSync('git', ['init', '-q'], { cwd: root });
  spawnSync('git', ['config', 'user.email', 't@t'], { cwd: root });
  spawnSync('git', ['config', 'user.name', 't'], { cwd: root });
  commitAll(root);
  return root;
}

beforeAll(() => {
  fx = buildFixture();
});
afterAll(() => {
  rmSync(fx, { recursive: true, force: true });
});

describe('build-plan-context (authority-bound capsule)', () => {
  it('is byte-stable across repeated runs on identical inputs', () => {
    const out1 = mkdtempSync(join(tmpdir(), 'capsule-a-'));
    const out2 = mkdtempSync(join(tmpdir(), 'capsule-b-'));
    try {
      expect(runScript(BUILD, ['--package', 'pkg-a', '--out', out1, '--root', fx]).status).toBe(0);
      expect(runScript(BUILD, ['--package', 'pkg-a', '--out', out2, '--root', fx]).status).toBe(0);
      expect(readFileSync(join(out1, 'plan-capsule.json'), 'utf8')).toBe(
        readFileSync(join(out2, 'plan-capsule.json'), 'utf8'),
      );
      expect(readFileSync(join(out1, 'plan-capsule.md'), 'utf8')).toBe(
        readFileSync(join(out2, 'plan-capsule.md'), 'utf8'),
      );
    } finally {
      rmSync(out1, { recursive: true, force: true });
      rmSync(out2, { recursive: true, force: true });
    }
  });

  it('binds to the exact HEAD sha and quotes normative text verbatim', () => {
    const out = mkdtempSync(join(tmpdir(), 'capsule-c-'));
    try {
      const r = runScript(BUILD, ['--package', 'pkg-a', '--out', out, '--root', fx]);
      expect(r.status).toBe(0);
      const json = JSON.parse(readFileSync(join(out, 'plan-capsule.json'), 'utf8'));
      expect(json.schema).toBe('foresift/plan-context@1');
      expect(json.bound.mainHeadSha).toBe(rev(fx));
      expect(json.bound.prdSha256).toMatch(/^[0-9a-f]{64}$/);
      expect(json.bound.manifestSha256).toMatch(/^[0-9a-f]{64}$/);
      expect(json.requirements.map((q: { id: string }) => q.id)).toEqual(['FR-A-001', 'FR-A-002']);
      expect(json.requirements[0].text).toContain('SHALL validate every tool call');
      const mdText = readFileSync(join(out, 'plan-capsule.md'), 'utf8');
      expect(mdText).toContain('> The gateway SHALL audit every executed tool call.');
      // dependency status projected from committed milestone
      expect(mdText).toContain('- none'); // pkg-a has no deps
    } finally {
      rmSync(out, { recursive: true, force: true });
    }
  });

  it('documents package-shared acceptance criteria once, not per requirement', () => {
    const out = mkdtempSync(join(tmpdir(), 'capsule-d-'));
    try {
      runScript(BUILD, ['--package', 'pkg-a', '--out', out, '--root', fx]);
      const mdText = readFileSync(join(out, 'plan-capsule.md'), 'utf8');
      const json = JSON.parse(readFileSync(join(out, 'plan-capsule.json'), 'utf8'));
      expect(json.sharedAcceptanceCriteria).toEqual([
        {
          id: 'AC-100',
          requirementCount: 2,
          positiveTestRef: 'tests/acceptance/AC-100.spec.ts',
          negativeOrFailureTestRef: 'tests/negative/AC-100.negative.spec.ts',
        },
      ]);
      expect(mdText.match(/## Shared acceptance criteria/g)).toHaveLength(1);
      expect(mdText).toContain('**AC-100** + `tests/acceptance/AC-100.spec.ts`');
      // owned ACs stay inline on their requirement
      expect(mdText).toContain('AC-101 +tests/acceptance/AC-101.spec.ts');
    } finally {
      rmSync(out, { recursive: true, force: true });
    }
  });

  it('fails closed on unknown package and on missing authoritative PRD', () => {
    const bad = runScript(BUILD, [
      '--package',
      'pkg-zzz',
      '--out',
      join(fx, 'out-z'),
      '--root',
      fx,
    ]);
    expect(bad.status).toBe(1);
    expect(bad.stderr).toContain('pkg-zzz');

    const noPrd = mkdtempSync(join(tmpdir(), 'plan-context-noprd-'));
    try {
      mkdirSync(join(noPrd, 'docs', 'spec'), { recursive: true });
      mkdirSync(join(noPrd, 'specs', 'implementation'), { recursive: true });
      writeFileSync(
        join(
          noPrd,
          'docs',
          'spec',
          'crypto_intelligence_agent_gateway_PRD_FINAL_v6.0.requirements.json',
        ),
        '{"requirements":[]}',
      );
      writeFileSync(
        join(noPrd, 'specs', 'implementation', 'current-milestone.json'),
        readFileSync(join(fx, 'specs', 'implementation', 'current-milestone.json')),
      );
      const r = runScript(BUILD, [
        '--package',
        'pkg-a',
        '--out',
        join(noPrd, 'o'),
        '--root',
        noPrd,
      ]);
      expect(r.status).toBe(1);
      expect(r.stderr).toContain('PRD');
    } finally {
      rmSync(noPrd, { recursive: true, force: true });
    }
  });
});

describe('bootstrap-package-spec (mechanical spec seeding)', () => {
  it('seeds spec.md only when absent, never clobbers existing work', () => {
    const first = runScript(BOOTSTRAP, ['--package', 'pkg-a', '--root', fx]);
    expect(first.status).toBe(0);
    expect(JSON.parse(first.stdout).seeded).toBe(true);

    const specPath = join(fx, 'specs', 'pkg-a', 'spec.md');
    const seeded = readFileSync(specPath, 'utf8');

    // Agent-style edit AFTER seeding must survive any re-run.
    writeFileSync(specPath, seeded + '\n## Planner-owned extension\n\nKeep me.\n');
    const second = runScript(BOOTSTRAP, ['--package', 'pkg-a', '--root', fx]);
    expect(second.status).toBe(0);
    expect(JSON.parse(second.stdout).seeded).toBe(false);
    expect(JSON.parse(second.stdout).skipped).toBe('spec_exists');
    expect(readFileSync(specPath, 'utf8')).toContain('Keep me.');
  });

  it('seeds complete traceable normative content and passes prettier', async () => {
    // fresh package dir: remove prior seed from the sibling test
    rmSync(join(fx, 'specs', 'pkg-a'), { recursive: true, force: true });
    const r = runScript(BOOTSTRAP, ['--package', 'pkg-a', '--root', fx]);
    expect(r.status).toBe(0);
    const specPath = join(fx, 'specs', 'pkg-a', 'spec.md');
    expect(existsSync(specPath)).toBe(true);
    const text = readFileSync(specPath, 'utf8');

    expect(text.length).toBeGreaterThan(50);
    expect(text).toContain('SUBORDINATE DERIVATIVE');
    // every assigned requirement id appears (validator traceability rule)
    expect(text).toContain('### FR-A-001');
    expect(text).toContain('### FR-A-002');
    expect(text).toContain('> The gateway SHALL validate every tool call.');
    // shared AC block present once with both test refs
    expect(text).toContain('## Shared acceptance criteria');
    expect(text).toContain('tests/acceptance/AC-100.spec.ts');
    expect(text).toContain('tests/negative/AC-100.negative.spec.ts');
    // non-goals enumerate sibling packages
    expect(text).toContain('`pkg-b`');

    // prettier canonical form (these files land in git where CI checks format)
    const prettier = await import('prettier');
    const formatted = await prettier.format(text, { parser: 'markdown', printWidth: 100 });
    expect(formatted).toBe(text);
  });
});
