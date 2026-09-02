// Seeded-template git fixture factory (C2.5 §5).
//
// Building a fresh git repo per behavioral assertion used to cost ~8 git
// process spawns per fixture (init, 2×config, bare-origin init, remote add,
// add, commit, push) — measured at 100 spawns for v2-throughput.spec alone.
// This factory builds ONE template repo (+ bare origin) per worker process,
// then materializes each fixture as a plain recursive copy (zero git spawns
// per fixture). Identity comes from GIT_* environment variables so no
// `git config` calls are needed and the user's real global config is ignored.
//
// The template also carries a minimal milestone-control state
// (roadmap + current-milestone with packages `g0-security-perimeter` and
// `g0-contracts-data-truth`), and the factory points FORESIFT_REPO_ROOT at
// the fixture root. Attestation identity resolves risk/profile from the
// milestone via that seam (same pattern as milestone-mode.mjs), so specs
// that previously required a REAL package id in the live checkout's
// milestone keep working when the milestone is archived (the audit-conclude
// contract deletes current-milestone.json; live PR #168).
import { execFileSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const GIT_ENV: NodeJS.ProcessEnv = {
  GIT_AUTHOR_NAME: 't',
  GIT_AUTHOR_EMAIL: 't@t',
  GIT_COMMITTER_NAME: 't',
  GIT_COMMITTER_EMAIL: 't@t',
  // Deterministic + fast: ignore any machine-global git configuration/hooks.
  GIT_CONFIG_GLOBAL: '/dev/null',
  GIT_CONFIG_SYSTEM: '/dev/null',
};

/** Minimal but schema-valid milestone state for attestation-identity fixtures. */
const FIXTURE_MILESTONE = {
  schemaVersion: '1.0.0',
  milestoneId: 'G0',
  status: 'ACTIVE',
  packages: ['g0-security-perimeter', 'g0-contracts-data-truth'].map((id, i) => ({
    id,
    objective: 'an outcome-oriented objective sentence for fixture packages',
    requirementIds: [`FR-SEC-00${i + 1}`],
    dependencies: [],
    risk: 'HIGH',
    parallelizable: false,
    writeScopes: [`packages/${id}/**`],
    verificationCommands: ['pnpm test'],
    status: 'PROVEN',
  })),
};

let baseDir: string | null = null;
let templateRoot: string | null = null;
let templateOrigin: string | null = null;

function ensureTemplate(): void {
  if (templateRoot && templateOrigin) return;
  baseDir = mkdtempSync(join(tmpdir(), 'foresift-gitfix-'));
  templateRoot = join(baseDir!, 'template');
  templateOrigin = join(baseDir!, 'template-origin.git');
  const g = (args: string[], cwd: string = templateRoot!) =>
    execFileSync('git', args, { cwd, encoding: 'utf8', env: { ...process.env, ...GIT_ENV } });
  mkdirSync(templateRoot, { recursive: true });
  g(['init', '-q', '--initial-branch=main', '.']);
  writeFileSync(join(templateRoot, 'base.txt'), 'base\n');
  mkdirSync(join(templateRoot, 'specs', 'implementation'), { recursive: true });
  writeFileSync(
    join(templateRoot, 'specs', 'implementation', 'roadmap.json'),
    JSON.stringify({
      schemaVersion: '1.0.0',
      policy: {},
      currentMilestoneId: 'G0',
      milestones: [{ id: 'G0', name: 'g0', dependsOn: [], status: 'ACTIVE' }],
    }),
  );
  writeFileSync(
    join(templateRoot, 'specs', 'implementation', 'current-milestone.json'),
    JSON.stringify(FIXTURE_MILESTONE),
  );
  g(['add', '.']);
  g(['commit', '-qm', 'base']);
  // Bare "origin" so merge-base(HEAD, origin/main) resolution is exercisable.
  g(['init', '-q', '--bare', '--initial-branch=main', templateOrigin]);
  // Configure + push via the named remote so the template carries a real
  // refs/remotes/origin/main tracking ref (pushing to a bare PATH would not).
  g(['remote', 'add', 'origin', templateOrigin]);
  g(['push', '-q', 'origin', 'main:main']);
}

export interface GitFixture {
  root: string;
  g: (args: string[]) => string;
  /** Point FORESIFT_REPO_ROOT at this fixture's milestone state. */
  withMilestoneRoot: () => string;
  baseSha: () => string;
  writeFile: (rel: string, content: string) => void;
  rm: (rel: string) => void;
  commitAll: (msg: string) => void;
}

/**
 * Materialize an isolated repo+origin pair as a filesystem copy of the seeded
 * template. Deterministic content, zero git spawns per call, safe under
 * concurrent workers (every fixture gets its own directory and origin).
 */
export function gitFixture(name: string): GitFixture {
  ensureTemplate();
  const root = join(baseDir!, name);
  cpSync(templateRoot!, root, { recursive: true });
  // Private copy of the origin too: pushes inside one fixture can never leak
  // into another (the template itself is never handed out).
  cpSync(templateOrigin!, `${root}-origin.git`, { recursive: true });
  // Repoint the cloned remote at this fixture's PRIVATE origin without a git
  // spawn — .git/config is plain text and the URL is the template path.
  const cfgPath = join(root, '.git', 'config');
  writeFileSync(
    cfgPath,
    readFileSync(cfgPath, 'utf8').split(templateOrigin!).join(`${root}-origin.git`),
  );
  const g = (args: string[]) =>
    execFileSync('git', args, { cwd: root, encoding: 'utf8', env: { ...process.env, ...GIT_ENV } });
  return {
    root,
    g,
    // Point milestone-aware automation at THIS fixture while it is the
    // active fixture (attestation identity reads current-milestone.json
    // through the FORESIFT_REPO_ROOT seam, like milestone-mode.mjs).
    withMilestoneRoot: () => {
      process.env.FORESIFT_REPO_ROOT = root;
      return root;
    },
    baseSha: () => g(['rev-parse', 'HEAD']).trim(),
    writeFile: (rel: string, content: string) => {
      const p = join(root, rel);
      mkdirSync(join(p, '..'), { recursive: true });
      writeFileSync(p, content);
    },
    rm: (rel: string) => {
      execFileSync('rm', ['-f', join(root, rel)]);
    },
    commitAll: (msg: string) => {
      g(['add', '-A']);
      g(['commit', '-qm', msg]);
    },
  };
}

/** Test-support cleanup: drop the per-process template scratch dir. */
export function disposeGitFixtureBase(): void {
  if (!baseDir) return;
  rmSync(baseDir, { recursive: true, force: true });
  baseDir = null;
  templateRoot = null;
  templateOrigin = null;
}
