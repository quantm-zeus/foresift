// AC-276 (negative): each prohibited claim class is refused on EVERY
// distribution channel — guaranteed profit, risk-free, universal recall,
// uncalibrated probability, unsupported performance — and
// assertClaimsCompliant throws rather than letting the copy through.
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
  const scope = makeProdScope({ profile_version: 'ac276-prod-neg' });
  return {
    ...passingOpportunityGateInput(scope),
    kind: ActivationKind.PUBLIC,
    distributionEvidence: passingDistributionEvidence({
      distributionReadiness: 'PUBLIC_AUTHORIZED',
      ...overrides,
    }),
  };
}

const PROHIBITED_SAMPLES: readonly [string, string][] = [
  ['GUARANTEED_PROFIT', 'Subscribe now for guaranteed profits every week.'],
  ['RISK_FREE', 'This is a completely risk-free strategy for our members.'],
  ['UNIVERSAL_RECALL', 'Our rug-pull detector never misses a single scam launch.'],
  ['UNCALIBRATED_PROBABILITY', 'Signals are 97% accurate in live trading.'],
  ['UNSUPPORTED_PERFORMANCE', 'The best performing bot on the market, #1 trading tool.'],
];

const CHANNELS = ['MARKETING', 'UI', 'API', 'EXPORT'] as const;

describe('AC-276 negatives: prohibited claims refuse on every channel', () => {
  it('refuses each claim class with the matching class label on all channels', () => {
    for (const [claimClass, text] of PROHIBITED_SAMPLES) {
      for (const channel of CHANNELS) {
        const result = evaluateClaims(text, channel);
        expect(result.verdict, `${claimClass} on ${channel}`).toBe('REFUSED');
        if (result.verdict === 'REFUSED') {
          expect(result.claimClasses as readonly string[]).toContain(claimClass);
        }
        expect(() => assertClaimsCompliant(text, channel), `${claimClass} via assert`).toThrow(
          /prohibited claims/,
        );
      }
    }
  });

  it('mixed-copy smuggling still refuses (claims hidden inside longer text)', () => {
    const smuggled =
      "Weekly digest: liquidity shifted on two pools; overall our engine can't lose according to early users.";
    const result = evaluateClaims(smuggled, 'EXPORT');
    expect(result.verdict).toBe('REFUSED');
    if (result.verdict === 'REFUSED') {
      expect(result.claimClasses).toContain('GUARANTEED_PROFIT');
    }
  });
});

// --- prod-scoped additions (T037, FR-PROD-002/004, AC-276) -------------------

describe('AC-276 prod-scoped negatives: a failed claims review refuses public authorization', () => {
  it('refuses the PUBLIC gate when the claims review did not pass', () => {
    const result = evaluateActivationGate(prodClaimsInput({ claimsReview: false }));
    expect(result.verdict).toBe('REFUSE');
    if (result.verdict === 'REFUSE') {
      expect(result.failingGate).toBe('DISTRIBUTION_EVIDENCE');
      expect(result.reason).toBe('DISTRIBUTION_EVIDENCE_MISSING');
    }
  });

  it('still refuses prohibited claim copy independently of gate evidence', () => {
    expect(evaluateClaims('guaranteed profits every week', 'EXPORT').verdict).toBe('REFUSED');
    expect(() => assertClaimsCompliant('guaranteed profits every week', 'EXPORT')).toThrow(
      /prohibited claims/,
    );
  });
});
