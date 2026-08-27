// V3-D §11 — safe parallel landing / base-drift contract.
//
// Layers:
//   1. pure admission verdicts + ancestor semantics (base-drift.mjs);
//   2. attestation carries baseMainSha and reuse dies when main moves
//      (package-full-gate.mjs, injectable resolver — no network);
//   3. END-TO-END lander fixtures over real git repos with sibling bare
//      origins + stub gh: pre-push refusal on drift, happy landing when the
//      branch carries main, and TOCTOU closure (main advances DURING the CI
//      wait ⇒ the pre-merge re-check refuses).
//   4. final-land admission routes (provably drifted ⇒ refuse BEFORE burning
//      a FULL gate; unverifiable ⇒ advisory proceed).
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'bun:test';
import {
  BASE_DRIFT_REASON,
  landingAdmission,
  isAncestorSha,
  isShallowCheckout,
} from '../../scripts/automation/base-drift.mjs';
import {
  attestationDrift,
  attestationIdentity,
} from '../../scripts/automation/package-full-gate.mjs';
import {
  LAND_RESULT_FILE,
  LAND_RESULT_SCHEMA,
  runFinalLand,
} from '../../scripts/automation/package-final-land.mjs';

const ROOT = join(import.meta.dirname, '..', '..');
const LANDER = join(ROOT, 'scripts', 'automation', 'package-land.mjs');
const CHECK_NAME = 'Verify (spec, format, lint, types, tests)';

const tmpDirs: string[] = [];
afterAll(() => {
  for (const d of tmpDirs) rmSync(d, { recursive: true, force: true });
});
function tmp(prefix: string) {
  const d = mkdtempSync(join(tmpdir(), `foresift-v3d-${prefix}-`));
  tmpDirs.push(d);
  return d;
}

// ── 1. pure verdicts ─────────────────────────────────────────────────────────

describe('landingAdmission (pure)', () => {
  it('admits a branch that carries current main', () => {
    expect(
      landingAdmission({ currentMainResolved: true, branchContainsCurrentMain: true }),
    ).toEqual({ ok: true });
  });

  it('refuses with base-drift when main advanced past what the branch carries', () => {
    const v = landingAdmission({ currentMainResolved: true, branchContainsCurrentMain: false });
    expect(v.ok).toBe(false);
    if (!v.ok) {
      expect(v.reason).toBe(BASE_DRIFT_REASON);
      expect(v.detail).toMatch(/merge updated origin\/main|parallel landing/i);
    }
  });

  it('fails closed when origin/main is unverifiable', () => {
    const v = landingAdmission({ currentMainResolved: false, branchContainsCurrentMain: false });
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.reason).toBe(BASE_DRIFT_REASON);
  });
});

/** execFileSync-style failure carrying the child's exit status. */
function gitError(status: number): Error & { status: number } {
  return Object.assign(new Error(`exit ${status}`), { status });
}

describe('isAncestorSha', () => {
  it('true on exit 0, false on exit 1 (a real answer), null otherwise', () => {
    expect(isAncestorSha(() => '', 'a', 'b')).toBe(true);
    expect(
      isAncestorSha(
        () => {
          throw gitError(1);
        },
        'a',
        'b',
      ),
    ).toBe(false);
    expect(
      isAncestorSha(
        () => {
          throw gitError(128);
        },
        'a',
        'b',
      ),
    ).toBeNull();
  });
});

describe('isShallowCheckout', () => {
  it('true/false/null map straight through; git failure is unverifiable', () => {
    expect(isShallowCheckout(() => 'true\n')).toBe(true);
    expect(isShallowCheckout(() => 'false\n')).toBe(false);
    expect(isShallowCheckout(() => 'garbage')).toBeNull();
    expect(
      isShallowCheckout(() => {
        throw gitError(128);
      }),
    ).toBeNull();
  });

  it('a real shallow clone reports true; a full fixture repo reports false', () => {
    const fx = buildFixture('shallow-probe');
    expect(isShallowCheckout((...args: string[]) => inRepo(fx, args).trim())).toBe(false);
    // depth-1 fetch truncates history — the CI failure mode that motivated
    // shallow awareness (a "not-ancestor" answer there is meaningless).
    // file:// forces the smart transport (local-path clones ignore --depth).
    const shallowDir = tmp('shallow');
    execFileSync('git', [
      'clone',
      '-q',
      '--depth',
      '1',
      `file://${join(fx.root, 'repo')}-origin.git`,
      shallowDir,
    ]);
    const g = (...args: string[]) =>
      execFileSync('git', args, { cwd: shallowDir, encoding: 'utf8' }).trim();
    expect(isShallowCheckout(g)).toBe(true);
    expect(g('rev-parse', '--is-shallow-repository')).toBe('true');
  });
});

// ── 2. attestation base identity ─────────────────────────────────────────────

describe('FULL-gate attestation records baseMainSha (V3-D §11.1)', () => {
  it('identity includes baseMainSha from the injected resolver', () => {
    const id = attestationIdentity({
      packageId: 'g0-contracts-data-truth',
      repoRoot: ROOT,
      resolveBaseMain: () => 'f'.repeat(40),
    });
    expect(id.baseMainSha).toBe('f'.repeat(40));
  });

  it('reuse is INVALID once origin/main moved past the attested base', () => {
    const id = attestationIdentity({
      packageId: 'g0-contracts-data-truth',
      repoRoot: ROOT,
      resolveBaseMain: () => 'a'.repeat(40),
    });
    const moved = { ...id, baseMainSha: 'b'.repeat(40) };
    expect(attestationDrift(id, moved)).toContain('baseMainSha');
    expect(attestationDrift(id, { ...id })).toBeNull();
  });

  it('an OLD attestation without baseMainSha fails closed against a resolved base', () => {
    const id = attestationIdentity({
      packageId: 'g0-contracts-data-truth',
      repoRoot: ROOT,
      resolveBaseMain: () => 'c'.repeat(40),
    });
    const legacy = { ...id };
    // @ts-expect-error simulate a pre-V3D record lacking the field
    delete legacy.baseMainSha;
    expect(attestationDrift(legacy, id)).toContain('baseMainSha');
  });
});

// ── 3. end-to-end lander fixtures over real git + stub gh ────────────────────

interface Fixture {
  root: string;
  bin: string;
}

/** Real repo with sibling bare origin + a second "sibling" clone that can
 *  advance main mid-test (the parallel-landing simulation). */
function buildFixture(name: string): Fixture {
  const root = tmp(name);
  const repo = join(root, 'repo');
  const g = (...args: string[]) => execFileSync('git', args, { cwd: repo, encoding: 'utf8' });
  execFileSync('git', ['init', '-q', '-b', 'main', repo]);
  g('config', 'user.email', 't@t');
  g('config', 'user.name', 't');
  writeFileSync(join(repo, 'README.md'), `${name}\n`);
  g('add', '-A');
  g('commit', '-qm', 'seed');
  // Sibling bare origin OUTSIDE the tracked tree (hermetic convention).
  execFileSync('git', ['clone', '-q', '--bare', repo, `${repo}-origin.git`]);
  g('remote', 'add', 'origin', `${repo}-origin.git`);
  g('push', '-qu', 'origin', 'main');
  // Second clone used to land a sibling package / advance main.
  execFileSync('git', ['clone', '-q', `${repo}-origin.git`, join(root, 'sibling')]);
  // Two per-package clones for the §31 concurrency race: a lander owns its
  // checkout — two writers on ONE checkout corrupt each other's FETCH_HEAD and
  // pinned HEAD by construction (that boundary is exactly what this fixture
  // respects; §31 proves safety ACROSS checkouts, never within one).
  execFileSync('git', ['clone', '-q', `${repo}-origin.git`, join(root, 'land-a')]);
  execFileSync('git', ['clone', '-q', `${repo}-origin.git`, join(root, 'land-b')]);

  // Stub gh: instant-green named check at ANY sha; records every invocation.
  // Fault-injection knobs (§29 matrix):
  //   GHSTUB_ADVANCE_MAIN   one-shot: advance origin/main during the CI wait
  //                         (TOCTOU closure proof)
  //   GHSTUB_MOVE_BRANCH    one-shot: advance origin/<branch> during the CI
  //                         wait (head-moved refusal proof)
  //   GHSTUB_CONCLUSION     fixed check conclusion (default success)
  //   GHSTUB_EMPTY_RUNS     report zero check-runs (no-check-runs trap proof)
  const bin = join(root, 'bin');
  mkdirSync(bin);
  writeFileSync(
    join(bin, 'gh'),
    `#!/usr/bin/env bash
set -u
echo "$*" >>"\${GHSTUB_LOG:?}"
cmd="\${1:-}"; sub="\${2:-}"
case "\$cmd/\$sub" in
  pr/list) echo '' ;;
  pr/create) echo 'https://github.com/o/r/pull/77' ;;
  pr/merge)
    # §31 race serialization: exactly ONE squash merge ever succeeds. A second
    # merge attempt after the first is refused the way GitHub branch protection
    # refuses a PR that is no longer up to date. The claim is ATOMIC (noclobber
    # O_EXCL create): GitHub arbitrates merges atomically server-side, and a
    # check-then-touch window here let TWO concurrent landers both win (caught
    # by the pre-activation race-repeat leg, fixed 2026-08-23).
    if ! ( set -o noclobber; : > "\${GHSTUB_MERGED:?}" ) 2>/dev/null; then
      echo 'gh: pull request is not up to date with main (squash refused)' >&2
      exit 1
    fi
    # Optional winner side effect: the winning squash ADVANCES origin/main so a
    # concurrently-started lander must hit its pre-merge base re-check.
    if [ -n "\${GHSTUB_MERGE_ADVANCES_MAIN:-}" ]; then
      git -C "\${SIBLING_REPO:?}" pull -q origin main
      echo "winner-squash \$(date +%s%N)" >> "\${SIBLING_REPO}/f.txt"
      git -C "\${SIBLING_REPO}" add -A
      git -C "\${SIBLING_REPO}" -c user.email=t@t -c user.name=t commit -qm 'parallel winner lands'
      git -C "\${SIBLING_REPO}" push -q origin main
    fi
    exit 0 ;;
  api/*)
    # TOCTOU hook: advance origin/main exactly once before reporting green CI.
    if [ -n "\${GHSTUB_ADVANCE_MAIN:-}" ] && [ ! -e "\${GHSTUB_ADVANCE_MAIN}" ]; then
      touch "\${GHSTUB_ADVANCE_MAIN}"
      git -C "\${SIBLING_REPO:?}" pull -q origin main
      echo "sibling-advance \$(date +%s%N)" >> "\${SIBLING_REPO}/f.txt"
      git -C "\${SIBLING_REPO}" add -A
      git -C "\${SIBLING_REPO}" -c user.email=t@t -c user.name=t commit -qm 'sibling lands first'
      git -C "\${SIBLING_REPO}" push -q origin main
    fi
    # HEAD-moved hook: a sibling pushes to the SAME feature branch mid-wait.
    if [ -n "\${GHSTUB_MOVE_BRANCH:-}" ] && [ ! -e "\${GHSTUB_MOVE_BRANCH}" ]; then
      touch "\${GHSTUB_MOVE_BRANCH}"
      BRANCH_NAME="\$(git -C "\${LANDER_REPO:?}" rev-parse --abbrev-ref HEAD)"
      git -C "\${SIBLING_REPO:?}" fetch -q origin "\$BRANCH_NAME"
      git -C "\${SIBLING_REPO}" checkout -q --detach FETCH_HEAD
      git -C "\${SIBLING_REPO}" -c user.email=t@t -c user.name=t commit --allow-empty \\
        -qm 'sibling advances the same branch'
      git -C "\${SIBLING_REPO}" push -q origin "HEAD:\$BRANCH_NAME"
    fi
    if [ -n "\${GHSTUB_EMPTY_RUNS:-}" ]; then printf '[]'; exit 0; fi
    printf '[{"name":"%s","status":"completed","conclusion":"%s"}]' \\
      "\${GHSTUB_CHECK_NAME:?}" "\${GHSTUB_CONCLUSION:-success}"
    ;;
  *) echo "stub: unsupported invocation: $*" >&2; exit 1 ;;
esac
`,
  );
  chmodSync(join(bin, 'gh'), 0o755);
  return { root, bin };
}

function runLander(
  fx: Fixture,
  extraEnv: Record<string, string> = {},
  deadlineS?: number,
  pollS?: number,
) {
  return spawnSync(
    process.execPath,
    [
      LANDER,
      '--branch',
      'feat/pkg-a',
      '--title',
      'land pkg-a',
      ...(deadlineS ? ['--deadline-s', String(deadlineS)] : []),
      ...(pollS ? ['--poll-s', String(pollS)] : []),
    ],
    {
      encoding: 'utf8',
      cwd: join(fx.root, 'repo'),
      env: {
        ...process.env,
        PATH: `${fx.bin}:${process.env.PATH}`,
        GHSTUB_LOG: join(fx.root, 'gh.log'),
        GHSTUB_MERGED: join(fx.root, 'MERGED'),
        GHSTUB_CHECK_NAME: CHECK_NAME,
        LANDER_REPO: join(fx.root, 'repo'),
        SIBLING_REPO: join(fx.root, 'sibling'),
        ...extraEnv,
      },
    },
  );
}

const inRepo = (fx: Fixture, args: string[]) =>
  execFileSync('git', args, { cwd: join(fx.root, 'repo'), encoding: 'utf8' });

function makeBranch(fx: Fixture) {
  inRepo(fx, ['switch', '-qc', 'feat/pkg-a']);
  writeFileSync(join(fx.root, 'repo', 'work.txt'), 'pkg-a\n');
  inRepo(fx, ['add', '-A']);
  inRepo(fx, ['commit', '-qm', 'pkg-a work']);
}

describe('mechanical lander enforces base admission (V3-D §11.3)', () => {
  it('happy path: branch seeded at main tip lands; trace shows base-admitted', () => {
    const fx = buildFixture('happy');
    makeBranch(fx);
    const r = runLander(fx);
    expect(r.status).toBe(0);
    expect(r.stdout).toContain('base-admitted');
    expect(r.stdout).toContain('"merged": true');
  });

  it('pre-push refusal: a sibling already merged ⇒ base-drift, no PR, no merge', () => {
    const fx = buildFixture('early-drift');
    makeBranch(fx);
    // Simulate the sibling landing FIRST (advance origin/main past our seed).
    const sib = join(fx.root, 'sibling');
    execFileSync('git', [
      '-C',
      sib,
      '-c',
      'user.email=t@t',
      '-c',
      'user.name=t',
      'commit',
      '--allow-empty',
      '-qm',
      'sibling lands first',
    ]);
    execFileSync('git', ['-C', sib, 'push', '-q', 'origin', 'main']);
    const r = runLander(fx);
    expect(r.status).toBe(1);
    expect(r.stdout).toContain(`"reason": "${BASE_DRIFT_REASON}"`);
    expect(existsMerged(fx)).toBe(false);
    expect(ghCalls(fx)).not.toContain('pr create'); // refused BEFORE any PR work
  });

  it('TOCTOU closure: main advances DURING the CI wait ⇒ pre-merge re-check refuses', () => {
    const fx = buildFixture('toctou');
    makeBranch(fx);
    const r = runLander(fx, { GHSTUB_ADVANCE_MAIN: join(fx.root, 'advanced.flag') });
    expect(r.status).toBe(1);
    expect(r.stdout).toContain(`"reason": "${BASE_DRIFT_REASON}"`);
    expect(existsMerged(fx)).toBe(false); // never merged despite green CI
    expect(r.stdout).toContain('aborted-pre-merge-base');
  });

  it('§29-E21: red CI at the pinned head ⇒ ci-red refusal, never bypassed', () => {
    const fx = buildFixture('ci-red');
    makeBranch(fx);
    const r = runLander(fx, { GHSTUB_CONCLUSION: 'failure' });
    expect(r.status).toBe(1);
    expect(r.stdout).toContain('"reason": "ci-red"');
    expect(r.stdout).toContain(`${CHECK_NAME}:failure`);
    expect(existsMerged(fx)).toBe(false);
  });

  it('§29-E22: zero check-runs at pinned head ⇒ no-check-runs diagnose-and-fail-fast', () => {
    const fx = buildFixture('no-check-runs');
    makeBranch(fx);
    // deadline 12s ⇒ diagnose threshold min(deadlineMs/2, 300s) = 6s; with an
    // explicit 5s poll cadence the diagnostic trips on the third poll (~10s
    // wall clock), INSIDE the deadline — fail-fast, not timeout.
    const r = runLander(fx, { GHSTUB_EMPTY_RUNS: '1' }, 12, 5);
    expect(r.status).toBe(1);
    expect(r.stdout).toContain('"reason": "no-check-runs"');
    expect(r.stdout).toMatch(/since-squashed commit|recreate the branch/);
    expect(r.stdout).not.toContain('"reason": "timeout"');
    expect(existsMerged(fx)).toBe(false);
  }, 30000);

  it('§29-E24: origin branch moves DURING the wait ⇒ head-moved abort, never merge a moving target', () => {
    const fx = buildFixture('head-moved');
    makeBranch(fx);
    const r = runLander(fx, { GHSTUB_MOVE_BRANCH: join(fx.root, 'moved.flag') });
    expect(r.status).toBe(1);
    expect(r.stdout).toContain('"reason": "head-moved"');
    expect(r.stdout).toContain('aborted-drift');
    expect(existsMerged(fx)).toBe(false);
  });
});

// ── §31: speculative/parallel product safety — TRUE concurrency ──────────────

/** spawn-based lander so two can run against the SAME origin simultaneously —
 *  each from its OWN package clone (one checkout per writer, always). */
function runLanderAsync(
  fx: Fixture,
  branch: string,
  checkout: string,
): Promise<{
  status: number | null;
  stdout: string;
}> {
  return new Promise((resolveP) => {
    const child = spawn(
      process.execPath,
      [LANDER, '--branch', branch, '--title', `land ${branch}`],
      {
        cwd: join(fx.root, checkout),
        env: {
          ...process.env,
          PATH: `${fx.bin}:${process.env.PATH}`,
          GHSTUB_LOG: join(fx.root, `gh-${branch}.log`),
          GHSTUB_MERGED: join(fx.root, 'MERGED'),
          GHSTUB_CHECK_NAME: CHECK_NAME,
          LANDER_REPO: join(fx.root, checkout),
          SIBLING_REPO: join(fx.root, 'sibling'),
          GHSTUB_MERGE_ADVANCES_MAIN: '1',
        },
      },
    );
    let out = '';
    child.stdout.on('data', (d: Buffer) => {
      out += String(d);
    });
    child.stderr.on('data', (d: Buffer) => {
      out += String(d);
    });
    child.on('close', (code) => resolveP({ status: code, stdout: out }));
  });
}

describe('§31: two landers racing the same origin ⇒ exactly one winner', () => {
  function seedPackage(fx: Fixture, checkout: string, branch: string, file: string) {
    const c = join(fx.root, checkout);
    execFileSync('git', ['-C', c, 'switch', '-qc', branch, 'main']);
    writeFileSync(join(c, file), `${file}\n`);
    execFileSync('git', ['-C', c, 'add', '-A']);
    // Fresh clones carry no local identity config — supply it inline.
    execFileSync('git', [
      '-C',
      c,
      '-c',
      'user.email=t@t',
      '-c',
      'user.name=t',
      'commit',
      '-qm',
      `${file} work`,
    ]);
  }

  it('concurrent landing never double-merges; the loser refuses or loses at merge time', async () => {
    const fx = buildFixture('race-two-landers');
    // Two INDEPENDENT packages, each in its own checkout at the same main tip.
    seedPackage(fx, 'land-a', 'feat/pkg-a', 'a.txt');
    seedPackage(fx, 'land-b', 'feat/pkg-b', 'b.txt');

    const [a, b] = await Promise.all([
      runLanderAsync(fx, 'feat/pkg-a', 'land-a'),
      runLanderAsync(fx, 'feat/pkg-b', 'land-b'),
    ]);

    const results = [a, b];
    const winners = results.filter((r) => r.status === 0 && r.stdout.includes('"merged": true'));
    expect(winners).toHaveLength(1); // exactly one winner — never two
    const losers = results.filter((r) => r !== winners[0]);
    for (const l of losers) expect(l.status).not.toBe(0);
    // The loser's refusal names a drift/serialization guard, or its merge call
    // was refused as not-up-to-date — either way it FAILED CLOSED loudly.
    const loserOut = losers.map((l) => l.stdout).join('');
    expect(
      /base-drift|aborted-pre-merge-base|not up to date with main|head-moved/.test(loserOut),
    ).toBe(true);
    expect(existsMerged(fx)).toBe(true);
  }, 30000);

  it('merge serialization alone holds even without main advancement (idempotent guard)', async () => {
    // Same race but WITHOUT advancing main on win: proves the MERGED-flag
    // check by itself serializes squash merges under any interleaving.
    const fx = buildFixture('race-serial-only');
    inRepo(fx, ['switch', '-qc', 'feat/pkg-a']);
    writeFileSync(join(fx.root, 'repo', 'a.txt'), 'pkg-a\n');
    inRepo(fx, ['add', '-A']);
    inRepo(fx, ['commit', '-qm', 'pkg-a work']);
    inRepo(fx, ['switch', '-qc', 'feat/pkg-b', 'main']);
    writeFileSync(join(fx.root, 'repo', 'b.txt'), 'pkg-b\n');
    inRepo(fx, ['add', '-A']);
    inRepo(fx, ['commit', '-qm', 'pkg-b work']);

    // Direct stub-level proof of the serialization rule: first merge wins,
    // second is refused regardless of order or interleaving.
    const ghOnce = (args: string[]) =>
      execFileSync(join(fx.bin, 'gh'), args, {
        encoding: 'utf8',
        env: {
          ...process.env,
          GHSTUB_LOG: join(fx.root, 'gh-serial.log'),
          GHSTUB_MERGED: join(fx.root, 'MERGED'),
        },
      });
    ghOnce(['pr', 'merge', '77', '--squash']);
    expect(existsMerged(fx)).toBe(true);
    const second = (() => {
      try {
        ghOnce(['pr', 'merge', '88', '--squash']);
        return 0;
      } catch (e) {
        return (e as { status?: number }).status ?? 1;
      }
    })();
    expect(second).not.toBe(0);
  }, 30000);
});

function existsMerged(fx: Fixture): boolean {
  try {
    readFileSync(join(fx.root, 'MERGED'), 'utf8');
    return true;
  } catch {
    return false;
  }
}
function ghCalls(fx: Fixture): string {
  try {
    return readFileSync(join(fx.root, 'gh.log'), 'utf8');
  } catch {
    return '';
  }
}

// ── 4. final-land admission routes ───────────────────────────────────────────

describe('runFinalLand base-drift admission (V3-D §11.2)', () => {
  const baseArgs = { package: 'p', branch: 'feat/x', artifactsDir: '' };

  function freshArtifacts() {
    const art = tmp('art');
    Object.assign(baseArgs, { artifactsDir: art });
    return art;
  }

  it('provably drifted ⇒ refuses BEFORE any gate work, exit 4, verdict persisted', () => {
    const art = freshArtifacts();
    let gatesTouched = false;
    const boom = () => {
      gatesTouched = true;
      return { status: 0 };
    };
    /** Run fn capturing the process.exitCode it leaves behind (runFinalLand
     *  sets exit codes instead of exiting when used as a library). */
    function captureExit(fn: () => unknown): string | number | undefined {
      const prev = process.exitCode;
      process.exitCode = 0;
      try {
        fn();
      } finally {
        const code = process.exitCode;
        process.exitCode = prev ?? 0;
        return code;
      }
    }
    const code = captureExit(() =>
      runFinalLand(baseArgs, {
        admission: () => ({ ok: false, reason: BASE_DRIFT_REASON, detail: 'main moved' }),
        gateCheck: boom,
        gateRun: boom,
        lander: boom,
        now: () => '2026-08-23T00:00:00Z',
      }),
    );
    expect(gatesTouched).toBe(false); // zero gate burn on a doomed landing
    expect(code).toBe(4);
    const rec = JSON.parse(readFileSync(join(art, LAND_RESULT_FILE), 'utf8'));
    expect(rec.schema).toBe(LAND_RESULT_SCHEMA);
    expect(rec.merged).toBe(false);
    expect(rec.reason).toBe(BASE_DRIFT_REASON);
  });

  it('advisory-ok environments proceed to the normal reuse route', () => {
    freshArtifacts();
    function captureExit(fn: () => unknown): string | number | undefined {
      const prev = process.exitCode;
      process.exitCode = 0;
      try {
        fn();
      } finally {
        const code = process.exitCode;
        process.exitCode = prev ?? 0;
        return code;
      }
    }
    const code = captureExit(() =>
      runFinalLand(baseArgs, {
        admission: () => ({ ok: true, advisory: true }), // e.g. fixture w/o remote
        gateCheck: () => ({ status: 0 }), // valid attestation present
        lander: () => ({
          status: 0,
          stdout: JSON.stringify({ merged: true, pr: 7 }) + '\n',
        }),
        now: () => '2026-08-23T00:00:00Z',
      }),
    );
    expect(code).toBe(0);
  });
});
