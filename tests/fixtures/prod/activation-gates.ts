/**
 * Canonical activation-gate fixtures (T033, FR-PROD-001/002, AC-144/150/151/
 * 152/154).
 *
 * Inert declarative gate-evaluation lists plus fully-resolved
 * `ActivationGateInput` matrices covering: every gate PASS, a missing gate, an
 * explicit REFUSE, conditional PROVEN (scope requires it vs not), and exact
 * scope mismatch. Every hash is the authoritative `activationScopeHash` of the
 * scope it describes.
 */
import type { ActivationGateKind, ActivationGateVerdict } from '@foresift/domain';
import {
  activationScopeHash,
  type ActivationGateInput,
  type RegisteredStatisticalEvidence,
} from '@foresift/capability-registry';
import {
  completeAvailableEvidence,
  makeProdScope,
  passingCapacityContract,
  passingGateEvidence,
  passingOpportunityGateInput,
  passingStatisticalEvidence,
} from './gate-inputs.ts';

/** Every gate the ordered evaluation walks, in canonical order. */
export const PROD_GATE_KINDS: readonly ActivationGateKind[] = [
  'IMPLEMENTED_PRESENT',
  'AVAILABLE_EVIDENCE',
  'PROVEN_PRESENT',
  'STATISTICAL_EVIDENCE_SCOPE',
  'NEGATIVE_CONTROLS',
  'CLUSTERED_INTERVALS',
  'CALIBRATION_MATURITY',
  'VERIFIED_GATE_EVIDENCE',
  'CAPACITY_CONTRACT',
  'DISTRIBUTION_EVIDENCE',
  'NO_OPEN_CONTAINMENT',
];

export interface ProdGateEvaluationFixture {
  readonly gateKind: ActivationGateKind;
  readonly verdict: ActivationGateVerdict;
  readonly failingGate: ActivationGateKind | null;
}

/** An all-PASS evaluation list, optionally overriding individual gates. */
export function prodGateEvaluations(
  overrides: Readonly<Partial<Record<ActivationGateKind, ActivationGateVerdict>>> = {},
): readonly ProdGateEvaluationFixture[] {
  return PROD_GATE_KINDS.map((gateKind) => {
    const verdict = overrides[gateKind] ?? 'PASS';
    return {
      gateKind,
      verdict,
      failingGate: verdict === 'REFUSE' ? gateKind : null,
    } satisfies ProdGateEvaluationFixture;
  });
}

export const PROD_GATE_ALL_PASS = prodGateEvaluations();
export const PROD_GATE_WITH_REFUSAL = prodGateEvaluations({ CAPACITY_CONTRACT: 'REFUSE' });
/** A gate list missing PROVEN_PRESENT entirely (conditional-PROVEN scope). */
export const PROD_GATE_MISSING_PROVEN: readonly ProdGateEvaluationFixture[] =
  PROD_GATE_ALL_PASS.filter((evaluation) => evaluation.gateKind !== 'PROVEN_PRESENT');

export interface ProdGateMatrixEntry {
  readonly name: string;
  readonly input: ActivationGateInput;
  readonly expected: {
    readonly verdict: 'PASS' | 'REFUSE';
    readonly failingGate: ActivationGateKind | null;
    readonly reason: string | null;
  };
}

/** The canonical pass/fail gate matrices, rebuilt with fresh authoritative hashes. */
export function prodGateMatrices(): readonly ProdGateMatrixEntry[] {
  const requiredScope = makeProdScope();
  const requiredHash = activationScopeHash(requiredScope);
  const conditionalScope = makeProdScope({ requires_proven: false, profile_version: 'cond-v1' });
  const otherScope = makeProdScope({ profile_version: 'other-v1' });

  const requiredInput = passingOpportunityGateInput(requiredScope);
  const conditionalBase = passingOpportunityGateInput(conditionalScope);
  const otherHash = activationScopeHash(otherScope);
  const foreignStatisticalEvidence: RegisteredStatisticalEvidence = passingStatisticalEvidence(
    otherHash,
    { evidenceRef: 'stat-foreign' },
  );

  return [
    {
      name: 'opportunity:all-pass-requires-proven',
      input: requiredInput,
      expected: { verdict: 'PASS', failingGate: null, reason: null },
    },
    {
      name: 'opportunity:conditional-proven-not-required',
      input: { ...conditionalBase, proven: false },
      expected: { verdict: 'PASS', failingGate: null, reason: null },
    },
    {
      name: 'opportunity:proven-required-but-absent',
      input: { ...requiredInput, proven: false },
      expected: { verdict: 'REFUSE', failingGate: 'PROVEN_PRESENT', reason: 'PROVEN_REQUIRED' },
    },
    {
      name: 'opportunity:available-never-established',
      input: { ...requiredInput, available: false },
      expected: {
        verdict: 'REFUSE',
        failingGate: 'AVAILABLE_EVIDENCE',
        reason: 'AVAILABLE_NOT_ESTABLISHED',
      },
    },
    {
      name: 'opportunity:available-evidence-incomplete',
      input: {
        ...requiredInput,
        availableEvidence: { ...completeAvailableEvidence(), rights: false },
      },
      expected: {
        verdict: 'REFUSE',
        failingGate: 'AVAILABLE_EVIDENCE',
        reason: 'AVAILABLE_EVIDENCE_MISSING',
      },
    },
    {
      name: 'opportunity:statistical-evidence-scope-mismatch',
      input: {
        ...requiredInput,
        registeredStatisticalEvidence: [foreignStatisticalEvidence],
        // The verified gate evidence must also stay bound to the foreign scope
        // so the FIRST refusal is the statistical scope mismatch.
        verifiedGateEvidence: passingGateEvidence(otherHash),
      },
      expected: {
        verdict: 'REFUSE',
        failingGate: 'STATISTICAL_EVIDENCE_SCOPE',
        reason: 'STATISTICAL_EVIDENCE_MISSING',
      },
    },
    {
      name: 'opportunity:open-containment',
      input: {
        ...requiredInput,
        openContainment: [
          {
            containmentId: 'containment-fixture-1',
            moduleId: 'module-fixture',
            scopeHash: requiredHash,
            action: 'PAUSED',
          },
        ],
      },
      expected: {
        verdict: 'REFUSE',
        failingGate: 'NO_OPEN_CONTAINMENT',
        reason: 'CONTAINMENT_OPEN',
      },
    },
    {
      name: 'workspace:distribution-evidence-missing',
      input: { ...requiredInput, kind: 'WORKSPACE', distributionEvidence: null },
      expected: {
        verdict: 'REFUSE',
        failingGate: 'DISTRIBUTION_EVIDENCE',
        reason: 'DISTRIBUTION_EVIDENCE_MISSING',
      },
    },
    {
      name: 'workspace:distribution-not-authorized',
      input: {
        ...requiredInput,
        kind: 'WORKSPACE',
        distributionEvidence: {
          distributionReadiness: 'WORKSPACE_TECHNICALLY_READY',
          oauthTenantIsolation: true,
          originClientCompatibility: true,
          dataRightsRedistribution: true,
          privacyRetentionDeletionExport: true,
          jurisdictionDisclosure: true,
          claimsReview: true,
          abuseRateLimitIncidentResponse: true,
          supportSecurityContact: true,
          publicSafeRedaction: true,
          isolationFixtures: true,
          rightsChangeBlockedPaths: [],
        },
      },
      expected: {
        verdict: 'REFUSE',
        failingGate: 'DISTRIBUTION_EVIDENCE',
        reason: 'DISTRIBUTION_NOT_AUTHORIZED',
      },
    },
    {
      name: 'opportunity:expired-capacity-contract',
      input: {
        ...requiredInput,
        capacityContract: passingCapacityContract({ expiresAt: '2020-01-01T00:00:00Z' }),
      },
      expected: {
        verdict: 'REFUSE',
        failingGate: 'CAPACITY_CONTRACT',
        reason: 'CAPACITY_CONTRACT_EXPIRED',
      },
    },
  ];
}

export const PROD_GATE_MATRIX = prodGateMatrices();
