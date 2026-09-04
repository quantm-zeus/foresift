import {
  LiquidityRemovalRisk,
  LpControlState,
  PoolSupportState,
  QuoteParityState,
  StateCompleteness,
  WithdrawalAuthorityState,
  type QualityCode,
} from '@foresift/domain';
import { resolveDecoder } from '@foresift/program-decoders';
import type { PoolSecurityAssessment } from '@foresift/shared-schemas';

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
  readonly lpControlState?: LpControlState;
  readonly positionControl?:
    | 'BURNED'
    | 'LOCKED'
    | 'LOCKED_WITH_EVIDENCE'
    | 'OPEN'
    | 'OPEN_CONTROL'
    | 'UNABLE_TO_VERIFY';
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
  readonly decoderResolver?: (query: {
    programId: string;
    programVersion: string;
    layoutHash: string;
  }) => PoolDecoderResolution;
}
function id(input: PoolSecurityInput): string {
  return `pool-assessment:${[input.poolId, input.programId, input.programVersion, input.layoutHash, input.analyzerVersion ?? POOL_SECURITY_ANALYZER_VERSION, input.policyVersion ?? POOL_SECURITY_POLICY_VERSION, input.availableAt].map(encodeURIComponent).join(':')}`;
}
function metadata(
  resolution: PoolDecoderResolution,
): { adapterId: string; adapterVersion: string } | undefined {
  if ('state' in resolution) {
    if (
      resolution.state !== 'SUPPORTED' ||
      resolution.decoder.protocolFamily.trim().length === 0 ||
      resolution.decoder.decoderVersion.trim().length === 0
    )
      return undefined;
    return {
      adapterId: resolution.decoder.protocolFamily,
      adapterVersion: resolution.decoder.decoderVersion,
    };
  }
  if (resolution.status !== 'RESOLVED') return undefined;
  const adapterId = resolution.protocolFamily ?? resolution.decoderId;
  const adapterVersion = resolution.decoderVersion ?? resolution.decoderId;
  if (
    adapterId === undefined ||
    adapterVersion === undefined ||
    adapterId.trim().length === 0 ||
    adapterVersion.trim().length === 0
  )
    return undefined;
  return {
    adapterId,
    adapterVersion,
  };
}
function unsupported(input: PoolSecurityInput): PoolSecurityAssessment {
  return {
    assessmentId: id(input),
    poolId: input.poolId,
    adapterId: input.programId,
    adapterVersion: `${input.programVersion}/${input.layoutHash}`,
    adapterSupportState: PoolSupportState.DEGRADED_UNSUPPORTED,
    lpControlState: null,
    withdrawalAuthorityState: null,
    liquidityRemovalRisk: null,
    quoteParityState: null,
    stateCompleteness: null,
    migrationLineageId: null,
    liquidityConcentration: null,
    observedAt: input.observedAt,
    availableAt: input.availableAt,
    evidenceIds: [
      input.evidenceRef,
      `analyzer:${input.analyzerVersion ?? POOL_SECURITY_ANALYZER_VERSION}`,
      `policy:${input.policyVersion ?? POOL_SECURITY_POLICY_VERSION}`,
    ],
    qualityCodes: ['POOL_MATH_UNSUPPORTED', 'UNSUPPORTED_PROGRAM_VERSION'],
    schemaRegistryVersion: 1,
  };
}
function parity(state: PoolResolvedState): QuoteParityState {
  if (
    state.calculatedQuoteOutputRaw === undefined ||
    state.referenceQuoteOutputRaw === undefined ||
    state.quoteToleranceBps === undefined ||
    !Number.isInteger(state.quoteToleranceBps) ||
    state.quoteToleranceBps < 0
  )
    return QuoteParityState.UNABLE_TO_VERIFY;
  if (!/^\d+$/.test(state.calculatedQuoteOutputRaw) || !/^\d+$/.test(state.referenceQuoteOutputRaw))
    return QuoteParityState.UNABLE_TO_VERIFY;
  const actual = BigInt(state.calculatedQuoteOutputRaw);
  const reference = BigInt(state.referenceQuoteOutputRaw);
  if (reference === 0n) return actual === 0n ? QuoteParityState.PASS : QuoteParityState.FAIL;
  const delta = actual > reference ? actual - reference : reference - actual;
  return delta * 10_000n <= reference * BigInt(state.quoteToleranceBps)
    ? QuoteParityState.PASS
    : QuoteParityState.FAIL;
}
function lpState(state: PoolResolvedState): LpControlState {
  if (
    state.lpControlState !== undefined &&
    Object.values(LpControlState).includes(state.lpControlState)
  )
    return state.lpControlState;
  if (state.positionControl === 'BURNED') return LpControlState.BURNED;
  if (state.positionControl === 'LOCKED' || state.positionControl === 'LOCKED_WITH_EVIDENCE')
    return state.lockEvidenceRef === undefined || state.lockEvidenceRef.trim().length === 0
      ? LpControlState.UNABLE_TO_VERIFY
      : LpControlState.LOCKED_WITH_EVIDENCE;
  if (state.positionControl === 'OPEN' || state.positionControl === 'OPEN_CONTROL')
    return LpControlState.OPEN_CONTROL;
  return LpControlState.UNABLE_TO_VERIFY;
}
function withdrawal(state: PoolResolvedState): WithdrawalAuthorityState {
  if (state.withdrawalAuthorityAddress === undefined)
    return WithdrawalAuthorityState.UNABLE_TO_VERIFY;
  if (state.withdrawalAuthorityAddress === null) return WithdrawalAuthorityState.REVOKED;
  if (state.withdrawalAuthorityAddress.trim().length === 0)
    return WithdrawalAuthorityState.UNABLE_TO_VERIFY;
  return state.withdrawalAuthorityObservedAbuse === true
    ? WithdrawalAuthorityState.PRESENT_WITH_OBSERVED_ABUSE
    : WithdrawalAuthorityState.PRESENT_OPEN;
}
function risk(
  state: PoolResolvedState,
  lp: LpControlState,
  auth: WithdrawalAuthorityState,
): LiquidityRemovalRisk {
  if (
    state.largeSellImpactBps !== undefined &&
    (!Number.isFinite(state.largeSellImpactBps) || state.largeSellImpactBps < 0)
  )
    return LiquidityRemovalRisk.UNABLE_TO_VERIFY;
  if (auth === WithdrawalAuthorityState.UNABLE_TO_VERIFY || lp === LpControlState.UNABLE_TO_VERIFY)
    return LiquidityRemovalRisk.UNABLE_TO_VERIFY;
  if (auth === WithdrawalAuthorityState.PRESENT_WITH_OBSERVED_ABUSE)
    return LiquidityRemovalRisk.OBSERVED;
  if (
    auth === WithdrawalAuthorityState.PRESENT_OPEN ||
    lp === LpControlState.OPEN_CONTROL ||
    (state.largeSellImpactBps ?? 0) >= 2_000
  )
    return LiquidityRemovalRisk.POSSIBLE;
  return LiquidityRemovalRisk.NONE_EVIDENCED;
}

/** Resolves an exact signed-manifest tuple before inspecting any supplied pool state. */
export function assessPoolSecurity(input: PoolSecurityInput): PoolSecurityAssessment {
  const observedAt = Date.parse(input.observedAt);
  const availableAt = Date.parse(input.availableAt);
  if (!Number.isFinite(observedAt) || !Number.isFinite(availableAt))
    throw new Error('INVALID_POOL_ASSESSMENT_TIMESTAMP');
  if (availableAt < observedAt) throw new Error('AVAILABLE_AT_PRECEDES_OBSERVED_AT');
  let resolution: PoolDecoderResolution;
  try {
    resolution = (input.decoderResolver ?? resolveDecoder)({
      programId: input.programId,
      programVersion: input.programVersion,
      layoutHash: input.layoutHash,
    });
  } catch {
    return unsupported(input);
  }
  const resolved = metadata(resolution);
  if (resolved === undefined) return unsupported(input);
  const lp = lpState(input.state);
  const auth = withdrawal(input.state);
  const quote = parity(input.state);
  const concentration = input.state.liquidityConcentration;
  const complete =
    input.state.poolOwner !== undefined &&
    lp !== LpControlState.UNABLE_TO_VERIFY &&
    auth !== WithdrawalAuthorityState.UNABLE_TO_VERIFY &&
    quote === QuoteParityState.PASS &&
    concentration !== undefined &&
    Number.isFinite(concentration) &&
    concentration >= 0 &&
    concentration <= 1 &&
    /^\d+$/.test(input.state.recentLiquidityAddsRaw ?? '') &&
    /^\d+$/.test(input.state.recentLiquidityRemovalsRaw ?? '') &&
    input.state.largeSellImpactBps !== undefined &&
    Number.isFinite(input.state.largeSellImpactBps) &&
    input.state.largeSellImpactBps >= 0;
  const qualityCodes: QualityCode[] =
    quote === QuoteParityState.FAIL
      ? ['QUOTE_PARITY_FAILED']
      : complete
        ? ['VALID']
        : ['EXECUTION_PARTIAL'];
  const edge = (input.migrationEdges ?? []).find(
    (item) =>
      item.status === 'CONFIRMED' &&
      (item.launchPoolId === input.poolId || item.migratedPoolId === input.poolId),
  );
  return {
    assessmentId: id(input),
    poolId: input.poolId,
    adapterId: resolved.adapterId,
    adapterVersion: resolved.adapterVersion,
    adapterSupportState: PoolSupportState.RESOLVED,
    lpControlState: lp,
    withdrawalAuthorityState: auth,
    liquidityRemovalRisk: risk(input.state, lp, auth),
    quoteParityState: quote,
    stateCompleteness: complete
      ? StateCompleteness.COMPLETE
      : StateCompleteness.INCOMPLETE_BLOCKING,
    migrationLineageId: edge?.migrationId ?? null,
    liquidityConcentration:
      concentration !== undefined &&
      Number.isFinite(concentration) &&
      concentration >= 0 &&
      concentration <= 1
        ? String(concentration)
        : null,
    observedAt: input.observedAt,
    availableAt: input.availableAt,
    evidenceIds: [
      input.evidenceRef,
      `analyzer:${input.analyzerVersion ?? POOL_SECURITY_ANALYZER_VERSION}`,
      `policy:${input.policyVersion ?? POOL_SECURITY_POLICY_VERSION}`,
    ],
    qualityCodes,
    schemaRegistryVersion: 1,
  };
}
export function blocksPoolExecutionModeling(assessment: PoolSecurityAssessment): boolean {
  return (
    assessment.adapterSupportState !== PoolSupportState.RESOLVED ||
    assessment.stateCompleteness !== StateCompleteness.COMPLETE ||
    assessment.quoteParityState !== QuoteParityState.PASS
  );
}
export const analyzePoolSecurity = assessPoolSecurity;
