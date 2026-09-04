import { describe, expect, it } from 'bun:test';
import {
  LiquidityRemovalRisk,
  LpControlState,
  PoolSupportState,
  QuoteParityState,
  StateCompleteness,
  WithdrawalAuthorityState,
} from '@foresift/domain';
import { parseSolsecSchema } from '@foresift/shared-schemas';
import {
  assessPoolSecurity,
  analyzePoolSecurity,
  blocksPoolExecutionModeling,
  type PoolSecurityInput,
  type PoolResolvedState,
} from '../src/index.ts';

describe('pool-security: deterministic LP and pool security assessment (FR-SOLSEC-003, AC-130, AC-230)', () => {
  const mockResolver = () => ({
    status: 'RESOLVED' as const,
    protocolFamily: 'RAYDIUM',
    decoderVersion: 'amm-v4',
  });

  const fullResolvedState: PoolResolvedState = {
    poolOwner: 'RaydiumOwner1111111111111111111111111111111',
    positionControl: 'BURNED',
    withdrawalAuthorityAddress: null,
    withdrawalAuthorityObservedAbuse: false,
    liquidityConcentration: 0.15,
    recentLiquidityAddsRaw: '5000000',
    recentLiquidityRemovalsRaw: '0',
    largeSellImpactBps: 250,
    calculatedQuoteOutputRaw: '1000000',
    referenceQuoteOutputRaw: '1000000',
    quoteToleranceBps: 50,
  };

  const baseInput: PoolSecurityInput = {
    poolId: 'solana:mainnet/pool_test_001',
    programId: '675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8',
    programVersion: '4.0.0',
    layoutHash: 'sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
    state: fullResolvedState,
    decoderResolver: mockResolver,
    evidenceRef: 'evidence:pool:001',
    observedAt: '2026-01-01T00:00:00.000Z',
    availableAt: '2026-01-01T00:00:01.000Z',
  };

  it('evaluates fully resolved, burned LP pool with revoked withdrawal authority (ideal safe state)', () => {
    const assessment = assessPoolSecurity(baseInput);

    expect(assessment.adapterSupportState).toBe(PoolSupportState.RESOLVED);
    expect(assessment.adapterId).toBe('RAYDIUM');
    expect(assessment.adapterVersion).toBe('amm-v4');
    expect(assessment.lpControlState).toBe(LpControlState.BURNED);
    expect(assessment.withdrawalAuthorityState).toBe(WithdrawalAuthorityState.REVOKED);
    expect(assessment.liquidityRemovalRisk).toBe(LiquidityRemovalRisk.NONE_EVIDENCED);
    expect(assessment.quoteParityState).toBe(QuoteParityState.PASS);
    expect(assessment.stateCompleteness).toBe(StateCompleteness.COMPLETE);
    expect(assessment.qualityCodes).toEqual(['VALID']);
    expect(blocksPoolExecutionModeling(assessment)).toBe(false);

    // Validate schema
    expect(() => parseSolsecSchema('PoolSecurityAssessment', assessment)).not.toThrow();
  });

  it('handles locked LP with evidence and confirmed migration edge lineage', () => {
    const assessment = assessPoolSecurity({
      ...baseInput,
      state: {
        ...fullResolvedState,
        positionControl: 'LOCKED_WITH_EVIDENCE',
        lockEvidenceRef: 'evidence:streamflow:lock:001',
        withdrawalAuthorityAddress: 'DevAuthority11111111111111111111111111111111',
      },
      migrationEdges: [
        {
          migrationId: 'mig_pump_to_raydium_001',
          launchPoolId: 'solana:mainnet/launch_pool_001',
          migratedPoolId: baseInput.poolId,
          status: 'CONFIRMED',
          migratedAt: '2026-01-01T00:00:00.000Z',
        },
      ],
    });

    expect(assessment.lpControlState).toBe(LpControlState.LOCKED_WITH_EVIDENCE);
    expect(assessment.withdrawalAuthorityState).toBe(WithdrawalAuthorityState.PRESENT_OPEN);
    expect(assessment.liquidityRemovalRisk).toBe(LiquidityRemovalRisk.POSSIBLE);
    expect(assessment.migrationLineageId).toBe('mig_pump_to_raydium_001');

    expect(() => parseSolsecSchema('PoolSecurityAssessment', assessment)).not.toThrow();
  });

  it('fails safe when locked LP is missing lockEvidenceRef', () => {
    const assessment = assessPoolSecurity({
      ...baseInput,
      state: {
        ...fullResolvedState,
        positionControl: 'LOCKED_WITH_EVIDENCE',
      },
    });

    expect(assessment.lpControlState).toBe(LpControlState.UNABLE_TO_VERIFY);
    expect(assessment.liquidityRemovalRisk).toBe(LiquidityRemovalRisk.UNABLE_TO_VERIFY);
    expect(assessment.stateCompleteness).toBe(StateCompleteness.INCOMPLETE_BLOCKING);
    expect(blocksPoolExecutionModeling(assessment)).toBe(true);
  });

  it('detects observed liquidity removal abuse when withdrawal authority abuse is evidenced', () => {
    const assessment = assessPoolSecurity({
      ...baseInput,
      state: {
        ...fullResolvedState,
        positionControl: 'OPEN_CONTROL',
        withdrawalAuthorityAddress: 'AbusiveDev11111111111111111111111111111111',
        withdrawalAuthorityObservedAbuse: true,
      },
    });

    expect(assessment.withdrawalAuthorityState).toBe(
      WithdrawalAuthorityState.PRESENT_WITH_OBSERVED_ABUSE,
    );
    expect(assessment.liquidityRemovalRisk).toBe(LiquidityRemovalRisk.OBSERVED);
  });

  it('handles unsupported or mismatched decoder design -> DEGRADED_UNSUPPORTED with null resolved state (ADR-5)', () => {
    const unsupportedResolver = () => ({
      status: 'UNSUPPORTED' as const,
      reason: 'Unknown pool program',
    });

    const assessment = assessPoolSecurity({
      ...baseInput,
      decoderResolver: unsupportedResolver,
    });

    expect(assessment.adapterSupportState).toBe(PoolSupportState.DEGRADED_UNSUPPORTED);
    expect(assessment.lpControlState).toBeNull();
    expect(assessment.withdrawalAuthorityState).toBeNull();
    expect(assessment.liquidityRemovalRisk).toBeNull();
    expect(assessment.quoteParityState).toBeNull();
    expect(assessment.stateCompleteness).toBeNull();
    expect(assessment.migrationLineageId).toBeNull();
    expect(assessment.liquidityConcentration).toBeNull();
    expect(assessment.qualityCodes).toContain('POOL_MATH_UNSUPPORTED');
    expect(assessment.qualityCodes).toContain('UNSUPPORTED_PROGRAM_VERSION');
    expect(blocksPoolExecutionModeling(assessment)).toBe(true);

    // Crucial: shared schema validates that DEGRADED_UNSUPPORTED must have null state fields
    expect(() => parseSolsecSchema('PoolSecurityAssessment', assessment)).not.toThrow();
  });

  it('detects quote parity failure and degrades quality code to QUOTE_PARITY_FAILED', () => {
    const assessment = assessPoolSecurity({
      ...baseInput,
      state: {
        ...fullResolvedState,
        calculatedQuoteOutputRaw: '1000000',
        referenceQuoteOutputRaw: '1200000', // 20% mismatch vs 50 bps tolerance
        quoteToleranceBps: 50,
      },
    });

    expect(assessment.quoteParityState).toBe(QuoteParityState.FAIL);
    expect(assessment.qualityCodes).toContain('QUOTE_PARITY_FAILED');
    expect(assessment.stateCompleteness).toBe(StateCompleteness.INCOMPLETE_BLOCKING);
    expect(blocksPoolExecutionModeling(assessment)).toBe(true);
  });

  it('enforces temporal order invariant availableAt >= observedAt', () => {
    expect(() =>
      assessPoolSecurity({
        ...baseInput,
        observedAt: '2026-01-01T00:00:10.000Z',
        availableAt: '2026-01-01T00:00:01.000Z',
      }),
    ).toThrow('AVAILABLE_AT_PRECEDES_OBSERVED_AT');
  });

  it('exposes analyzePoolSecurity alias identical to assessPoolSecurity', () => {
    expect(analyzePoolSecurity).toBe(assessPoolSecurity);
  });
});
