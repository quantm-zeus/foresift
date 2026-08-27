// V2 second-pass C3 regression battery (task spec §13–§14, §23 items 33–38):
// deterministic PR creation, mechanical final landing with bounded AI
// fallback, and the structural separation between the OPTIMIZED mechanical
// lane and the untouched LEGACY AI commands.
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'bun:test';
import {
  composePrBody,
  ensurePullRequest,
  PR_NUMBER_FILE,
} from '../../scripts/automation/package-create-pr.mjs';
import {
  LAND_RESULT_FILE,
  LAND_RESULT_SCHEMA,
  runFinalLand,
} from '../../scripts/automation/package-final-land.mjs';

const ROOT = join(import.meta.dirname, '..', '..');
const SCRIPTS = join(ROOT, 'scripts', 'automation');
const WORKFLOWS = join(ROOT, '.archon', 'workflows', 'foresift');
const COMMANDS = join(ROOT, '.archon', 'commands');

const tmpDirs: string[] = [];
afterAll(() => {
  for (const d of tmpDirs) rmSync(d, { recursive: true, force: true });
});
function tmp() {
  const d = mkdtempSync(join(tmpdir(), 'foresift-c3-'));
  tmpDirs.push(d);
  return d;
}

/** Milestone fixture satisfying validateMilestoneState (>= 2 packages). */
function writeMilestone(root: string, pkgOverrides: Record<string, unknown> = {}) {
  const ms = {
    schemaVersion: '1.0.0',
    milestoneId: 'm1',
    status: 'ACTIVE',
    packages: [
      {
        id: 'pkg-alpha',
        objective: 'Implement the alpha capability end to end',
        requirementIds: ['REQ-001', 'REQ-002'],
        dependencies: [],
        risk: 'LOW',
        parallelizable: true,
        writeScopes: ['src/alpha'],
        verificationCommands: ['pnpm test -- src/alpha'],
        status: 'REVIEWING',
        ...pkgOverrides,
      },
      {
        id: 'pkg-beta',
        objective: 'Implement the beta capability end to end',
        requirementIds: ['REQ-003'],
        dependencies: ['pkg-alpha'],
        risk: 'MEDIUM',
        parallelizable: false,
        writeScopes: ['src/beta'],
        verificationCommands: ['pnpm test -- src/beta'],
        status: 'PENDING',
      },
    ],
  };
  mkdirSync(join(root, 'specs', 'implementation'), { recursive: true });
  writeFileSync(
    join(root, 'specs', 'implementation', 'current-milestone.json'),
    JSON.stringify(ms, null, 2),
  );
  return ms;
}

function greenManifest(packageId = 'pkg-alpha') {
  return {
    schema: 'foresift/full-gate-result@1',
    packageId,
    passed: true,
    exitCode: 0,
    failedCategories: [],
    checks: [
      { label: 'spec integrity', category: 'SPEC', command: 'pnpm spec:verify', status: 'PASS' },
      { label: 'tests', category: 'TESTS', command: 'pnpm test', status: 'PASS' },
    ],
    timestamp: new Date().toISOString(),
  };
}

describe('composePrBody — deterministic composition (§23 item 33)', () => {
  it('is byte-identical across repeated invocations on the same inputs', () => {
    const root = tmp();
    const art = tmp();
    writeMilestone(root);
    writeFileSync(join(art, 'full-gate-result.json'), JSON.stringify(greenManifest()));
    const a = composePrBody({ packageId: 'pkg-alpha', repoRoot: root, artifactsDir: art });
    const b = composePrBody({ packageId: 'pkg-alpha', repoRoot: root, artifactsDir: art });
    expect(b.body).toBe(a.body);
    expect(b.title).toBe(a.title);
  });

  it('derives title, objective, requirement IDs and risk from milestone metadata', () => {
    const root = tmp();
    const art = tmp();
    writeMilestone(root);
    const { title, body } = composePrBody({
      packageId: 'pkg-alpha',
      repoRoot: root,
      artifactsDir: art,
    });
    expect(title).toBe('feat(pkg-alpha): Implement the alpha capability end to end');
    expect(body).toContain('## Objective');
    expect(body).toContain('Implement the alpha capability end to end');
    expect(body).toContain('- REQ-001');
    expect(body).toContain('- REQ-002');
    expect(body).toContain('`LOW`');
    expect(body).toContain('specs/pkg-alpha/spec.md');
  });

  it('includes structured gate evidence from the persisted manifest + attestation', () => {
    const root = tmp();
    const art = tmp();
    writeMilestone(root);
    writeFileSync(join(art, 'full-gate-result.json'), JSON.stringify(greenManifest()));
    writeFileSync(
      join(art, 'full-gate-attestation.json'),
      JSON.stringify({
        result: 'PASS',
        headSha: 'a'.repeat(40),
        timestamp: '2026-08-23T00:00:00Z',
      }),
    );
    const { body } = composePrBody({ packageId: 'pkg-alpha', repoRoot: root, artifactsDir: art });
    expect(body).toContain('## Deterministic verification evidence');
    expect(body).toContain('**PASSED** — 2/2 checks green');
    expect(body).toContain('Exact-head attestation present');
    expect(body).toContain('`aaaaaaaaaaaa`');
  });

  it('degrades without inventing: absent milestone/artifacts yield unavailable markers', () => {
    const root = tmp(); // no milestone file
    const art = tmp(); // no artifacts
    const { body } = composePrBody({ packageId: 'pkg-alpha', repoRoot: root, artifactsDir: art });
    expect(body).not.toContain('## Deterministic verification evidence');
    expect(body).not.toContain('PASSED');
    expect(body).toContain('(objective unavailable)');
    expect(body).toContain('- (requirement list unavailable)');
  });

  it('appends recorded out-of-scope notes verbatim when present', () => {
    const root = tmp();
    const art = tmp();
    writeMilestone(root);
    writeFileSync(join(art, 'out-of-scope-notes.md'), 'Deliberately deferred: telemetry export.\n');
    const { body } = composePrBody({ packageId: 'pkg-alpha', repoRoot: root, artifactsDir: art });
    expect(body).toContain('## Out-of-scope notes');
    expect(body).toContain('Deliberately deferred: telemetry export.');
  });

  it('never claims attestation identity for a FAILED manifest', () => {
    const root = tmp();
    const art = tmp();
    writeMilestone(root);
    const failed = { ...greenManifest(), passed: false };
    writeFileSync(join(art, 'full-gate-result.json'), JSON.stringify(failed));
    const { body } = composePrBody({ packageId: 'pkg-alpha', repoRoot: root, artifactsDir: art });
    expect(body).toContain('**FAILED**');
    expect(body).not.toContain('Exact-head attestation present');
  });
});

describe('ensurePullRequest — discover-or-create via injectable runner (§23 item 34)', () => {
  function recordingRunner(responses: string[]) {
    const calls: { cmd: string; args: string[] }[] = [];
    const run = (cmd: string, args: string[]) => {
      calls.push({ cmd, args });
      return responses[calls.length - 1] ?? '';
    };
    return { calls, run };
  }

  it('discovers an existing open PR WITHOUT calling gh pr create', () => {
    const { calls, run } = recordingRunner(['42']);
    const r = ensurePullRequest({ branch: 'feat/x', title: 't', bodyFile: '/tmp/body.md', run });
    expect(r).toEqual({ prNumber: '42', created: false });
    expect(calls).toHaveLength(1);
    expect(calls[0]!.args).toContain('pr');
    expect(calls[0]!.args.join(' ')).not.toContain('create');
  });

  it('creates against main with --body-file when no open PR exists', () => {
    const { calls, run } = recordingRunner(['', 'https://github.com/o/r/pull/77']);
    const r = ensurePullRequest({ branch: 'feat/x', title: 'T', bodyFile: '/tmp/body.md', run });
    expect(r).toEqual({ prNumber: '77', created: true });
    const create = calls[1]!;
    expect(create.args.slice(0, 2)).toEqual(['pr', 'create']);
    const args: string[] = create.args;
    expect(args).toContain('--base');
    expect(args[args.indexOf('--base') + 1]).toBe('main');
    expect(args).toContain('--head');
    expect(args[args.indexOf('--head') + 1]).toBe('feat/x');
    expect(create.args).toContain('--body-file');
  });

  it('throws on unparseable creation output instead of guessing a number', () => {
    const { run } = recordingRunner(['', 'created something']);
    expect(() => ensurePullRequest({ branch: 'b', title: 't', bodyFile: 'f', run })).toThrow(
      /could not parse PR number/,
    );
  });
});

describe('package-create-pr CLI — dry-run proof (§23 item 35)', () => {
  function initGitRepo(root: string) {
    const git = (...args: string[]) =>
      execFileSync('git', ['-C', root, ...args], { encoding: 'utf8' });
    execFileSync('git', ['init', '-q', '-b', 'main', root]);
    git('-c', 'user.email=t@t', '-c', 'user.name=t', 'add', '-A');
    git('-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-qm', 'fixture');
    return git;
  }

  it('emits the composed JSON, touches no PR state, and refuses a dirty tree', () => {
    const repo = tmp();
    const art = tmp();
    writeMilestone(repo);
    initGitRepo(repo);

    const out = execFileSync(
      process.execPath,
      [
        join(SCRIPTS, 'package-create-pr.mjs'),
        '--package',
        'pkg-alpha',
        '--branch',
        'feat/pkg-alpha',
        '--artifacts-dir',
        art,
        '--repo-root',
        repo,
        '--dry-run',
      ],
      { encoding: 'utf8' },
    );
    const parsed = JSON.parse(out);
    expect(parsed.dryRun).toBe(true);
    expect(parsed.title).toBe('feat(pkg-alpha): Implement the alpha capability end to end');
    expect(parsed.body).toContain('## Requirements');

    // Dry-run persists nothing.
    expect(existsSync(join(art, PR_NUMBER_FILE))).toBe(false);
    expect(existsSync(join(art, 'pr-body.md'))).toBe(false);

    // Dirty tracked tree ⇒ refusal BEFORE any push/create.
    writeFileSync(join(repo, 'specs', 'implementation', 'current-milestone.json'), '{}');
    let refused = false;
    try {
      execFileSync(
        process.execPath,
        [
          join(SCRIPTS, 'package-create-pr.mjs'),
          '--package',
          'pkg-alpha',
          '--branch',
          'feat/pkg-alpha',
          '--artifacts-dir',
          art,
          '--repo-root',
          repo,
        ],
        { encoding: 'utf8', stdio: 'pipe' },
      );
    } catch (e) {
      refused = true;
      expect(String((e as { stderr?: Buffer }).stderr)).toMatch(/REFUSED: dirty tracked tree/);
    }
    expect(refused).toBe(true);
    expect(existsSync(join(art, PR_NUMBER_FILE))).toBe(false);
  });

  it('exits 2 on missing required arguments', () => {
    let code = 0;
    try {
      execFileSync(process.execPath, [join(SCRIPTS, 'package-create-pr.mjs')], {
        encoding: 'utf8',
        stdio: 'pipe',
      });
    } catch (e) {
      code = (e as { status?: number }).status ?? -1;
    }
    expect(code).toBe(2);
  });
});

describe('runFinalLand — deterministic landing routes (§23 items 36–37)', () => {
  const baseArgs = { package: 'pkg-alpha', branch: 'feat/pkg-alpha' };
  let savedExit: typeof process.exitCode;
  const readExit = () => process.exitCode;
  function withExit<T>(fn: () => T): T {
    savedExit = process.exitCode;
    process.exitCode = undefined;
    try {
      return fn();
    } finally {
      // assertions read process.exitCode before restore
    }
  }

  it('reuse path: --check hit ⇒ ATTESTATION_REUSE, zero FULL executions, merged', () => {
    const art = tmp();
    let gateRuns = 0;
    const r = withExit(() =>
      runFinalLand(
        { ...baseArgs, artifactsDir: art },
        {
          admission: () => ({ ok: true, advisory: true }),
          gateCheck: () => ({ status: 0 }),
          gateRun: () => {
            gateRuns++;
            return { status: 0 };
          },
          lander: () => ({
            status: 0,
            stdout: '{"merged":true,"pr":123,"squashSha":"abc"}',
          }),
          now: () => '2026-08-23T00:00:00Z',
        },
      ),
    );
    expect(r.ok).toBe(true);
    expect(gateRuns).toBe(0);
    expect(readExit()).toBe(0);
    const rec = JSON.parse(readFileSync(join(art, LAND_RESULT_FILE), 'utf8'));
    expect(rec.merged).toBe(true);
    expect(rec.reason).toBeNull();
    expect(rec.gateMode).toBe('ATTESTATION_REUSE');
    expect(rec.prNumber).toBe(123);
  });

  it('check miss ⇒ exactly ONE fresh FULL run, then FULL_RUN merge', () => {
    const art = tmp();
    let checks = 0;
    let runs = 0;
    const r = runFinalLand(
      { ...baseArgs, artifactsDir: art },
      {
        admission: () => ({ ok: true, advisory: true }),
        gateCheck: () => {
          checks++;
          return { status: 1 };
        },
        gateRun: () => {
          runs++;
          return { status: 0 };
        },
        lander: () => ({ status: 0, stdout: '{"merged":true,"pr":9}' }),
        now: () => '2026-08-23T00:00:00Z',
      },
    );
    expect(r.ok).toBe(true);
    expect(checks).toBe(1);
    expect(runs).toBe(1);
    const rec = JSON.parse(readFileSync(join(art, LAND_RESULT_FILE), 'utf8'));
    expect(rec.gateMode).toBe('FULL_RUN');
    expect(rec.merged).toBe(true);
  });

  it('red FULL gate ⇒ merged:false / full-gate-red / exit 4, lander never invoked', () => {
    const art = tmp();
    let landerCalls = 0;
    const r = runFinalLand(
      { ...baseArgs, artifactsDir: art },
      {
        admission: () => ({ ok: true, advisory: true }),
        gateCheck: () => ({ status: 1 }),
        gateRun: () => ({ status: 1 }),
        lander: () => {
          landerCalls++;
          return { status: 0 };
        },
        now: () => '2026-08-23T00:00:00Z',
      },
    );
    expect(r.ok).toBe(false);
    expect(landerCalls).toBe(0);
    expect(process.exitCode).toBe(4);
    const rec = JSON.parse(readFileSync(join(art, LAND_RESULT_FILE), 'utf8'));
    expect(rec.merged).toBe(false);
    expect(rec.reason).toBe('full-gate-red');
    process.exitCode = savedExit;
  });

  it('red CI from the lander ⇒ reason ci-red preserved, exit 4', () => {
    const art = tmp();
    runFinalLand(
      { ...baseArgs, artifactsDir: art },
      {
        admission: () => ({ ok: true, advisory: true }),
        gateCheck: () => ({ status: 0 }),
        lander: () => ({
          status: 1,
          stdout:
            'LAND ▸ ci-red: x\n{\n  "merged": false,\n  "reason": "ci-red",\n  "failures": ["Verify:failure"]\n}',
        }),
        now: () => '2026-08-23T00:00:00Z',
      },
    );
    expect(process.exitCode).toBe(4);
    const rec = JSON.parse(readFileSync(join(art, LAND_RESULT_FILE), 'utf8'));
    expect(rec.merged).toBe(false);
    expect(rec.reason).toBe('ci-red');
    process.exitCode = savedExit;
  });

  it('unparseable lander failure degrades to lander-exit-N, still exit 4', () => {
    const art = tmp();
    runFinalLand(
      { ...baseArgs, artifactsDir: art },
      {
        admission: () => ({ ok: true, advisory: true }),
        gateCheck: () => ({ status: 0 }),
        lander: () => ({ status: 1, stdout: 'kaboom' }),
        now: () => '2026-08-23T00:00:00Z',
      },
    );
    const rec = JSON.parse(readFileSync(join(art, LAND_RESULT_FILE), 'utf8'));
    expect(rec.reason).toBe('lander-exit-1');
    process.exitCode = savedExit;
  });

  it('missing arguments ⇒ usage exit 2 with NO verdict record', () => {
    const art = tmp();
    const r = runFinalLand({ package: 'pkg-alpha' }, { now: () => 'x' });
    expect(r.usage).toBe(true);
    expect(process.exitCode).toBe(2);
    expect(existsSync(join(art, LAND_RESULT_FILE))).toBe(false);
    process.exitCode = savedExit;
  });

  it('every terminal record carries the contract schema', () => {
    const art = tmp();
    runFinalLand(
      { ...baseArgs, artifactsDir: art },
      {
        admission: () => ({ ok: true, advisory: true }),
        gateCheck: () => ({ status: 0 }),
        lander: () => ({ status: 0, stdout: '{}' }),
        now: () => 't',
      },
    );
    const rec = parseFinalRecord(art);
    expect(rec.schema).toBe(LAND_RESULT_SCHEMA);
  });
});

function parseFinalRecord(art: string) {
  return JSON.parse(readFileSync(join(art, LAND_RESULT_FILE), 'utf8')) as {
    schema: string;
    merged: boolean;
  };
}

describe('workflow topology — OPTIMIZED mechanical vs LEGACY AI (§23 item 38)', () => {
  const optimized = readFileSync(join(WORKFLOWS, 'foresift-work-package-optimized.yaml'), 'utf8');
  const legacy = readFileSync(join(WORKFLOWS, 'foresift-work-package.yaml'), 'utf8');
  const fallbackMd = readFileSync(join(COMMANDS, 'foresift-wp-ci-merge-optimized.md'), 'utf8');

  it('OPTIMIZED create-pr is a deterministic bash node, not the AI command', () => {
    expect(optimized).not.toMatch(/command:\s*foresift-wp-create-pr\b/);
    expect(optimized).toContain('package-create-pr.mjs');
    const createBlock = optimized.slice(
      optimized.indexOf('- id: create-pr'),
      optimized.indexOf('- id: pre-review-snapshot'),
    );
    expect(createBlock).toContain('bash:');
    expect(createBlock).toContain('--branch "$(git rev-parse --abbrev-ref HEAD)"');
    expect(createBlock).toContain('--artifacts-dir "$ARTIFACTS_DIR"');
  });

  it('final-land-router routes on fixed tokens and always exits 0', () => {
    expect(optimized).toContain('LANDED_MECHANICAL');
    expect(optimized).toContain('LANDING_NEEDS_AI');
    const block = optimized.slice(
      optimized.indexOf('- id: final-land-router'),
      optimized.indexOf('- id: ai-landing-fallback'),
    );
    expect(block).toContain('package-final-land.mjs');
    expect(block).toContain('exit 0');
    expect(block).toMatch(/timeout:\s*3600000/); // bounded CI wait headroom
  });

  it('ai-landing-fallback is when-gated on LANDING_NEEDS_AI only', () => {
    const block = optimized.slice(
      optimized.indexOf('- id: ai-landing-fallback'),
      optimized.indexOf('- id: landing-verifier'),
    );
    expect(block).toContain('when: "$final-land-router.output == \'LANDING_NEEDS_AI\'"');
    expect(block).toContain('command: foresift-wp-ci-merge-optimized');
    expect(block).toContain('context: fresh');
  });

  it('landing-verifier accepts ONLY a merged:true contract record', () => {
    const block = optimized.slice(optimized.indexOf('- id: landing-verifier'));
    expect(block).toContain(LAND_RESULT_SCHEMA);
    expect(block).toContain('merged!==true');
    expect(block).toContain('depends_on: [final-land-router, ai-landing-fallback]');
    expect(block).toContain('none_failed_min_one_success'); // skipped fallback tolerated
  });

  it('LEGACY workflow keeps its AI commands byte-for-byte and gains no V2 nodes', () => {
    expect(legacy).toMatch(/command:\s*foresift-wp-create-pr\s*$/m);
    expect(legacy).toMatch(/command:\s*foresift-wp-ci-merge\s*$/m);
    expect(legacy).not.toContain('final-land-router');
    expect(legacy).not.toContain('landing-verifier');
    expect(legacy).not.toContain('package-final-land.mjs');
  });

  it('the AI fallback command ends by re-running the MECHANICAL script', () => {
    expect(fallbackMd).toContain('package-final-land.mjs');
    expect(fallbackMd).toContain('MERGE_BLOCKED:');
    expect(fallbackMd).toMatch(/never force-push/i);
    expect(fallbackMd).not.toContain('--force-with-lease');
    expect(fallbackMd).not.toContain('gh pr merge');
  });
});
