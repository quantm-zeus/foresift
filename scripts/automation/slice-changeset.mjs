#!/usr/bin/env node
// Git-derived slice changeset (V2 task spec §6).
//
// The authoritative scope input for FAST impact analysis is GIT EVIDENCE, never
// an agent's memory of what it touched. A slice changeset is:
//
//   <slice base ref> .. HEAD        committed changes (A/M/D/R statuses)
//   + working tree                  uncommitted edits and new files
//
// Fail-closed rule: if no base ref can be established, the changeset is
// `unknown` — callers must escalate to FULL verification rather than guess.
//
// Library use:
//   import { resolveSliceChangeset } from './slice-changeset.mjs';
// CLI use (prints JSON, exit 0; exit 3 when unknown so callers fail closed):
//   node slice-changeset.mjs --repo-root <dir> [--base <ref>] [--json-file <out>]

import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';

/** Run git in repoRoot; throws on failure (callers convert to fail-closed). */
export function git(args, repoRoot) {
  return execFileSync('git', args, { cwd: repoRoot, encoding: 'utf8' });
}

/**
 * Committed + uncommitted changed paths between baseRef and the current state.
 * Returns { baseRef, headSha, files: [{path, status}], commits, unknown, reasons }.
 * status ∈ added|modified|deleted|renamed|untracked (copied → both paths listed).
 */
export function resolveSliceChangeset({ repoRoot, baseRef = null }) {
  const reasons = [];
  let headSha;
  try {
    headSha = git(['rev-parse', 'HEAD'], repoRoot).trim();
  } catch (err) {
    return {
      baseRef: null,
      headSha: null,
      files: [],
      commits: [],
      unknown: true,
      reasons: [`git rev-parse failed: ${String(err?.message ?? err).slice(0, 160)}`],
    };
  }

  // ── base resolution: explicit > merge-base with origin/main > unknown ──────
  let base = baseRef;
  if (base) {
    try {
      git(['cat-file', '-e', `${base}^{commit}`], repoRoot);
    } catch {
      reasons.push(`explicit base '${base}' is not a resolvable commit`);
      base = null;
    }
  }
  if (!base) {
    try {
      base = git(['merge-base', 'HEAD', 'origin/main'], repoRoot).trim();
    } catch {
      reasons.push('no resolvable merge-base with origin/main');
    }
  }
  if (!base) {
    return { baseRef: null, headSha, files: [], commits: [], unknown: true, reasons };
  }

  const files = new Map(); // path -> {path, status}
  const add = (path, status) => {
    if (!path) return;
    const prev = files.get(path);
    // Deletion wins over earlier modification of the same path within a range.
    if (!prev || prev.status !== 'deleted') files.set(path, { path, status });
    else if (status === 'added') files.set(path, { path, status: 'modified' });
  };

  // ── committed changes base..HEAD (two-dot: slices are same-branch ranges) ──
  let raw;
  try {
    raw = git(['diff', '--name-status', '-z', `${base}..HEAD`], repoRoot);
  } catch (err) {
    reasons.push(`git diff failed: ${String(err?.message ?? err).slice(0, 160)}`);
    return { baseRef: base, headSha, files: [], commits: [], unknown: true, reasons };
  }
  for (const entry of parseNameStatus(raw)) add(entry.path, entry.status);

  // ── uncommitted working-tree state (continuation from interrupted slices) ──
  try {
    const st = git(['status', '--porcelain', '-z', '--untracked-files=all'], repoRoot);
    for (const entry of parsePorcelain(st)) add(entry.path, entry.status);
  } catch (err) {
    reasons.push(`git status failed: ${String(err?.message ?? err).slice(0, 160)}`);
    return { baseRef: base, headSha, files: [], commits: [], unknown: true, reasons };
  }

  // ── commits in range (observability only — never used for classification) ──
  let commits = [];
  try {
    commits = git(['log', '--no-decorate', '--format=%H %s', `${base}..HEAD`], repoRoot)
      .trim()
      .split('\n')
      .filter(Boolean);
  } catch {
    commits = [];
  }

  return {
    baseRef: base,
    headSha,
    files: [...files.values()].sort((a, b) => (a.path < b.path ? -1 : 1)),
    commits,
    unknown: false,
    reasons,
  };
}

/** Parse `git diff --name-status -z` output into {path,status} pairs. */
export function parseNameStatus(raw) {
  const out = [];
  const fields = raw.split('\0');
  for (let i = 0; i < fields.length;) {
    const st = fields[i++];
    if (!st) continue;
    const code = st[0];
    if (code === 'R' || code === 'C') {
      const from = fields[i++];
      const to = fields[i++];
      if (code === 'R') {
        out.push({ path: from, status: 'deleted' }, { path: to, status: 'added' });
      } else {
        out.push({ path: to, status: 'added' });
      }
    } else {
      const p = fields[i++];
      if (p == null) break;
      const status = code === 'A' ? 'added' : code === 'D' ? 'deleted' : 'modified';
      out.push({ path: p, status });
    }
  }
  return out.filter((e) => e.path);
}

/** Parse `git status --porcelain -z --untracked-files=all`. */
export function parsePorcelain(raw) {
  const out = [];
  const fields = raw.split('\0');
  for (let i = 0; i < fields.length;) {
    const rec = fields[i++];
    if (!rec) continue;
    const xy = rec.slice(0, 2);
    // Empirically verified against git: porcelain -z renames are "XY to\0from",
    // while diff --name-status -z renames are "status\0from\0to".
    const to = rec.slice(3);
    if (xy.includes('R') || xy.includes('C')) {
      const from = fields[i++];
      if (xy.includes('R'))
        out.push({ path: from, status: 'deleted' }, { path: to, status: 'added' });
      else out.push({ path: to, status: 'added' });
      continue;
    }
    if (xy === '??') out.push({ path: to, status: 'untracked' });
    else if (xy.includes('D')) out.push({ path: to, status: 'deleted' });
    else if (xy.includes('A')) out.push({ path: to, status: 'added' });
    else out.push({ path: to, status: 'modified' });
  }
  return out.filter((e) => e.path);
}

function main() {
  const a = { repoRoot: process.cwd() };
  for (let i = 2; i < process.argv.length; i++) {
    if (process.argv[i] === '--repo-root') a.repoRoot = process.argv[++i];
    else if (process.argv[i] === '--base') a.base = process.argv[++i];
    else if (process.argv[i] === '--json-file') a.jsonFile = process.argv[++i];
  }
  const cs = resolveSliceChangeset(a);
  if (a.jsonFile) writeFileSync(a.jsonFile, JSON.stringify(cs, null, 2) + '\n');
  console.log(JSON.stringify(cs));
  process.exit(cs.unknown ? 3 : 0);
}

const invokedDirectly = process.argv[1]?.endsWith('slice-changeset.mjs');
if (invokedDirectly) main();
