// AC-276 (acceptance): compliant marketing/UI/API/export text passes
// content-policy validation on its channel — the paired clean-text controls
// for the prohibited claim classes.
import { describe, expect, it } from 'bun:test';
import {
  ActivationKind,
  evaluateActivationGate,
  type DistributionEvidenceInput,
} from '@foresift/capability-registry';
import {
  assertClaimsCompliant,
  evaluateClaims,
} from '../../packages/security/src/claims-policy.ts';
import {
  makeProdScope,
  passingDistributionEvidence,
  passingOpportunityGateInput,
} from '../fixtures/prod/index.ts';

function prodClaimsInput(overrides: Partial<DistributionEvidenceInput> = {}) {
  const scope = makeProdScope({ profile_version: 'ac276-prod' });
  return {
    ...passingOpportunityGateInput(scope),
    kind: ActivationKind.PUBLIC,
    distributionEvidence: passingDistributionEvidence({
      distributionReadiness: 'PUBLIC_AUTHORIZED',
      ...overrides,
    }),
  };
}

const CLEAN_COPY: readonly [string, Parameters<typeof evaluateClaims>[1]][] = [
  ['portfolio snapshots refreshed hourly', 'UI'],
  ['signals are probabilistic and may fail', 'MARKETING'],
  ['detector coverage measured against labeled backfills', 'API'],
  ['historical performance does not guarantee future results', 'EXPORT'],
  ['alerts include evidence references and limitations', 'UI'],
];

describe('AC-276: compliant content passes policy on every channel', () => {
  it('admits each clean-copy control on its channel', () => {
    for (const [text, channel] of CLEAN_COPY) {
      const result = evaluateClaims(text, channel);
      expect(result.verdict, text).toBe('COMPLIANT');
      expect(() => assertClaimsCompliant(text, channel), text).not.toThrow();
    }
  });

  it('admits hedged performance language that names its own uncertainty', () => {
    for (const channel of ['MARKETING', 'UI', 'API', 'EXPORT'] as const) {
      expect(evaluateClaims('backtested sharpe was 1.2 in simulation', channel).verdict).toBe(
        'COMPLIANT',
      );
    }
  });
});

// --- prod-scoped addition (T037, FR-PROD-002/004, AC-276) --------------------

describe('AC-276 prod-scoped: claims-language gate evidence is mandatory for public authorization', () => {
  it('passes the PUBLIC gate when the claims review passed and the copy stays compliant', () => {
    const result = evaluateActivationGate(prodClaimsInput({ claimsReview: true }));
    expect(result.verdict).toBe('PASS');
    expect(evaluateClaims('signals are probabilistic and may fail', 'MARKETING').verdict).toBe(
      'COMPLIANT',
    );
  });

  it('admits the claims review only alongside the rest of the public evidence set', () => {
    const result = evaluateActivationGate(
      prodClaimsInput({ claimsReview: true, publicSafeRedaction: true }),
    );
    expect(result.verdict).toBe('PASS');
  });
});
