// GENERATION SALVAGE (V3 override §§4–13): deterministic transplant of valid
// PRODUCT implementation from a retired execution's branch onto a fresh
// generation branch built from final V3 main.
//
// Execution identity and product code are different things. The retired
// generation's RUNS are dead forever; its verified PRODUCT work — packages,
// migrations, product tests, telemetry catalogs, package spec artifacts,
// product ADRs — is salvage where it still satisfies current authority.
//
// Hard rules encoded here:
//   CURRENT V3 MAIN WINS for every control-plane surface (scripts/automation,
//   .archon, CI, root tooling): old automation is classified
//   OBSOLETE_CONTROL_PLANE and NEVER restored wholesale.
//   Root manifests (package.json, lockfile, tsconfigs) are RECONCILED
//   additively onto current main, never copied over it; lock state is settled
//   by the normal package manager, never hand-copied.
//   Product paths are transplanted PATH-LEVEL from the salvage tip (strategy
//   C), which subsumes cherry-pick strategies A/B without conflict markers:
//   product paths either do not exist on main or are wholly superseded.
//   Colliding ADR numbers are renumbered forward with provenance notes.
//
// Two phases:
//   buildSalvageInventory() — read-only; produces the classification manifest.
//   applySalvage()          — mutates ONLY the new generation branch worktree;
//                             records per-file decisions and the applied head.
//
// Pure-ish core with injectable git runner for hermetic tests.

import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

export const SALVAGE_MANIFEST_SCHEMA = 'foresift/salvage-manifest@1';

/** Path prefixes owned by the CURRENT control plane — current main always wins. */
export const CONTROL_PLANE_PREFIXES = [
  'scripts/',
  '.archon/',
  '.github/',
  '.specify/',
  '.claude/',
  'ops/',
  'apps/',
  'tests/automation/',
  'tests/helpers/',
  'docs/spec/',
];

/** Path prefixes that are pure PRODUCT implementation — salvage targets. */
export const PRODUCT_PREFIXES = [
  'packages/',
  'migrations/',
  'tests/acceptance/',
  'tests/negative/',
  'tests/integration/',
  'tests/unit/',
  'tests/e2e/',
  'tests/fixtures/',
  'telemetry/',
];

/** Root-level manifests reconciled additively rather than restored. */
export const ROOT_MANIFEST_FILES = new Set([
  'package.json',
  'pnpm-lock.yaml',
  'pnpm-workspace.yaml',
  'tsconfig.json',
  'tsconfig.base.json',
  'eslint.config.js',
  'vitest.config.ts',
  'README.md',
]);

export function classifyPath(path, pkgId) {
  if (CONTROL_PLANE_PREFIXES.some((p) => path.startsWith(p))) return 'OBSOLETE_CONTROL_PLANE';
  if (PRODUCT_PREFIXES.some((p) => path.startsWith(p))) return 'REUSE_AS_IS';
  if (path === `specs/${pkgId}/` || path.startsWith(`specs/${pkgId}/`)) return 'REUSE_AS_IS'; // package spec artifacts are the task authority
  if (path.startsWith('docs/adr/')) return 'REUSE_WITH_RECONCILIATION'; // possible number collision
  if (ROOT_MANIFEST_FILES.has(path)) return 'REUSE_WITH_RECONCILIATION';
  if (path.startsWith('docs/')) return 'REUSE_WITH_RECONCILIATION';
  return 'UNKNOWN';
}

function sh(git, cwd, args) {
  const r = spawnSync(git, args, { cwd, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });
  if (r.status !== 0)
    throw new Error(
      `git ${args.join(' ')} failed (${r.status}): ${String(r.stderr).slice(0, 300)}`,
    );
  return r.stdout;
}

/**
 * Read-only inventory: classify every file delta between the FINAL V3 base and
 * the salvage tip, plus per-commit provenance for the salvage window.
 */
export function buildSalvageInventory({ repoRoot, pkgId, salvageRef, baseRef, sourceSalvagePr }) {
  const git = (...args) => sh('git', repoRoot, args);
  const salvageHead = git('rev-parse', salvageRef).trim();
  const baseHead = git('rev-parse', baseRef).trim();
  const mergeBase = git('merge-base', baseHead, salvageHead).trim();
  const range = `${mergeBase}..${salvageHead}`;

  const nameStatus = git('diff', '--name-status', range).trim();
  const files = [];
  for (const line of nameStatus.split('\n').filter(Boolean)) {
    const [status, ...rest] = line.split('\t');
    const path = rest.join('\t');
    files.push({ path, status, classification: classifyPath(path, pkgId) });
  }

  // Per-commit provenance: which salvage commits touch only product paths?
  const rawLog = git('log', '--reverse', '--format=%H%x09%s', range).trim();
  const commits = [];
  for (const line of rawLog.split('\n').filter(Boolean)) {
    const [sha, subject] = line.split('\t');
    const touched = git('diff-tree', '--no-commit-id', '--name-only', '-r', sha)
      .trim()
      .split('\n')
      .filter(Boolean);
    const classes = [...new Set(touched.map((p) => classifyPath(p, pkgId)))];
    const classification =
      classes.length === 0
        ? 'EMPTY'
        : classes.every((c) => c === 'REUSE_AS_IS')
          ? 'REUSE_AS_IS'
          : classes.includes('OBSOLETE_CONTROL_PLANE') && classes.length === 1
            ? 'OBSOLETE_CONTROL_PLANE'
            : 'REUSE_WITH_RECONCILIATION';
    commits.push({
      sha,
      subject,
      filesTouched: touched.length,
      classification,
    });
  }

  const countBy = (k) => files.filter((f) => f.classification === k).length;
  return {
    schema: SALVAGE_MANIFEST_SCHEMA,
    packageId: pkgId,
    sourceSalvagePr: sourceSalvagePr ?? null,
    sourceSalvageBranch: salvageRef,
    sourceSalvageHead: salvageHead,
    finalV3BaseHead: baseHead,
    mergeBase,
    files,
    commits,
    summary: {
      filesTotal: files.length,
      reuseAsIs: countBy('REUSE_AS_IS'),
      reuseWithReconciliation: countBy('REUSE_WITH_RECONCILIATION'),
      obsoleteControlPlane: countBy('OBSOLETE_CONTROL_PLANE'),
      unknown: countBy('UNKNOWN'),
      commitsTotal: commits.length,
      commitsFullyProduct: commits.filter((c) => c.classification === 'REUSE_AS_IS').length,
      commitsMixed: commits.filter((c) => c.classification === 'REUSE_WITH_RECONCILIATION').length,
      commitsControlPlaneOnly: commits.filter((c) => c.classification === 'OBSOLETE_CONTROL_PLANE')
        .length,
    },
  };
}

/**
 * Deterministic additive merge of a root manifest: keys/lines ABSENT from
 * current are added from salvage; anything present in both resolves to
 * CURRENT MAIN (the control plane always wins). JSON objects merge shallowly
 * per top level key with object-valued deps sections merged per dependency.
 * Returns the merged text for JSON inputs; null when no salvage delta applies.
 */
export function reconcileJsonManifest(currentText, salvageText) {
  let cur, sal;
  try {
    cur = JSON.parse(currentText);
    sal = JSON.parse(salvageText);
  } catch {
    return null;
  }
  const isObj = (v) => v && typeof v === 'object' && !Array.isArray(v);
  const mergeInto = (target, extra) => {
    for (const [k, v] of Object.entries(extra)) {
      if (!(k in target)) target[k] = v;
      else if (isObj(target[k]) && isObj(v)) {
        // Dependency maps and nested config: add only MISSING entries inside
        // the nested object — never at the manifest root.
        for (const [k2, v2] of Object.entries(v)) if (!(k2 in target[k])) target[k][k2] = v2;
      }
      // Arrays/scalars present in both: current wins (recorded by caller).
    }
    return target;
  };
  const merged = mergeInto(structuredClone(cur), sal);
  return JSON.stringify(merged, null, 2) + '\n';
}

/**
 * Renumber salvage ADRs that collide with base-main ADR filenames: shift each
 * colliding salvage ADR to the next free number and rewrite its title marker.
 * Returns the rename map {oldPath -> newPath}.
 */
export function planAdrRenames(files, baseFileSet) {
  const renames = {};
  const numOf = (p) => Number(/^docs\/adr\/(\d{4})-/.exec(p)?.[1] ?? NaN);
  // Known ADR numbers on BOTH sides: renumbering above the union is what makes
  // the new names guaranteed-collision-free (numbering only against the
  // salvage side could land a "free" number straight onto a base ADR).
  const nums = new Set();
  for (const f of files) {
    const n = numOf(f.path);
    if (!Number.isNaN(n)) nums.add(n);
  }
  for (const p of baseFileSet) {
    const n = numOf(p);
    if (!Number.isNaN(n)) nums.add(n);
  }
  const basePathNums = new Set([...baseFileSet].map(numOf).filter((n) => !Number.isNaN(n)));
  let next = (nums.size > 0 ? Math.max(...nums) : 0) + 1;
  for (const f of files.filter((x) => x.path.startsWith('docs/adr/') && x.status !== 'D')) {
    const n = numOf(f.path);
    // Identical path ⇒ base itself carries this ADR; restoring over it is the
    // intended reconciliation. Same NUMBER with a different slug is a forward
    // collision ⇒ renumber above every known number on either side.
    if (baseFileSet.has(f.path) || !basePathNums.has(n)) continue;
    // The regex match spans the 'docs/adr/<num>-' prefix, so the replacement
    // must re-emit the directory too.
    const newName = f.path.replace(
      /^docs\/adr\/\d{4}-/,
      () => 'docs/adr/' + String(next).padStart(4, '0') + '-',
    );
    renames[f.path] = newName;
    nums.add(next);
    next++;
  }
  return renames;
}

/**
 * Task reconstruction (override §10): parse the salvaged package tasks.md and
 * classify every checked task as reused only when each AC it references still
 * has locatable test evidence in the salvaged file set; otherwise REOPEN it
 * (fail closed). Returns { content, reused, reopened, remaining, details[] }.
 */
export function reconstructTasks(tasksMd, salvagedFiles) {
  const salvagedSet = new Set(salvagedFiles);
  const acTestExists = (ac) =>
    salvagedSet.has(`tests/acceptance/${ac}.spec.ts`) ||
    salvagedSet.has(`tests/negative/${ac}.negative.spec.ts`) ||
    [...salvagedSet].some((f) => f.includes(ac));
  const lines = tasksMd.split('\n');
  const details = [];
  let reused = 0;
  let reopened = 0;
  const out = lines.map((line) => {
    const m = /^(\s*-\s+)\[x\](\s+)(T\d+.*)$/.exec(line);
    if (!m) return line;
    const taskId = /^T\d+/.exec(m[3])?.[0] ?? '?';
    const acs = [...m[3].matchAll(/AC-\d+/g)].map((x) => x[0]);
    const evidenceOk =
      acs.length === 0 ? true : acs.every((ac) => acTestExists(ac.replace(/^-/, '')));
    if (evidenceOk) {
      reused++;
      details.push({ task: taskId, verdict: 'REUSED', acs });
      return line;
    }
    reopened++;
    details.push({
      task: taskId,
      verdict: 'REOPENED',
      acs,
      why: 'missing test evidence for an AC',
    });
    return `${m[1]}[ ]${m[2]}${m[3]} <!-- V3 salvage: reopened — missing test evidence for one of: ${acs.join(', ') || 'n/a'} -->`;
  });
  const remaining = out.filter((l) => /^\s*-\s+\[ \]\s+T\d+/.test(l)).length;
  return { content: out.join('\n'), reused, reopened, remaining, details };
}

/** Line-oriented union merge for pnpm-workspace.yaml `packages:` glob lists. */
export function reconcileWorkspaceYaml(currentText, salvageText) {
  const globs = (text) => {
    const out = [];
    let inList = false;
    for (const line of text.split('\n')) {
      if (/^packages:\s*$/.test(line)) {
        inList = true;
        continue;
      }
      if (inList) {
        const m = /^\s{2}-\s+(.+)$/.exec(line);
        if (m) out.push(m[1].replace(/^['"]|['"]$/g, ''));
        else inList = false;
      }
    }
    return out;
  };
  const cur = globs(currentText);
  const sal = globs(salvageText);
  const missing = sal.filter((g) => !cur.includes(g));
  if (missing.length === 0) return currentText;
  const insertAt = currentText.split('\n').findIndex((l) => /^packages:\s*$/.test(l));
  if (insertAt < 0) return null;
  const lines = currentText.split('\n');
  let at = insertAt + 1;
  while (at < lines.length && /^\s{2}-\s+/.test(lines[at])) at++;
  lines.splice(at, 0, ...missing.map((g) => `  - '${g}'`));
  return lines.join('\n');
}

/**
 * Apply phase: transplant salvaged PRODUCT work onto a fresh generation branch
 * created at baseRef inside repoRoot. The tree must be clean; the branch is
 * created (or adopted when already pointing at baseRef). Returns the applied
 * head. Never touches control-plane paths or the lockfile (the package manager
 * owns lock state).
 */
export function applySalvage({
  repoRoot,
  manifest,
  genBranch,
  baseRef,
  allowUnknown = false,
  // 'lockfile-only': settle pnpm-lock.yaml deterministically without a full
  // node_modules (the seed commit only needs lock state); 'full': complete
  // install; 'none': leave the tree untouched (tests).
  installMode = 'lockfile-only',
}) {
  const git = (...args) => sh('git', repoRoot, args);
  const dirty = git('status', '--porcelain').trim();
  if (dirty) throw new Error(`refusing to salvage onto a dirty tree:\n${dirty.slice(0, 400)}`);

  // Adopt or create the generation branch strictly AT the final V3 base.
  const headBranch = git('rev-parse', '--abbrev-ref', 'HEAD').trim();
  const baseSha = git('rev-parse', baseRef).trim();
  let branchSha;
  try {
    branchSha = git('rev-parse', genBranch).trim();
  } catch {
    branchSha = null;
  }
  if (branchSha && branchSha !== baseSha && headBranch !== genBranch)
    throw new Error(
      `generation branch ${genBranch} exists at ${branchSha.slice(0, 10)} ≠ base ${baseSha.slice(0, 10)} — refusing to guess`,
    );
  if (headBranch !== genBranch) {
    git(branchSha ? 'switch' : 'switch', ...(branchSha ? [genBranch] : ['-c', genBranch, baseSha]));
  }

  const salvageHead = manifest.sourceSalvageHead;
  const files = manifest.files.filter((f) => f.status !== 'D');
  const unknown = files.filter((f) => f.classification === 'UNKNOWN');
  if (unknown.length > 0 && !allowUnknown)
    throw new Error(
      `UNKNOWN classification for: ${unknown.map((f) => f.path).join(', ')} — inspect and reclassify (or pass allowUnknown)`,
    );

  // 1. Path-level restore of product work (strategy C subsuming A/B).
  // REUSE_WITH_RECONCILIATION root manifests and prose docs are deliberately
  // NOT restored here — they are reconciled additively below (current main
  // wins) or left alone entirely. Only pure product paths and ADRs (renamed on
  // collision) are transplanted wholesale.
  const productPaths = files
    .filter((f) => f.classification === 'REUSE_AS_IS' || f.path.startsWith('docs/adr/'))
    .map((f) => f.path);
  if (productPaths.length > 0)
    git('restore', '--source', salvageHead, '--worktree', '--staged', '--', ...productPaths);

  // 2. ADR collision renumbering (fix-forward, provenance preserved in git).
  let baseFiles = [];
  try {
    baseFiles = git('ls-tree', '-r', '--name-only', baseSha).split('\n').filter(Boolean);
  } catch {}
  const renames = planAdrRenames(files, new Set(baseFiles));
  for (const [from, to] of Object.entries(renames)) {
    git('mv', from, to);
    // Rewrite self-referential "ADR-00NN" markers inside the moved file.
    try {
      const oldNum = /^docs\/adr\/(\d{4})-/.exec(from)[1];
      const newNum = /^docs\/adr\/(\d{4})-/.exec(to)[1];
      const p = join(repoRoot, to);
      const text = readFileSync(p, 'utf8');
      writeFileSync(
        p,
        text
          .replaceAll(`ADR-${oldNum}`, `ADR-${newNum}`)
          .replaceAll(`adr-${oldNum}`, `adr-${newNum}`),
      );
      git('add', to);
    } catch {
      /* cosmetic rewrite only */
    }
  }

  // 3. Root manifests reconciled additively — CURRENT MAIN WINS everywhere.
  const manifestReconciliation = [];
  for (const name of ['package.json']) {
    const curPath = join(repoRoot, name);
    if (!existsSync(curPath)) continue;
    let salText;
    try {
      salText = sh('git', repoRoot, ['show', `${salvageHead}:${name}`]);
    } catch {
      continue;
    }
    const merged = reconcileJsonManifest(readFileSync(curPath, 'utf8'), salText);
    if (merged && merged !== readFileSync(curPath, 'utf8')) {
      writeFileSync(curPath, merged);
      manifestReconciliation.push({ file: name, decision: 'ADDITIVE_MERGE_APPLIED' });
    }
  }
  {
    const name = 'pnpm-workspace.yaml';
    const curPath = join(repoRoot, name);
    if (existsSync(curPath)) {
      let salText;
      try {
        salText = sh('git', repoRoot, ['show', `${salvageHead}:${name}`]);
      } catch {
        salText = null;
      }
      if (salText) {
        const merged = reconcileWorkspaceYaml(readFileSync(curPath, 'utf8'), salText);
        if (merged && merged !== readFileSync(curPath, 'utf8')) {
          writeFileSync(curPath, merged);
          manifestReconciliation.push({ file: name, decision: 'GLOB_UNION_APPLIED' });
        }
      }
    }
  }

  // 4. Task reconstruction against salvaged evidence (override §10).
  let taskReconstruction = null;
  const tasksRel = `specs/${manifest.packageId}/tasks.md`;
  const restoredTasks = productPaths.includes(tasksRel);
  if (restoredTasks) {
    const salvagedSet = files.filter((f) => f.classification === 'REUSE_AS_IS').map((f) => f.path);
    const rec = reconstructTasks(readFileSync(join(repoRoot, tasksRel), 'utf8'), salvagedSet);
    writeFileSync(join(repoRoot, tasksRel), rec.content);
    git('add', tasksRel);
    taskReconstruction = {
      reused: rec.reused,
      reopened: rec.reopened,
      remaining: rec.remaining,
      details: rec.details,
    };
  }

  // 5. Settle lock state through the package manager — never hand-copied.
  let install = { ran: false, mode: installMode };
  if (installMode !== 'none') {
    const args =
      installMode === 'lockfile-only'
        ? ['install', '--lockfile-only']
        : ['install', '--no-frozen-lockfile'];
    const r = spawnSync('pnpm', args, {
      cwd: repoRoot,
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
    });
    install = {
      ran: true,
      mode: installMode,
      ok: r.status === 0,
      tail: String(r.stdout ?? '').slice(-400),
    };
    if (r.status !== 0)
      throw new Error(`pnpm install failed during salvage reconciliation:\n${install.tail}`);
  }

  git('add', '-A');
  const staged = git('diff', '--cached', '--name-only').trim();
  if (staged) {
    git(
      'commit',
      '-q',
      '-m',
      `feat(salvage): transplant ${manifest.packageId} generation-0 product implementation (${manifest.sourceSalvagePr ?? manifest.sourceSalvageBranch})\n\n` +
        `Path-level salvage of verified product work from ${salvageHead.slice(0, 12)} onto final V3 main ${baseSha.slice(0, 12)}.\n` +
        `Control-plane surfaces intentionally NOT transplanted (current main wins).\n` +
        `Task reconstruction: reused=${taskReconstruction?.reused ?? 'n/a'} reopened=${taskReconstruction?.reopened ?? 'n/a'} remaining=${taskReconstruction?.remaining ?? 'n/a'}\n\n` +
        `Salvage-source: ${manifest.sourceSalvageBranch}@${salvageHead.slice(0, 12)}\n` +
        `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`,
    );
  }
  const appliedHead = git('rev-parse', 'HEAD').trim();
  return { appliedHead, renames, manifestReconciliation, taskReconstruction, install };
}

function cliMain() {
  const argv = process.argv.slice(2);
  const optOf = (flag) => {
    const i = argv.indexOf(flag);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const mode = argv[0];
  const repoRoot = optOf('--repo-root') ?? join(import.meta.dirname, '..', '..');
  if (mode === 'inventory') {
    const pkgId = optOf('--package');
    const salvageRef = optOf('--salvage-ref');
    const baseRef = optOf('--base-ref') ?? 'origin/main';
    const out = optOf('--out');
    if (!pkgId || !salvageRef || !out) {
      console.error(
        'usage: generation-salvage.mjs inventory --package <id> --salvage-ref <ref> --out <file> [--base-ref origin/main] [--pr 22] [--repo-root dir]',
      );
      process.exit(2);
    }
    const inv = buildSalvageInventory({
      repoRoot,
      pkgId,
      salvageRef,
      baseRef,
      sourceSalvagePr: optOf('--pr') ? Number(optOf('--pr')) : undefined,
    });
    writeFileSync(out, JSON.stringify(inv, null, 2) + '\n');
    console.log(JSON.stringify(inv.summary, null, 2));
    console.log(`manifest written: ${out}`);
    return;
  }
  console.error('usage: generation-salvage.mjs inventory …');
  process.exit(2);
}

const invokedDirectly = process.argv[1]?.endsWith('generation-salvage.mjs');
if (invokedDirectly) cliMain();
