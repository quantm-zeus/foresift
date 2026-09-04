// Root-lockfile workspace-registration classifier for the wave guard.
// Extracted into its own module so the guard CLI (wave-guard.mjs) and the
// regression suite can both import it without executing the CLI pipeline.
import { spawnSync } from 'node:child_process';

function gitShow(cwd) {
  return (cmd) => {
    const r = spawnSync(`git ${cmd}`, { shell: true, cwd, encoding: 'utf8' });
    return { ok: r.status === 0, out: (r.stdout ?? '').trim() };
  };
}

/**
 * Root-lockfile workspace-registration carve-out (live run 8f4aaa6d,
 * 2026-09-04): a lane agent that touches an in-scope package legitimately
 * runs `pnpm install`, and pnpm then registers the workspace importer in the
 * ROOT pnpm-lock.yaml — here for a package scaffolded by EARLIER package
 * authorship (ffc3ccb) whose importer registration had never been committed.
 * The registration block is a mechanical mirror of that package's
 * package.json (specifier `workspace:*`, version `link:../<dir>`), not
 * authorship. Refusing it deterministically killed the lane at guard-serial-1
 * (WRITE-AUTHORITY VIOLATION: pnpm-lock.yaml) — the same mechanical-mirror
 * class as the root package.json fix (PR #63).
 *
 * The carve-out is fail-closed and narrow. pnpm-lock.yaml is admitted ONLY
 * when every change in base..head:
 *   1. sits inside the top-level `importers:` section (nothing else moves —
 *      lockfileVersion, settings, overrides, and package tarball metadata all
 *      remain violations);
 *   2. only ADDS importer keys (a removal or modification of existing
 *      importer content is dependency authorship, still a violation); and
 *   3. each added importer key `packages/<dir>` corresponds to a package.json
 *      that EXISTS at head, whose dependency entries the added block mirrors
 *      exactly (`specifier: workspace:*`, `version: link:../<sibling-dir>`).
 *
 * Anything else — version bumps, non-workspace specifiers, deletions,
 * out-of-section edits — keeps the violation. The guard never consults this
 * path unless pnpm-lock.yaml itself is one of the lane's changed files.
 *
 * @param {string} diffText unified diff of pnpm-lock.yaml for base..head
 * @param {string} headWorktree lane worktree at head (package.json source of truth)
 * @param {(cmd: string) => {ok: boolean, out: string}} gitFn git runner scoped to headWorktree
 * @returns {boolean} true iff the diff is pure workspace registration
 */
export function lockfileWorkspaceRegistrationOnly(diffText, headWorktree, gitFn) {
  const lines = diffText.split('\n');
  let inHunk = false;
  let currentKey = null;
  const addedBlocks = new Map(); // importer key -> { deps: {name: {specifier, version}} }
  // pnpm lockfile importer-block grammar (verified against the live diff):
  //   `  packages/<dir>:`           importer key at 2 spaces
  //   `    dependencies:`           dependency section at 4 spaces
  //   `      <name>:`               package name at 6 spaces (possibly quoted)
  //   `        specifier: <spec>`   8 spaces
  //   `        version: <ver>`      8 spaces
  const IMPORTER_KEY = /^\+ {2}(packages\/[^:]+):$/;
  const SECTION_LINE = /^\+ {4}(dependencies|devDependencies|optionalDependencies):$/;
  const DEP_LINE = /^\+ {6}'?"?([^'":]+)'?"?:$/;
  const SPECIFIER_LINE = /^\+ {8}specifier:\s*(.+)$/;
  const VERSION_LINE = /^\+ {8}version:\s*(.+)$/;
  for (const line of lines) {
    if (line.startsWith('@@')) {
      inHunk = true;
      continue;
    }
    if (!inHunk) continue;
    if (line.startsWith('-')) {
      if (line.startsWith('---')) continue;
      return false; // removals are never workspace registration
    }
    if (!line.startsWith('+') || line.startsWith('+++')) continue;
    const key = IMPORTER_KEY.exec(line);
    if (key) {
      currentKey = key[1];
      addedBlocks.set(currentKey, { deps: {}, section: null, pending: null, pendingSpec: null });
      continue;
    }
    if (currentKey == null) return false; // added content outside any importer key
    const block = addedBlocks.get(currentKey);
    const section = SECTION_LINE.exec(line);
    if (section) {
      block.section = section[1];
      continue;
    }
    if (block.section == null) return false; // anything else under the key is out of grammar
    const dep = DEP_LINE.exec(line);
    if (dep) {
      block.pending = dep[1];
      block.pendingSpec = null;
      continue;
    }
    const spec = SPECIFIER_LINE.exec(line);
    if (spec) {
      if (block.pending == null) return false;
      block.pendingSpec = spec[1];
      continue;
    }
    const version = VERSION_LINE.exec(line);
    if (version) {
      if (block.pending == null || block.pendingSpec == null) return false;
      block.deps[block.pending] = { specifier: block.pendingSpec, version: version[1] };
      block.pending = null;
      block.pendingSpec = null;
      continue;
    }
    if (line === '+') continue; // added blank separator line between importer blocks
    return false; // any other added line shape is outside the registration grammar
  }
  if (addedBlocks.size === 0) return false; // nothing registered — not this carve-out
  const git = gitFn ?? gitShow(headWorktree);
  for (const [key, block] of addedBlocks) {
    if (!key.startsWith('packages/')) return false;
    let pkgJson;
    try {
      const cat = git(`show HEAD:${key}/package.json`);
      if (!cat.ok) return false; // package.json must exist at head
      pkgJson = JSON.parse(cat.out);
    } catch {
      return false;
    }
    const declared = { ...(pkgJson.dependencies ?? {}), ...(pkgJson.devDependencies ?? {}) };
    const added = block.deps;
    if (Object.keys(added).length !== Object.keys(declared).length) return false;
    for (const [name, entry] of Object.entries(added)) {
      if (declared[name] !== entry.specifier) return false;
      const siblingDir = name.replace(/^@foresift\//, '');
      if (entry.version !== `link:../${siblingDir}`) return false;
    }
  }
  return true;
}
