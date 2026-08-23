#!/usr/bin/env node
// SEEDED-GENERATION ADOPTION (V3 override §§11–15) — first deterministic node
// of the optimized work-package workflow.
//
// Probe-proven archon reality (2026-08-23, foresift-smoke-gen-adoption):
// `archon workflow run --branch <b>` creates a FRESH worktree on a new
// `archon/task-<b>` branch pinned at MAIN's tip and NEVER consults a pushed
// branch of that name. A salvage-seeded `foresift/<id>-g<N>` would therefore
// be silently invisible to the execution while every identity surface still
// claimed to carry it.
//
// This node closes that gap BEFORE any AI spend:
//   generation 0 (bare `<id>` message)  → no-op (legacy lane unchanged)
//   generation ≥1 (`<id>@g<N>` message) → if origin carries the seeded
//       `foresift/<id>-g<N>`:
//         - refuse fail-closed unless it CONTAINS current origin/main
//           (a seed older than main must reconcile first — ADR-0010 semantics);
//         - refuse fail-closed when ancestry is unverifiable (shallow checkout);
//         - require a clean worktree (archon fresh state — never clobber work);
//         - ADOPT it: `git checkout -B <expected> <sha>` so the execution
//           branch, later pushes, PR head, and landing all carry the real
//           §6 generation identity instead of archon/task-*.
//   no seeded branch → legitimate fresh start from main: exit 0, adopted:false.
//
// Deterministic, idempotent, zero AI. Exit codes: 0 ok · 1 refused · 2 usage.

import { spawnSync } from 'node:child_process';
import { parseGenerationMessage, generationBranch } from './package-generations.mjs';
import { isAncestorSha, isShallowCheckout } from './base-drift.mjs';

export const ADOPTION_SCHEMA = 'foresift/generation-adoption@1';

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
export function adoptGenerationBranch({ message, repoRoot = process.cwd(), run = null }) {
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
  const expected = generationBranch(parsed.packageId, parsed.generation);

  // Generation 0 keeps the historical lane: archon derives its own worktree
  // from main and nothing needs adopting.
  if (parsed.generation === 0) {
    return {
      schema: ADOPTION_SCHEMA,
      adopted: false,
      mode: 'LEGACY_GEN0',
      branch: null,
      head: null,
    };
  }

  // Resolve the seeded tip on origin (fetch failure ⇒ unverifiable ⇒ refuse).
  const fetchSeed = g('fetch', 'origin', expected);
  if (fetchSeed.status !== 0) {
    // Absent on the REMOTE is the legitimate fresh-start shape; distinguish it
    // from a broken fetch by asking for the ref explicitly after a full fetch.
    const list = g('ls-remote', 'origin', `refs/heads/${expected}`);
    if (list.status !== 0)
      return failRefused(
        `cannot verify presence of ${expected} on origin: ${list.err.split('\n')[0]}`,
      );
    if (!list.out.trim())
      return {
        schema: ADOPTION_SCHEMA,
        adopted: false,
        mode: 'FRESH_FROM_MAIN',
        branch: expected,
        head: null,
      };
    return failRefused(
      `fetch of ${expected} failed but the ref exists on origin: ${fetchSeed.err.split('\n')[0]}`,
    );
  }
  const seedSha = g('rev-parse', 'FETCH_HEAD').out.trim();
  if (!/^[0-9a-f]{40}$/.test(seedSha))
    return failRefused(`fetched ${expected} did not resolve to a sha`);

  // The seed must CARRY current origin/main (ADR-0010): a stale seed would
  // execute product code never validated against the world it joins.
  if (g('fetch', 'origin', 'main').status !== 0)
    return failRefused(
      'origin/main could not be fetched — cannot prove the seed carries current main',
    );
  const mainSha = g('rev-parse', 'FETCH_HEAD').out.trim();
  const contains = isAncestorSha(
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
    seedSha,
  );
  if (
    contains === null &&
    isShallowCheckout((...args) => {
      const r = g(...args);
      return r.status === 0 ? r.out : '';
    })
  )
    return failRefused(
      `shallow checkout cannot verify whether the ${expected} seed carries current main — run from a full clone/worktree`,
    );
  if (contains !== true)
    return failRefused(
      `seeded ${expected} (${seedSha.slice(0, 10)}) does not contain current origin/main (${mainSha.slice(0, 10)}) — reconcile first (merge updated origin/main into the seed, normal merge commit ⇒ fresh FULL gate), then relaunch`,
    );

  // Never clobber uncommitted work: adoption happens only on archon's fresh
  // pristine state.
  const dirty = g('status', '--porcelain');
  if (dirty.status !== 0) return failRefused('worktree status unreadable');
  if (dirty.out.trim())
    return failRefused('worktree is dirty — refusing to rebase adoption over uncommitted changes');

  const checkout = g('checkout', '-B', expected, seedSha);
  if (checkout.status !== 0)
    return failRefused(`adoption checkout failed: ${checkout.err.split('\n')[0]}`);
  const head = g('rev-parse', 'HEAD').out.trim();
  return {
    schema: ADOPTION_SCHEMA,
    adopted: true,
    mode: 'ADOPTED_SEED',
    branch: expected,
    head,
  };
}

function cliMain() {
  const a = parseArgs(process.argv.slice(2));
  if (!a.message) {
    console.error(
      'usage: adopt-generation-branch.mjs --message "<package-id>[@g<N>]" [--repo-root dir]',
    );
    process.exit(2);
  }
  const verdict = adoptGenerationBranch({ message: a.message, repoRoot: a.repoRoot });
  console.log(JSON.stringify(verdict, null, 2));
  if (verdict.mode === 'REFUSED') process.exit(1);
}

const invokedDirectly = process.argv[1]?.endsWith('adopt-generation-branch.mjs');
if (invokedDirectly) cliMain();
