// WAVE BRANCH ADOPTION (post-planning throughput gap / continuation law).
//
// Probe-proven archon reality (adopt-generation-branch.mjs): every Archon run
// worktree starts FRESH AT MAIN's tip on a throwaway `archon/task-*` branch
// and never consults the launched `--branch`. The sharded wave pins its
// integration base with `git rev-parse HEAD`, so a package whose implementation
// baseline lives on the pushed package branch (planning handoff, operator
// transition, any resumed wave) would otherwise be re-implemented from main,
// duplicating landed work and diverging from the authoritative tasks.md
// checkbox state.
//
// This node runs BEFORE prep and closes that gap deterministically, zero AI:
//
//   resolve the launch identity branch from the message
//     (`<id>` → foresift/<id>, `<id>@g<N>` → foresift/<id>-g<N>);
//   origin lacks that ref            → FRESH_FROM_MAIN no-op (today's shape);
//   origin has it                    → require pristine worktree (never
//                                      clobber uncommitted work), then
//                                      `git checkout -B <branch> <sha>`;
//   branch behind current origin/main → absorb main FIRST (merge --no-ff,
//                                      ADR-0010 seed semantics — executing
//                                      product code must carry the world it
//                                      joins) and push the merged tip back;
//                                      conflict or push failure ⇒ REFUSED
//                                      (fail-closed; supervisor recovery
//                                      replays cleanly because checkout -B
//                                      discards the discarded merge attempt).
//
// Deterministic, idempotent, generation-aware. Exit codes: 0 ok · 1 refused ·
// 2 usage. The verdict JSON is written by the caller into $ARTIFACTS_DIR for
// forensics (detached-run logs do not carry bash stderr).

import { spawnSync } from 'node:child_process';
import { parseGenerationMessage, generationBranch } from './package-generations.mjs';
import { isAncestorSha, isShallowCheckout } from './base-drift.mjs';

export const ADOPTION_SCHEMA = 'foresift/wave-branch-adoption@1';

function git(cwd, ...args) {
  return spawnSync('git', args, { encoding: 'utf8', cwd, maxBuffer: 16 * 1024 * 1024 });
}

function parseArgs(argv) {
  const a = {};
  for (let i = 0; i < argv.length; i++) {
    switch (argv[i]) {
      case '--message':
        a.message = argv[++i];
        break;
      case '--repo-root':
        a.repoRoot = argv[++i];
        break;
    }
  }
  return a;
}

/**
 * Pure-ish core with an injectable runner for hermetic tests.
 * @returns {{schema:string, adopted:boolean, mode:string, branch:string|null,
 *            head:string|null, detail?:string}}
 */
export function waveAdoptLaunchBranch({ message, repoRoot = process.cwd(), run = null }) {
  const g = (...args) => {
    const r = run ? run(args) : git(repoRoot, ...args);
    return {
      status: r.status ?? r.status,
      out: String(r.stdout ?? ''),
      err: String(r.stderr ?? ''),
    };
  };
  const failRefused = (detail) => ({
    schema: ADOPTION_SCHEMA,
    adopted: false,
    mode: 'REFUSED',
    branch: null,
    head: null,
    detail,
  });

  const parsed = parseGenerationMessage(message ?? '');
  if (!parsed) return failRefused(`unparseable launch message: ${JSON.stringify(message)}`);
  const branch = generationBranch(parsed.packageId, parsed.generation);

  // Resolve the branch tip on origin (fetch failure ⇒ unverifiable ⇒ refuse;
  // absent on the REMOTE is the legitimate fresh-start shape).
  const fetchBranch = g('fetch', 'origin', branch);
  if (fetchBranch.status !== 0) {
    const list = g('ls-remote', 'origin', `refs/heads/${branch}`);
    if (list.status !== 0)
      return failRefused(
        `cannot verify presence of ${branch} on origin: ${list.err.split('\n')[0]}`,
      );
    if (!list.out.trim())
      return {
        schema: ADOPTION_SCHEMA,
        adopted: false,
        mode: 'FRESH_FROM_MAIN',
        branch,
        head: null,
      };
    return failRefused(
      `fetch of ${branch} failed but the ref exists on origin: ${fetchBranch.err.split('\n')[0]}`,
    );
  }
  const branchSha = g('rev-parse', 'FETCH_HEAD').out.trim();
  if (!/^[0-9a-f]{40}$/.test(branchSha))
    return failRefused(`fetched ${branch} did not resolve to a sha`);

  // Never clobber uncommitted work: adoption happens only on a pristine tree
  // (archon fresh state, or post-reset state guaranteed by the supervisor's
  // unpushed-commits guard).
  const dirty = g('status', '--porcelain');
  if (dirty.status !== 0) return failRefused('worktree status unreadable');
  if (dirty.out.trim()) {
    const manifest = dirty.out.trim().split('\n').slice(0, 20).join(' | ');
    return failRefused(
      `worktree is dirty — refusing to adopt over uncommitted changes (${manifest})`,
    );
  }

  const checkout = g('checkout', '-B', branch, branchSha);
  if (checkout.status !== 0)
    return failRefused(`adoption checkout failed: ${checkout.err.split('\n')[0]}`);

  // The execution must CARRY current origin/main (ADR-0010): absorb it first
  // when the branch is stale, exactly like the generation-seed reconciliation.
  if (g('fetch', 'origin', 'main').status !== 0)
    return failRefused('origin/main could not be fetched — cannot prove branch freshness');
  const mainSha = g('rev-parse', 'FETCH_HEAD').out.trim();
  if (!/^[0-9a-f]{40}$/.test(mainSha)) return failRefused('origin/main did not resolve to a sha');
  let contains = null;
  try {
    contains =
      isAncestorSha(
        (...args) => {
          const r = g(...args);
          if (r.status !== 0) {
            const e = new Error(r.err.split('\n')[0] || `git ${args.join(' ')} failed`);
            e.status = r.status;
            throw e;
          }
          return r.out;
        },
        mainSha,
        branchSha,
      ) ?? null;
  } catch {
    contains = null;
  }
  if (
    contains === null &&
    isShallowCheckout((...args) => {
      const r = g(...args);
      return r.status === 0 ? r.out : '';
    })
  )
    return failRefused(
      `shallow checkout cannot verify whether ${branch} carries current origin/main — run from a full clone/worktree`,
    );

  if (contains !== true) {
    const merge = g(
      'merge',
      '--no-ff',
      'origin/main',
      '-m',
      `chore(wave-adoption): absorb updated main into ${branch}`,
    );
    if (merge.status !== 0) {
      g('merge', '--abort');
      return failRefused(
        `${branch} (${branchSha.slice(0, 10)}) does not contain current origin/main (${mainSha.slice(0, 10)}) and absorbing it failed: ${(merge.err || merge.out || '').split('\n').filter(Boolean)[0] ?? 'merge failed'}`,
      );
    }
    const push = g('push', '-q', 'origin', branch);
    if (push.status !== 0) {
      // Leave the LOCAL merged state in place? No: stay at the pushed-lineage
      // contract — reset to the adopted sha so a replay starts identical.
      g('reset', '--hard', branchSha);
      return failRefused(
        `absorbed origin/main but pushing ${branch} failed: ${(push.err || '').split('\n')[0]}`,
      );
    }
    const head = g('rev-parse', 'HEAD').out.trim();
    return {
      schema: ADOPTION_SCHEMA,
      adopted: true,
      mode: 'ADOPTED_WITH_MAIN_ABSORBED',
      branch,
      head,
      mergedMain: mainSha.slice(0, 10),
    };
  }

  const head = g('rev-parse', 'HEAD').out.trim();
  return { schema: ADOPTION_SCHEMA, adopted: true, mode: 'ADOPTED_SEED', branch, head };
}

function cliMain() {
  const a = parseArgs(process.argv.slice(2));
  if (!a.message) {
    console.error(
      'usage: wave-branch-adoption.mjs --message "<package-id>[@g<N>]" [--repo-root dir]',
    );
    process.exit(2);
  }
  const verdict = waveAdoptLaunchBranch({ message: a.message, repoRoot: a.repoRoot });
  console.log(JSON.stringify(verdict, null, 2));
  if (verdict.mode === 'REFUSED') process.exit(1);
}

const invokedDirectly = process.argv[1]?.endsWith('wave-branch-adoption.mjs');
if (invokedDirectly) cliMain();
