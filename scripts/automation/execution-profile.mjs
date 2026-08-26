import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const POLICY_FILE = join(HERE, '..', '..', 'config', 'foresift-execution.json');

export const EXECUTION_IDENTITY_SCHEMA = 'foresift/execution-identity@1';
export const HISTORICAL_EXECUTION_SCHEMA = 'foresift/historical-execution@1';
export const EXECUTION_POLICY = Object.freeze(JSON.parse(readFileSync(POLICY_FILE, 'utf8')));
export const DEFAULT_EXECUTION_PROFILE = EXECUTION_POLICY.defaultProfile;
export const SUPPORTED_EXECUTION_PROFILES = Object.freeze([...EXECUTION_POLICY.supportedProfiles]);
export const TEST_BASELINE_CLASSIFICATIONS = Object.freeze([
  'NEW_BEHAVIOR_RED',
  'REGRESSION_RED',
  'NEGATIVE_RED',
  'CHARACTERIZATION_GREEN',
  'REFACTOR_GUARD_GREEN',
]);

function invariant(condition, code, detail = '') {
  if (!condition) throw new Error(`${code}${detail ? `: ${detail}` : ''}`);
}

export function resolveExecutionProfile(input) {
  if (input === undefined) input = {};
  if (typeof input === 'string') input = { override: input };
  invariant(input && typeof input === 'object', 'INVALID_EXECUTION_PROFILE', String(input));
  const hasExplicit = Object.hasOwn(input, 'override') || Object.hasOwn(input, 'executionProfile');
  const env = input.env ?? process.env;
  const hasEnvironment = Object.hasOwn(env, 'FORESIFT_EXECUTION_PROFILE');
  const selected = hasExplicit
    ? (input.override ?? input.executionProfile)
    : hasEnvironment
      ? env.FORESIFT_EXECUTION_PROFILE
      : DEFAULT_EXECUTION_PROFILE;
  invariant(
    SUPPORTED_EXECUTION_PROFILES.includes(selected),
    'INVALID_EXECUTION_PROFILE',
    String(selected),
  );
  return selected;
}

export function implementationEngineForProfile(profile) {
  invariant(SUPPORTED_EXECUTION_PROFILES.includes(profile), 'INVALID_EXECUTION_PROFILE', profile);
  return profile === 'CODEX_AGY' ? 'CODEX' : 'CLAUDE';
}

export function testEngineForProfile(profile) {
  invariant(SUPPORTED_EXECUTION_PROFILES.includes(profile), 'INVALID_EXECUTION_PROFILE', profile);
  return 'AGY';
}

function normalizedLane(lane) {
  invariant(lane && typeof lane === 'object', 'INVALID_EXECUTION_LANE');
  invariant(typeof lane.lane === 'string' && lane.lane, 'INVALID_EXECUTION_LANE', 'lane');
  invariant(Array.isArray(lane.taskIds), 'INVALID_EXECUTION_LANE', `${lane.lane}.taskIds`);
  invariant(typeof lane.engine === 'string' && lane.engine, 'INVALID_EXECUTION_LANE', 'engine');
  if (lane.engine === 'CODEX') {
    invariant(typeof lane.model === 'string' && lane.model, 'INVALID_CODEX_ROUTE', 'model');
    invariant(
      typeof lane.reasoning === 'string' && lane.reasoning,
      'INVALID_CODEX_ROUTE',
      'reasoning',
    );
    invariant(lane.serviceTier === 'standard', 'INVALID_CODEX_SERVICE_TIER');
  }
  return {
    lane: lane.lane,
    role: lane.role ?? 'implementation',
    taskIds: [...lane.taskIds],
    engine: lane.engine,
    complexityTier: lane.complexityTier ?? null,
    model: lane.model ?? null,
    reasoning: lane.reasoning ?? null,
    serviceTier: lane.serviceTier ?? null,
  };
}

export function createExecutionIdentity(input) {
  const profile = resolveExecutionProfile({ override: input?.executionProfile, env: {} });
  for (const field of ['packageId', 'workflow', 'baseHead'])
    invariant(
      typeof input?.[field] === 'string' && input[field],
      'INVALID_EXECUTION_IDENTITY',
      field,
    );
  invariant(
    Number.isInteger(input?.generation) && input.generation >= 0,
    'INVALID_EXECUTION_IDENTITY',
    'generation',
  );
  const implementationEngine = implementationEngineForProfile(profile);
  const testEngine = testEngineForProfile(profile);
  const laneInputs = Array.isArray(input.lanes)
    ? input.lanes
    : Object.entries(input.lanes ?? {}).map(([lane, route]) => ({
        lane,
        role: 'implementation',
        taskIds: route.taskIds ?? [],
        engine: implementationEngine,
        ...route,
      }));
  const lanes = laneInputs.map(normalizedLane);
  for (const lane of lanes) {
    if (lane.role === 'implementation')
      invariant(lane.engine === implementationEngine, 'PROFILE_ENGINE_MISMATCH', lane.lane);
    if (lane.role === 'test')
      invariant(lane.engine === testEngine, 'PROFILE_ENGINE_MISMATCH', lane.lane);
  }
  return {
    schema: EXECUTION_IDENTITY_SCHEMA,
    packageId: input.packageId,
    generation: input.generation,
    workflow: input.workflow,
    executionProfile: profile,
    baseHead: input.baseHead,
    implementationEngine,
    testEngine,
    routingPolicyVersion: input.routingPolicyVersion ?? EXECUTION_POLICY.routingPolicyVersion,
    lanes,
    createdAt: input.createdAt ?? new Date().toISOString(),
  };
}

function immutableView(identity) {
  const { createdAt, ...immutable } = identity;
  return immutable;
}

export function loadExecutionIdentity(file) {
  invariant(existsSync(file), 'EXECUTION_IDENTITY_MISSING', file);
  const parsed = JSON.parse(readFileSync(file, 'utf8'));
  invariant(parsed.schema === EXECUTION_IDENTITY_SCHEMA, 'INVALID_EXECUTION_IDENTITY_SCHEMA');
  return parsed;
}

export function persistExecutionIdentity(file, input) {
  const proposed =
    input?.schema === EXECUTION_IDENTITY_SCHEMA ? input : createExecutionIdentity(input);
  if (existsSync(file)) {
    const current = loadExecutionIdentity(file);
    invariant(
      JSON.stringify(immutableView(current)) === JSON.stringify(immutableView(proposed)),
      'EXECUTION_IDENTITY_IMMUTABLE',
    );
    return current;
  }
  mkdirSync(dirname(file), { recursive: true });
  const tmp = `${file}.tmp-${process.pid}`;
  writeFileSync(tmp, JSON.stringify(proposed, null, 2) + '\n');
  renameSync(tmp, file);
  return proposed;
}

export function recoverExecutionIdentity(file, input = {}) {
  if (!existsSync(file))
    return Object.freeze({
      schema: HISTORICAL_EXECUTION_SCHEMA,
      historical: true,
      packageId: input.packageId ?? null,
      generation: input.generation ?? null,
      baseHead: input.baseHead ?? null,
      executionProfile: 'HISTORICAL_V4',
      implementationEngine: 'PERSISTED_HISTORICAL',
      testEngine: 'PERSISTED_HISTORICAL',
    });
  const current = loadExecutionIdentity(file);
  return current;
}

export function requireAgyForTests({ testBearing, hasAgy }) {
  if (testBearing && !hasAgy) throw new Error('AGY_UNAVAILABLE_TEST_BEARING_WORK');
  return { required: Boolean(testBearing), engine: testBearing ? 'AGY' : null };
}

export function createTestDispute(input) {
  for (const field of ['testPath', 'assertion', 'requirement', 'reason'])
    invariant(typeof input?.[field] === 'string' && input[field], 'INVALID_TEST_DISPUTE', field);
  return Object.freeze({
    schema: 'foresift/test-dispute@1',
    testPath: input.testPath,
    assertion: input.assertion,
    requirement: input.requirement,
    reason: input.reason,
    implementationEvidence: input.implementationEvidence ?? [],
    grantsTestWriteAuthority: false,
  });
}

function cli() {
  const argv = process.argv.slice(2);
  const value = (flag) => {
    const i = argv.indexOf(flag);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  if (argv.includes('--select')) {
    const profile = resolveExecutionProfile({ override: value('--profile') });
    const out = value('--out');
    const selection = {
      schema: 'foresift/execution-profile-selection@1',
      executionProfile: profile,
      implementationEngine: implementationEngineForProfile(profile),
      testEngine: testEngineForProfile(profile),
      routingPolicyVersion: EXECUTION_POLICY.routingPolicyVersion,
    };
    if (out) writeFileSync(out, JSON.stringify(selection, null, 2) + '\n');
    process.stdout.write(JSON.stringify(selection) + '\n');
    return;
  }
  if (argv.includes('--create')) {
    const routing = JSON.parse(readFileSync(value('--routing'), 'utf8'));
    const identity = createExecutionIdentity({
      packageId: value('--package'),
      generation: Number(value('--generation')),
      workflow: value('--workflow'),
      executionProfile: routing.executionProfile,
      baseHead: value('--base-head'),
      lanes: routing.lanes,
      routingPolicyVersion: routing.routingPolicyVersion,
    });
    persistExecutionIdentity(value('--out'), identity);
    process.stdout.write(JSON.stringify(identity) + '\n');
    return;
  }
  console.error(
    'usage: execution-profile.mjs --select ... | --create --routing file --out file ...',
  );
  process.exit(2);
}

if (process.argv[1]?.endsWith('execution-profile.mjs')) cli();
