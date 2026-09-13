/**
 * Canonical module-state fixtures (T033, FR-PROD-001/002/004, AC-152/153).
 *
 * Inert, typed data: one row for every governed §69.2 lifecycle state plus the
 * `NOT_IMPLEMENTED` seed, one row for every operational and distribution
 * readiness dimension, and the activation claims (compliant + violating) that
 * the PROD release-conformance rules evaluate.
 */
import type {
  DistributionReadiness,
  ModuleLifecyclePosition,
  OperationalReadiness,
} from '@foresift/domain';
import type { ModuleActivationClaim } from '@foresift/release-conformance';
import { PROD_FIXTURE_HASH_A, PROD_FIXTURE_HASH_B } from './gate-inputs.ts';

export type ProdModuleStateDimension =
  'SEED' | 'IMPLEMENTED' | 'AVAILABLE' | 'PROVEN' | 'CONTAINMENT';

export interface ProdModuleStateFixture {
  readonly name: string;
  readonly moduleId: string;
  readonly lifecycleState: ModuleLifecyclePosition;
  readonly operationalReadiness: OperationalReadiness;
  readonly distributionReadiness: DistributionReadiness;
  readonly dimension: ProdModuleStateDimension;
  readonly activationEventRef: string | null;
  readonly artifactSetHash: string;
}

const OPERATIONAL: readonly OperationalReadiness[] = [
  'NOT_READY',
  'READY_FOR_COLLECTION',
  'READY_FOR_SHADOW_RESEARCH',
  'READY_FOR_SHADOW_ALERTS',
  'READY_FOR_ACTIVE_PROFILE',
];

const DISTRIBUTION: readonly DistributionReadiness[] = [
  'PRIVATE_ONLY',
  'WORKSPACE_TECHNICALLY_READY',
  'WORKSPACE_AUTHORIZED',
  'PUBLIC_TECHNICALLY_READY',
  'PUBLIC_AUTHORIZED',
];

/** One row for every governed lifecycle state (and the seed), readiness cycled. */
export const PROD_MODULE_STATE_ROWS: readonly ProdModuleStateFixture[] = (
  [
    ['SEED', 'NOT_IMPLEMENTED'],
    ['IMPLEMENTED', 'IMPLEMENTED'],
    ['AVAILABLE', 'AVAILABLE'],
    ['PROVEN', 'PROVEN'],
    ['CONTAINMENT', 'SHADOW'],
    ['CONTAINMENT', 'ACTIVE'],
    ['CONTAINMENT', 'DEGRADED'],
    ['CONTAINMENT', 'PAUSED'],
    ['CONTAINMENT', 'RETIRED'],
    ['CONTAINMENT', 'DISABLED'],
  ] as const
).map(([dimension, lifecycleState], index) => ({
  name: `state:${lifecycleState}`,
  moduleId: `module-${lifecycleState.toLowerCase()}`,
  lifecycleState,
  operationalReadiness: OPERATIONAL[index % OPERATIONAL.length] as OperationalReadiness,
  distributionReadiness: DISTRIBUTION[index % DISTRIBUTION.length] as DistributionReadiness,
  dimension,
  activationEventRef: lifecycleState === 'ACTIVE' ? 'activation-prod-active' : null,
  artifactSetHash: index % 2 === 0 ? PROD_FIXTURE_HASH_A : PROD_FIXTURE_HASH_B,
}));

export function prodModuleStateFixture(
  lifecycleState: ModuleLifecyclePosition,
): ProdModuleStateFixture {
  const found = PROD_MODULE_STATE_ROWS.find((row) => row.lifecycleState === lifecycleState);
  if (found === undefined) throw new Error(`no PROD module-state fixture for ${lifecycleState}`);
  return found;
}

/** Every governed lifecycle state appears exactly once (plus the seed). */
export const PROD_GOVERNED_LIFECYCLE_STATES: readonly ModuleLifecyclePosition[] = [
  'NOT_IMPLEMENTED',
  'IMPLEMENTED',
  'AVAILABLE',
  'SHADOW',
  'PROVEN',
  'ACTIVE',
  'DEGRADED',
  'PAUSED',
  'RETIRED',
  'DISABLED',
];

/** One row per operational-readiness dimension. */
export const PROD_OPERATIONAL_READINESS_ROWS: readonly ProdModuleStateFixture[] = OPERATIONAL.map(
  (operationalReadiness, index) => ({
    name: `operational:${operationalReadiness}`,
    moduleId: `module-operational-${index}`,
    lifecycleState: 'AVAILABLE' as ModuleLifecyclePosition,
    operationalReadiness,
    distributionReadiness: 'PRIVATE_ONLY' as DistributionReadiness,
    dimension: 'AVAILABLE' as ProdModuleStateDimension,
    activationEventRef: null,
    artifactSetHash: PROD_FIXTURE_HASH_A,
  }),
);

/** One row per distribution-readiness dimension. */
export const PROD_DISTRIBUTION_READINESS_ROWS: readonly ProdModuleStateFixture[] = DISTRIBUTION.map(
  (distributionReadiness, index) => ({
    name: `distribution:${distributionReadiness}`,
    moduleId: `module-distribution-${index}`,
    lifecycleState: 'PROVEN' as ModuleLifecyclePosition,
    operationalReadiness: 'READY_FOR_SHADOW_ALERTS' as OperationalReadiness,
    distributionReadiness,
    dimension: 'PROVEN' as ProdModuleStateDimension,
    activationEventRef: null,
    artifactSetHash: PROD_FIXTURE_HASH_B,
  }),
);

/** A compliant ACTIVE claim: all three dimensions, PASS gate, activation event. */
export const PROD_COMPLIANT_ACTIVE_CLAIM: ModuleActivationClaim = {
  moduleId: 'module-compliant-active',
  lifecycleState: 'ACTIVE',
  implemented: true,
  available: true,
  proven: true,
  requiresProven: true,
  activationEventRef: 'activation-prod-compliant',
  gateVerdict: 'PASS',
};

/** ACTIVE with no passing total gate — the activation-without-evidence violation. */
export const PROD_ACTIVE_WITHOUT_GATE_CLAIM: ModuleActivationClaim = {
  moduleId: 'module-active-without-gate',
  lifecycleState: 'ACTIVE',
  implemented: true,
  available: true,
  proven: true,
  requiresProven: true,
  activationEventRef: null,
  gateVerdict: 'REFUSE',
};

/** ACTIVE from IMPLEMENTED alone (never AVAILABLE) — AC-152 refusal. */
export const PROD_ACTIVE_UNAVAILABLE_CLAIM: ModuleActivationClaim = {
  moduleId: 'module-active-unavailable',
  lifecycleState: 'ACTIVE',
  implemented: true,
  available: false,
  proven: false,
  requiresProven: true,
  activationEventRef: 'activation-prod-unavailable',
  gateVerdict: 'PASS',
};

/** ACTIVE where the scope requires PROVEN but the dimension was never reached. */
export const PROD_ACTIVE_UNPROVEN_CLAIM: ModuleActivationClaim = {
  moduleId: 'module-active-unproven',
  lifecycleState: 'ACTIVE',
  implemented: true,
  available: true,
  proven: false,
  requiresProven: true,
  activationEventRef: 'activation-prod-unproven',
  gateVerdict: 'PASS',
};

/** A shadow-only deployment that must never support an ACTIVE/alert claim. */
export const PROD_SHADOW_ONLY_CLAIM: ModuleActivationClaim = {
  moduleId: 'module-shadow-only',
  lifecycleState: 'SHADOW',
  implemented: true,
  available: true,
  proven: false,
  requiresProven: true,
  activationEventRef: null,
  gateVerdict: null,
};

export const PROD_ACTIVATION_CLAIMS: readonly ModuleActivationClaim[] = [
  PROD_COMPLIANT_ACTIVE_CLAIM,
  PROD_ACTIVE_WITHOUT_GATE_CLAIM,
  PROD_ACTIVE_UNAVAILABLE_CLAIM,
  PROD_ACTIVE_UNPROVEN_CLAIM,
  PROD_SHADOW_ONLY_CLAIM,
];
