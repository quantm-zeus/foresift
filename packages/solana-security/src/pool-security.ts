import {
  PoolAssessmentState,
  PositionControlState,
  WithdrawalAuthorityState,
  type PoolSecurityAssessment,
} from '@foresift/domain';
import { resolveDecoder } from '@foresift/program-decoders';

export const POOL_SECURITY_ANALYZER_VERSION = 'solsec-pool-security@1';
export const POOL_SECURITY_POLICY_VERSION = 'solsec-pool-controls@1';

export interface MigrationEdgeEvidence {
  readonly migrationId: string;
  readonly launchPoolId: string;
  readonly migratedPoolId: string;
  readonly status: 'CONFIRMED' | 'AMBIGUOUS';
  readonly migratedAt?: string;
}

export interface PoolResolvedState {
  readonly poolOwner?: string;
  readonly positionControl?: 'BURNED' | 'LOCKED_WITH_EVIDENCE' | 'OPEN' | 'UNABLE_TO_VERIFY';
  readonly lockEvidenceRef?: string;
  readonly withdrawalAuthorityAddress?: string | null;
  readonly withdrawalAuthorityObservedAbuse?: boolean;
  readonly liquidityConcentration?: number;
  readonly recentLiquidityAddsRaw?: string;
  readonly recentLiquidityRemovalsRaw?: string;
  readonly largeSellImpactBps?: number;
  readonly calculatedQuoteOutputRaw?: string;
  readonly referenceQuoteOutputRaw?: string;
  readonly quoteToleranceBps?: number;
}

export type PoolDecoderResolution =
  | {
      readonly status: 'RESOLVED';
      readonly decoderId?: string;
      readonly protocolFamily?: string;
      readonly decoderVersion?: string;
    }
  | { readonly status: 'UNSUPPORTED' | 'DEGRADED'; readonly reason?: string }
  | {
      readonly state: 'SUPPORTED';
      readonly decoder: { readonly protocolFamily: string; readonly decoderVersion: string };
    }
  | {
      readonly state: 'DEGRADED';
      readonly qualityCode?: 'UNSUPPORTED_PROGRAM_VERSION';
      readonly reason: string;
    };

export interface PoolSecurityInput {
  readonly poolId: string;
  readonly programId: string;
  readonly programVersion: string;
  readonly layoutHash: string;
  readonly state: PoolResolvedState;
  readonly migrationEdges?: readonly MigrationEdgeEvidence[];
  readonly analyzerVersion?: string;
  readonly policyVersion?: string;
  readonly evidenceRef: string;
  readonly observedAt: string;
  readonly availableAt: string;
  /** Injection exists for a populated DecoderRegistry; production defaults to its public resolver. */
  readonly decoderResolver?: (query: {
    programId: string;
    programVersion: string;
    layoutHash: string;
  }) => PoolDecoderResolution;
}

function assessmentId(input: PoolSecurityInput): string {
  return `pool-assessment:${[
    input.poolId,
    input.programId,
    input.programVersion,
    input.layoutHash,
    input.policyVersion ?? POOL_SECURITY_POLICY_VERSION,
    input.availableAt,
  ]
    .map((value) => encodeURIComponent(value))
    .join(':')}`;
}

function unsupported(input: PoolSecurityInput): PoolSecurityAssessment {
  return {
    assessmentId: assessmentId(input),
    poolId: input.poolId,
    state: PoolAssessmentState.DEGRADED_UNSUPPORTED,
    protocolFamily: null,
    decoderVersion: null,
    poolOwner: null,
    positionControl: null,
    lockEvidenceRef: null,
    withdrawalAuthority: null,
    migrationLineageRef: null,
    quoteParityPassed: null,
    liquidityConcentration: null,
    recentLiquidityAddsRaw: null,
    recentLiquidityRemovalsRaw: null,
    largeSellImpactBps: null,
    stateComplete: false,
    qualityCodes: ['POOL_MATH_UNSUPPORTED', 'UNSUPPORTED_PROGRAM_VERSION'],
    analyzerVersion: input.analyzerVersion ?? POOL_SECURITY_ANALYZER_VERSION,
    policyVersion: input.policyVersion ?? POOL_SECURITY_POLICY_VERSION,
    evidenceRef: input.evidenceRef,
    observedAt: input.observedAt,
    availableAt: input.availableAt,
  };
}

function quoteParity(state: PoolResolvedState): boolean | null {
  if (
    state.calculatedQuoteOutputRaw === undefined ||
    state.referenceQuoteOutputRaw === undefined ||
    state.quoteToleranceBps === undefined
  )
    return null;
  if (!/^\d+$/.test(state.calculatedQuoteOutputRaw) || !/^\d+$/.test(state.referenceQuoteOutputRaw))
    return null;
  const actual = BigInt(state.calculatedQuoteOutputRaw);
  const reference = BigInt(state.referenceQuoteOutputRaw);
  if (reference === 0n) return actual === 0n;
  const difference = actual > reference ? actual - reference : reference - actual;
  return difference * 10_000n <= reference * BigInt(state.quoteToleranceBps);
}

function resolveMetadata(
  resolution: PoolDecoderResolution,
): { protocolFamily: string; decoderVersion: string } | undefined {
  if ('state' in resolution) {
    return resolution.state === 'SUPPORTED'
      ? {
          protocolFamily: resolution.decoder.protocolFamily,
          decoderVersion: resolution.decoder.decoderVersion,
        }
      : undefined;
  }
  if (resolution.status !== 'RESOLVED') return undefined;
  return {
    protocolFamily: resolution.protocolFamily ?? 'SIGNED_MANIFEST_RESOLVED',
    decoderVersion: resolution.decoderVersion ?? resolution.decoderId ?? 'SIGNED_MANIFEST',
  };
}

function withdrawalState(state: PoolResolvedState): PoolSecurityAssessment['withdrawalAuthority'] {
  if (state.withdrawalAuthorityAddress === undefined)
    return WithdrawalAuthorityState.UNABLE_TO_VERIFY;
  if (state.withdrawalAuthorityAddress === null) return WithdrawalAuthorityState.REVOKED;
  return state.withdrawalAuthorityObservedAbuse === true
    ? WithdrawalAuthorityState.PRESENT_WITH_OBSERVED_ABUSE
    : WithdrawalAuthorityState.PRESENT;
}

function migrationReference(
  poolId: string,
  edges: readonly MigrationEdgeEvidence[],
): string | null {
  const edge = edges.find(
    (candidate) =>
      candidate.status === 'CONFIRMED' &&
      (candidate.launchPoolId === poolId || candidate.migratedPoolId === poolId),
  );
  return edge?.migrationId ?? null;
}

/**
 * Assess pool control only after exact signed-manifest decoder resolution. The
 * supplied state is never interpreted when resolution fails.
 */
export function assessPoolSecurity(input: PoolSecurityInput): PoolSecurityAssessment {
  const observed = Date.parse(input.observedAt);
  const available = Date.parse(input.availableAt);
  if (!Number.isFinite(observed) || !Number.isFinite(available))
    throw new Error('INVALID_TIMESTAMP');
  if (available < observed) throw new Error('AVAILABLE_AT_PRECEDES_OBSERVED_AT');

  const resolution = (input.decoderResolver ?? resolveDecoder)({
    programId: input.programId,
    programVersion: input.programVersion,
    layoutHash: input.layoutHash,
  });
  const metadata = resolveMetadata(resolution);
  if (metadata === undefined) return unsupported(input);

  const parity = quoteParity(input.state);
  let positionControl = input.state.positionControl ?? PositionControlState.UNABLE_TO_VERIFY;
  if (
    positionControl === PositionControlState.LOCKED_WITH_EVIDENCE &&
    input.state.lockEvidenceRef === undefined
  )
    positionControl = PositionControlState.UNABLE_TO_VERIFY;

  const qualityCodes = new Set<string>();
  if (parity === false) qualityCodes.add('QUOTE_PARITY_FAILED');
  if (parity === null) qualityCodes.add('EXECUTION_PARTIAL');
  if (input.state.poolOwner === undefined) qualityCodes.add('EXECUTION_PARTIAL');
  if (positionControl === PositionControlState.UNABLE_TO_VERIFY)
    qualityCodes.add('EXECUTION_PARTIAL');
  const withdrawalAuthority = withdrawalState(input.state);
  if (withdrawalAuthority === WithdrawalAuthorityState.UNABLE_TO_VERIFY)
    qualityCodes.add('EXECUTION_PARTIAL');
  if (
    input.state.liquidityConcentration === undefined ||
    input.state.liquidityConcentration < 0 ||
    input.state.liquidityConcentration > 1 ||
    input.state.recentLiquidityAddsRaw === undefined ||
    !/^\d+$/.test(input.state.recentLiquidityAddsRaw) ||
    input.state.recentLiquidityRemovalsRaw === undefined ||
    !/^\d+$/.test(input.state.recentLiquidityRemovalsRaw) ||
    input.state.largeSellImpactBps === undefined ||
    !Number.isFinite(input.state.largeSellImpactBps) ||
    input.state.largeSellImpactBps < 0
  )
    qualityCodes.add('EXECUTION_PARTIAL');

  const stateComplete = qualityCodes.size === 0;
  return {
    assessmentId: assessmentId(input),
    poolId: input.poolId,
    state: stateComplete ? PoolAssessmentState.COMPLETE : PoolAssessmentState.PARTIAL,
    protocolFamily: metadata.protocolFamily,
    decoderVersion: metadata.decoderVersion,
    poolOwner: input.state.poolOwner ?? null,
    positionControl,
    lockEvidenceRef: input.state.lockEvidenceRef ?? null,
    withdrawalAuthority,
    migrationLineageRef: migrationReference(input.poolId, input.migrationEdges ?? []),
    quoteParityPassed: parity,
    liquidityConcentration:
      input.state.liquidityConcentration !== undefined &&
      input.state.liquidityConcentration >= 0 &&
      input.state.liquidityConcentration <= 1
        ? input.state.liquidityConcentration
        : null,
    recentLiquidityAddsRaw:
      input.state.recentLiquidityAddsRaw !== undefined &&
      /^\d+$/.test(input.state.recentLiquidityAddsRaw)
        ? input.state.recentLiquidityAddsRaw
        : null,
    recentLiquidityRemovalsRaw:
      input.state.recentLiquidityRemovalsRaw !== undefined &&
      /^\d+$/.test(input.state.recentLiquidityRemovalsRaw)
        ? input.state.recentLiquidityRemovalsRaw
        : null,
    largeSellImpactBps:
      input.state.largeSellImpactBps !== undefined &&
      Number.isFinite(input.state.largeSellImpactBps) &&
      input.state.largeSellImpactBps >= 0
        ? input.state.largeSellImpactBps
        : null,
    stateComplete,
    qualityCodes: stateComplete ? ['VALID'] : [...qualityCodes],
    analyzerVersion: input.analyzerVersion ?? POOL_SECURITY_ANALYZER_VERSION,
    policyVersion: input.policyVersion ?? POOL_SECURITY_POLICY_VERSION,
    evidenceRef: input.evidenceRef,
    observedAt: input.observedAt,
    availableAt: input.availableAt,
  };
}

/** Confirmed execution modeling requires fully resolved, parity-proven state. */
export function blocksPoolExecutionModeling(assessment: PoolSecurityAssessment): boolean {
  return (
    assessment.state !== PoolAssessmentState.COMPLETE ||
    !assessment.stateComplete ||
    assessment.quoteParityPassed !== true
  );
}

export const analyzePoolSecurity = assessPoolSecurity;
