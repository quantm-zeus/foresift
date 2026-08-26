#!/usr/bin/env node
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

export const BUN_MIGRATION_PROOF_SCHEMA = 'foresift/bun-migration-proof@1';
export const BUN_MIGRATION_STATES = Object.freeze([
  'CURRENT_PACKAGE',
  'BUN_MIGRATION_REQUIRED',
  'BUN_MIGRATION_RUNNING',
  'BUN_MIGRATION_PROVEN',
]);

export function validateBunMigrationProof(proof, policy) {
  const reasons = [];
  if (!proof || proof.schema !== BUN_MIGRATION_PROOF_SCHEMA) reasons.push('schema');
  if (proof?.migrationId !== policy.migrationId) reasons.push('migrationId');
  if (proof?.bunVersion !== policy.bunVersion) reasons.push('bunVersion');
  if (proof?.testAuthority !== 'BUN_TEST') reasons.push('testAuthority');
  if (!Number.isInteger(proof?.totalTestFiles) || proof.totalTestFiles < 1)
    reasons.push('totalTestFiles');
  if (proof?.verifiedFiles !== proof?.totalTestFiles) reasons.push('verifiedFiles');
  if (proof?.blockedFiles !== 0) reasons.push('blockedFiles');
  if (proof?.nestedFullExecutions !== 0) reasons.push('nestedFullExecutions');
  if (proof?.nestedFullGuard?.active !== true) reasons.push('nestedFullGuard');
  if (proof?.vitestRuntimeReferences !== 0) reasons.push('vitestRuntimeReferences');
  if (proof?.finalBunFull?.passed !== true) reasons.push('finalBunFull');
  if (proof?.nodeCompatibility?.passed !== true) reasons.push('nodeCompatibility');
  if (proof?.healthyMigrationCodexCalls !== 0) reasons.push('healthyMigrationCodexCalls');
  if (proof?.healthyMigrationClaudeCalls !== 0) reasons.push('healthyMigrationClaudeCalls');
  return { valid: reasons.length === 0, reasons };
}

export function evaluateBunMigrationBarrier({ policy, milestone, runtimeState, proof }) {
  if (!policy.migrationRequired)
    return { state: 'BUN_MIGRATION_PROVEN', reason: 'migration-not-required' };
  const proofVerdict = validateBunMigrationProof(proof, policy);
  if (proofVerdict.valid) return { state: 'BUN_MIGRATION_PROVEN', reason: 'durable-proof', proof };
  const current = milestone?.packages?.find((pkg) => pkg.id === policy.barrierAfterPackage);
  if (!current || current.status !== 'PROVEN')
    return {
      state: 'CURRENT_PACKAGE',
      reason: current ? `current-package-${current.status}` : 'current-package-missing',
    };
  if (runtimeState?.status === 'BUN_MIGRATION_RUNNING')
    return { state: 'BUN_MIGRATION_RUNNING', reason: 'tracked-maintenance-run' };
  return {
    state: 'BUN_MIGRATION_REQUIRED',
    reason: `proof-invalid:${proofVerdict.reasons.join(',')}`,
  };
}

export function loadBunMigrationInputs(root = process.cwd()) {
  const policy = JSON.parse(
    readFileSync(join(root, 'config', 'foresift-test-runtime.json'), 'utf8'),
  );
  const proofFile = join(root, 'evidence', 'bun-migration', 'bun-migration-proof.json');
  const proof = existsSync(proofFile) ? JSON.parse(readFileSync(proofFile, 'utf8')) : null;
  return { policy, proof, proofFile };
}

function cli() {
  const argv = process.argv.slice(2);
  const value = (flag) => {
    const index = argv.indexOf(flag);
    return index >= 0 ? argv[index + 1] : undefined;
  };
  const root = value('--root') ?? process.cwd();
  const { policy, proof } = loadBunMigrationInputs(root);
  const milestone = JSON.parse(readFileSync(value('--milestone'), 'utf8'));
  const runtimeState = value('--runtime-state')
    ? JSON.parse(readFileSync(value('--runtime-state'), 'utf8')).testMigration
    : null;
  process.stdout.write(
    JSON.stringify(
      evaluateBunMigrationBarrier({ policy, milestone, runtimeState, proof }),
      null,
      2,
    ) + '\n',
  );
}

if (process.argv[1]?.endsWith('bun-migration-state.mjs')) cli();
