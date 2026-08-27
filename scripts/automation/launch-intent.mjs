#!/usr/bin/env node
// launch-intent.mjs — Two-phase durable package launch intent protocol.
//
// HARD LAW:
//   PENDING -> RUNNING on main NEVER happens before a real Archon run exists.
//   Durable launch intent + run association prevents duplicate launches across
//   process restarts even while origin/main still says PENDING.
//
// Invariant: RUNNING implies a real durable run association.

import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';

export const LAUNCH_INTENTS_DIR_NAME = 'launch-intents';

function intentsDir(stateDir) {
  return join(stateDir, LAUNCH_INTENTS_DIR_NAME);
}

function intentFilePath(stateDir, intentId) {
  const safe = intentId.replace(/[^a-zA-Z0-9_-]/g, '_');
  return join(intentsDir(stateDir), `intent-${safe}.json`);
}

function writeIntentAtomic(stateDir, intent) {
  const dir = intentsDir(stateDir);
  mkdirSync(dir, { recursive: true });
  intent.updatedAt = new Date().toISOString();
  const target = intentFilePath(stateDir, intent.intentId);
  const tmp = `${target}.${Date.now()}.${Math.random().toString(36).slice(2, 8)}.tmp`;
  writeFileSync(tmp, JSON.stringify(intent, null, 2) + '\n');
  renameSync(tmp, target);
}

export function readIntent(stateDir, intentId) {
  try {
    return JSON.parse(readFileSync(intentFilePath(stateDir, intentId), 'utf8'));
  } catch {
    return null;
  }
}

/**
 * Phase A — Create a durable launch intent before launching Archon.
 */
export function createLaunchIntent(
  stateDir,
  { packageId, generation = 0, executionProfile = 'CODEX_AGY', workflow, branch, sourceSha },
) {
  const intentId = `${packageId}-gen${generation}-${(sourceSha ?? 'nosha').slice(0, 8)}`;
  const existing = readIntent(stateDir, intentId);
  if (existing && existing.status !== 'FAILED') {
    return existing;
  }

  const intent = {
    schema: 'foresift/launch-intent@1',
    intentId,
    packageId,
    generation,
    executionProfile,
    workflow,
    branch,
    sourceSha,
    runId: null,
    status: 'INTENT_DURABLE',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  writeIntentAtomic(stateDir, intent);
  return intent;
}

/**
 * Phase B — Associate durable Archon run ID with the launch intent.
 */
export function associateRunIdWithIntent(stateDir, intentId, runId) {
  const intent = readIntent(stateDir, intentId);
  if (!intent) {
    throw new Error(`Launch intent not found: ${intentId}`);
  }
  intent.runId = runId;
  intent.status = 'RUN_ASSOCIATED';
  writeIntentAtomic(stateDir, intent);
  return intent;
}

/**
 * Mark launch intent completed after state PR merges to main.
 */
export function markIntentComplete(stateDir, intentId, mergedSha = null) {
  const intent = readIntent(stateDir, intentId);
  if (!intent) return null;
  intent.status = 'MERGED';
  intent.mergedSha = mergedSha;
  writeIntentAtomic(stateDir, intent);
  return intent;
}

/**
 * Discover all pending (non-terminal) launch intents.
 */
export function discoverPendingLaunchIntents(stateDir) {
  const dir = intentsDir(stateDir);
  if (!existsSync(dir)) return [];
  const pending = [];
  for (const name of readdirSync(dir)) {
    if (!name.startsWith('intent-') || !name.endsWith('.json')) continue;
    try {
      const item = JSON.parse(readFileSync(join(dir, name), 'utf8'));
      if (item.status === 'INTENT_DURABLE' || item.status === 'RUN_ASSOCIATED') {
        pending.push(item);
      }
    } catch {}
  }
  pending.sort((a, b) => (b.createdAt > a.createdAt ? 1 : -1));
  return pending;
}

/**
 * Check if a package has an active launch in flight.
 */
export function isPackageLaunchInFlight(stateDir, packageId) {
  const pending = discoverPendingLaunchIntents(stateDir);
  return pending.some((i) => i.packageId === packageId);
}

/**
 * Startup recovery: reconcile pending launch intents with Archon runs.
 */
export function reconcileLaunchIntentsOnStartup(
  stateDir,
  { archonRuns = [], milestoneState = null, log = console.log } = {},
) {
  const pending = discoverPendingLaunchIntents(stateDir);
  const adopted = [];
  const dangling = [];

  for (const intent of pending) {
    if (intent.status === 'INTENT_DURABLE' && !intent.runId) {
      // Find matching run in Archon runs table
      const match = archonRuns.find(
        (r) =>
          r.workflow_name === intent.workflow &&
          (r.status === 'running' || r.status === 'pending' || r.status === 'completed'),
      );
      if (match) {
        intent.runId = match.id;
        intent.status = 'RUN_ASSOCIATED';
        writeIntentAtomic(stateDir, intent);
        adopted.push(intent);
        log(`launch-intent recovery: matched ${intent.intentId} to existing run ${match.id}`);
      } else {
        dangling.push(intent);
      }
    } else if (intent.status === 'RUN_ASSOCIATED') {
      // Check if milestone already contains RUNNING or PROVEN on main
      const pkg = milestoneState?.packages?.find((p) => p.id === intent.packageId);
      if (pkg?.status === 'RUNNING' || pkg?.status === 'PROVEN') {
        intent.status = 'MERGED';
        writeIntentAtomic(stateDir, intent);
      } else {
        adopted.push(intent);
      }
    }
  }

  return { adopted, dangling };
}
