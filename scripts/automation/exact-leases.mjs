// Global exact-file lease manager (Hyperdrive H2, mission §41/§73).
//
// Packages declare writeScopes (package globs); lanes and tasks may declare
// narrower exact writes. When two packages co-run, whole-package
// serialization is justified ONLY by a real shared file. This module turns
// "shared surface" from a package-level veto into a per-file lease:
//
//   AVAILABLE → RESERVED → LEASED → RELEASED
//                    ↘ CONFLICT (two reservations on one exact file)
//
// Durable identity: leases persist as JSON under the autopilot state dir so
// a supervisor restart cannot double-lease a file that a live writer holds.
// Every mutation is idempotent on (leaseId, holder) and fail-closed: an
// unknown/empty exact write set reserves the WHOLE scope intersection as a
// conservative broader lease (mission §41: unknown ⇒ fail closed).
//
// Zero AI: leases are computed, checked, and released deterministically.

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { randomUUID } from 'node:crypto';

export const LEASE_SCHEMA = 'foresift/exact-lease@1';
export const LEASE_STATES = Object.freeze({
  AVAILABLE: 'AVAILABLE',
  RESERVED: 'RESERVED',
  LEASED: 'LEASED',
  RELEASED: 'RELEASED',
  CONFLICT: 'CONFLICT',
});

// Surfaces whose single-file contention serializes co-runners regardless of
// lease granularity (mirrors declaresRootSharedSurface in schema.mjs).
export const SHARED_SURFACE_FILES = Object.freeze([
  'package.json',
  'pnpm-lock.yaml',
  'pnpm-workspace.yaml',
  'tsconfig.json',
  'tsconfig.base.json',
  '.github/workflows/ci.yml',
  'specs/implementation/current-milestone.json',
  'specs/implementation/roadmap.json',
  'evidence/bun-migration/bun-migration-manifest.json',
]);

function invariant(condition, code, detail = '') {
  if (!condition) throw new Error(`${code}${detail ? `: ${detail}` : ''}`);
}

function leaseFilePath(stateDir) {
  return join(stateDir, 'exact-leases', 'leases.json');
}

export function computeContentSha256Fast(content) {
  // Deterministic non-crypto content digest for idempotent lease identity —
  // NOT a security hash; collisions only ever delay a launch, never corrupt.
  let h = 2166136261;
  for (let i = 0; i < content.length; i++) {
    h ^= content.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

function loadLeases(stateDir) {
  const file = leaseFilePath(stateDir);
  if (!existsSync(file)) return { schema: LEASE_SCHEMA, leases: [] };
  const parsed = JSON.parse(readFileSync(file, 'utf8'));
  invariant(parsed.schema === LEASE_SCHEMA, 'INVALID_LEASE_SCHEMA', file);
  return parsed;
}

function saveLeases(stateDir, doc) {
  const file = leaseFilePath(stateDir);
  mkdirSync(dirname(file), { recursive: true });
  const tmp = `${file}.tmp-${process.pid}`;
  writeFileSync(tmp, JSON.stringify(doc, null, 2) + '\n');
  renameSync(tmp, file);
}

export function normalizeExactFiles(input, { scopeFallback = [] } = {}) {
  invariant(Array.isArray(input), 'INVALID_EXACT_FILES');
  const files = input.map((f) => String(f).trim()).filter(Boolean);
  if (files.length === 0) {
    // Unknown exact write set ⇒ conservative broader lease over the scopes.
    for (const scope of scopeFallback) files.push(`scope:${scope}`);
    invariant(files.length > 0, 'UNKNOWN_WRITE_SET_NO_SCOPE_FALLBACK');
  }
  return [...new Set(files)].sort();
}

/**
 * Acquire leases for `holder` (packageId or packageId:laneId) over exact
 * files. Returns { ok, granted, conflicts } — ok:false leaves state untouched.
 * Shared-surface files always lease as one whole file (single holder max).
 */
export function acquireLeases(
  stateDir,
  holder,
  exactFiles,
  { baseSha = null, scopeFallback = [] } = {},
) {
  invariant(holder && typeof holder === 'string', 'INVALID_LEASE_HOLDER');
  const files = normalizeExactFiles(exactFiles, { scopeFallback });
  const doc = loadLeases(stateDir);
  const active = doc.leases.filter((l) =>
    [LEASE_STATES.RESERVED, LEASE_STATES.LEASED].includes(l.state),
  );
  const conflicts = [];
  for (const file of files) {
    const holderLease = active.find((l) => l.file === file && l.holder === holder);
    if (holderLease) continue; // idempotent re-acquire
    const shared = SHARED_SURFACE_FILES.includes(file) || file.startsWith('scope:');
    for (const l of active) {
      const blocked =
        l.file === file ||
        (shared && (l.file.startsWith('scope:') || SHARED_SURFACE_FILES.includes(l.file)));
      if (blocked) conflicts.push({ file, heldBy: l.holder, state: l.state });
    }
    if (conflicts.length) break; // fail closed, no partial grants
  }
  if (conflicts.length) {
    return { ok: false, granted: [], conflicts };
  }
  const granted = [];
  for (const file of files) {
    const existing = doc.leases.find((l) => l.file === file && l.holder === holder);
    if (existing && existing.state === LEASE_STATES.LEASED) {
      granted.push(existing);
      continue;
    }
    const lease = existing ?? {
      schema: LEASE_SCHEMA,
      leaseId: randomUUID(),
      file,
      holder,
      state: LEASE_STATES.AVAILABLE,
      baseSha,
      createdAt: new Date().toISOString(),
      acquiredAt: null,
      releasedAt: null,
    };
    lease.state = LEASE_STATES.LEASED;
    lease.baseSha = baseSha ?? lease.baseSha;
    lease.acquiredAt = new Date().toISOString();
    lease.releasedAt = null;
    if (!existing) doc.leases.push(lease);
    granted.push(lease);
  }
  saveLeases(stateDir, doc);
  return { ok: true, granted, conflicts: [] };
}

/** Mark leases RESERVED (prewarming: prepared but no writer permit yet). */
export function reserveLeases(
  stateDir,
  holder,
  exactFiles,
  { baseSha = null, scopeFallback = [] } = {},
) {
  const files = normalizeExactFiles(exactFiles, { scopeFallback });
  const doc = loadLeases(stateDir);
  const active = doc.leases.filter((l) =>
    [LEASE_STATES.RESERVED, LEASE_STATES.LEASED].includes(l.state),
  );
  const conflicts = [];
  for (const file of files) {
    for (const l of active) {
      if (l.file === file && l.holder !== holder)
        conflicts.push({ file, heldBy: l.holder, state: l.state });
    }
  }
  if (conflicts.length) return { ok: false, reserved: [], conflicts };
  const reserved = [];
  for (const file of files) {
    let lease = doc.leases.find((l) => l.file === file && l.holder === holder);
    if (!lease) {
      lease = {
        schema: LEASE_SCHEMA,
        leaseId: randomUUID(),
        file,
        holder,
        state: LEASE_STATES.AVAILABLE,
        baseSha,
        createdAt: new Date().toISOString(),
        acquiredAt: null,
        releasedAt: null,
      };
      doc.leases.push(lease);
    }
    if (lease.state !== LEASE_STATES.LEASED) lease.state = LEASE_STATES.RESERVED;
    reserved.push(lease);
  }
  saveLeases(stateDir, doc);
  return { ok: true, reserved, conflicts: [] };
}

/** Release every lease held by `holder` (idempotent, all states). */
export function releaseLeases(stateDir, holder, { reason = null } = {}) {
  const doc = loadLeases(stateDir);
  let released = 0;
  for (const lease of doc.leases) {
    if (lease.holder === holder && lease.state !== LEASE_STATES.RELEASED) {
      lease.state = LEASE_STATES.RELEASED;
      lease.releasedAt = new Date().toISOString();
      lease.releaseReason = reason;
      released += 1;
    }
  }
  saveLeases(stateDir, doc);
  return { released };
}

/** Live lease snapshot for observability + supervisor gating. */
export function activeLeases(stateDir) {
  const doc = loadLeases(stateDir);
  return doc.leases.filter((l) => [LEASE_STATES.RESERVED, LEASE_STATES.LEASED].includes(l.state));
}

/**
 * Co-run gate refinement: given two packages' exact write sets, return the
 * precise conflict surface — empty when disjoint. Used by canStartPackage to
 * narrow "writeScopes overlap" from a package-wide veto to per-file truth.
 */
export function exactConflictSurface(filesA, filesB) {
  const a = new Set(normalizeExactFiles(filesA));
  return normalizeExactFiles(filesB).filter((f) => a.has(f));
}
