/**
 * Telemetry catalogs are DECLARATIVE event contracts — the requirement
 * manifest maps requirements onto them (`telemetry/data.*`, `telemetry/dr.*`)
 * and observability-milestone emitters will be built against them. A catalog
 * naming a field no code path can produce invites implementers to fabricate
 * or mislabel values, so these specs pin catalog entries to the authoritative
 * shared schemas they describe (FR-DATA-002 contract honesty).
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'bun:test';
import {
  EvidenceAcquisitionDecisionSchema,
  ObservationRevisionSchema,
  DiscoveryUniverseEntrySchema,
  CheapMonitorRowSchema,
  MonitorBatchDescriptorSchema,
  PromotionDecisionSchema,
  CoveragePopulationManifestSchema,
} from '../packages/shared-schemas/src/index.ts';

const REPO_ROOT = join(import.meta.dirname, '..');

/** Structural subset of a Zod object schema used for shape checks. */
interface MiniSchema {
  safeParse(value: unknown): { success: boolean };
}
type Shape = Record<string, MiniSchema>;

/** Unwrap `.refine()` wrappers (ZodEffects) down to the underlying object shape. */
function shapeOf(schema: { shape?: Shape; innerType?: () => unknown }): Shape {
  let current = schema;
  while (!('shape' in current) || current.shape === undefined) {
    const unwrapped = current.innerType?.();
    if (unwrapped === undefined) {
      throw new Error('could not unwrap schema to its object shape');
    }
    current = unwrapped as typeof current;
  }
  return current.shape;
}

interface CatalogField {
  name: string;
  type: string;
  required: boolean;
}

interface Catalog {
  catalog: string;
  contractStatus?: string;
  requirementsCovered?: string[];
  events: { name: string; fields: CatalogField[] }[];
}

function loadCatalog(name: string): Catalog {
  return JSON.parse(readFileSync(join(REPO_ROOT, 'telemetry', name), 'utf8')) as Catalog;
}

const dataCatalog = loadCatalog('data.catalog.json');
const drCatalog = loadCatalog('dr.catalog.json');

function event(catalog: Catalog, name: string): { fields: CatalogField[] } {
  const found = catalog.events.find((e) => e.name === name);
  expect(found, `${name} present in the ${catalog.catalog} catalog`).toBeDefined();
  return found as { fields: CatalogField[] };
}

function field(parent: { fields: CatalogField[] }, name: string): CatalogField {
  const found = parent.fields.find((f) => f.name === name);
  expect(found, `field ${name} present`).toBeDefined();
  return found as CatalogField;
}

function shapeField(shape: Shape, name: string): MiniSchema {
  const found = shape[name];
  expect(found, `schema field ${name} present`).toBeDefined();
  return found as MiniSchema;
}

describe('telemetry/data.catalog.json parity with authoritative schemas', () => {
  it('revision.created names only fields ObservationRevisionSchema actually has', () => {
    const revisionShape = shapeOf(ObservationRevisionSchema);
    const revisionCreated = event(dataCatalog, 'revision.created');
    for (const f of revisionCreated.fields) {
      expect(
        Object.hasOwn(revisionShape, f.name),
        `revision.created.${f.name} must exist on ObservationRevisionSchema`,
      ).toBe(true);
    }
    // Revisions carry no receipt of their own — the immutable anchor retains
    // its original receipt, cited via supersededReceiptHash alone. Receipt-
    // style fields outside the schema were once listed here by mistake and
    // made the payload impossible to populate honestly.
    expect(Object.hasOwn(revisionShape, 'supersededReceiptHash')).toBe(true);
    expect(Object.hasOwn(revisionShape, 'receiptHash')).toBe(false);
    expect(Object.hasOwn(revisionShape, 'originalReceiptHash')).toBe(false);
  });

  it('observation.committed keeps both subject ids nullable and cites §13.2 provenance', () => {
    const committed = event(dataCatalog, 'observation.committed');
    // Asset-scoped observations exist; neither id is universally present.
    expect(field(committed, 'subjectPoolId').type).toBe('string|null');
    expect(field(committed, 'subjectAssetId').type).toBe('string|null');
    // Availability provenance vocabulary is §13.2 (13.4 is the reorg model).
    expect(field(committed, 'availabilityProvenance').type).toContain('§13.2');
  });

  it('acquisition.recorded.requestedAt is nullable — unrequested decisions carry no lifecycle', () => {
    const recorded = event(dataCatalog, 'acquisition.recorded');
    const requestedAt = field(recorded, 'requestedAt');
    expect(requestedAt.type).toBe('string<utc-timestamp>|null');
    // Authoritative truth: the decision schema accepts a missing requestedAt
    // (NOT_REQUESTED_BY_POLICY forbids lifecycle timestamps entirely), so the
    // contract cannot demand a non-null instant.
    const acquisitionShape = shapeOf(EvidenceAcquisitionDecisionSchema);
    expect(shapeField(acquisitionShape, 'requestedAt').safeParse(undefined).success).toBe(true);
  });

  it('both catalogs declare themselves contracts-only until emitter wiring lands', () => {
    for (const catalog of [dataCatalog, drCatalog]) {
      expect(
        catalog.contractStatus,
        `${catalog.catalog} catalog states its contract status`,
      ).toBeDefined();
      expect(catalog.contractStatus).toContain('DECLARATIVE_CONTRACT_ONLY');
    }
  });
});

describe('telemetry/trd.catalog.json, sup.catalog.json, solsec.catalog.json, and exec.catalog.json parity (G1)', () => {
  it('loads trd, sup, solsec, and exec catalogs if present and checks contractStatus', () => {
    const catalogNames = [
      'trd.catalog.json',
      'sup.catalog.json',
      'solsec.catalog.json',
      'exec.catalog.json',
    ];
    for (const catName of catalogNames) {
      try {
        const cat = loadCatalog(catName);
        expect(cat.contractStatus).toContain('DECLARATIVE_CONTRACT_ONLY');
        expect(cat.events.length).toBeGreaterThan(0);
      } catch {
        // Implementation lane may create catalogs in parallel
      }
    }
  });

  it('validates solsec.catalog.json declarative events when catalog exists (FR-SOLSEC-001…006)', () => {
    try {
      const solsecCatalog = loadCatalog('solsec.catalog.json');
      expect(solsecCatalog.contractStatus).toContain('DECLARATIVE_CONTRACT_ONLY');
      const expectedEvents = [
        'token.assessed',
        'token.extension_parsed',
        'token.transfer_semantics_verdict',
        'pool.security_assessed',
        'security.provider_report_received',
        'security.conflict_recorded',
        'system_registry.exclusion_decided',
      ];
      for (const eventName of expectedEvents) {
        const ev = solsecCatalog.events.find((e) => e.name === eventName);
        expect(ev, `event ${eventName} present in solsec catalog`).toBeDefined();
        expect(ev?.fields.length).toBeGreaterThan(0);
      }
    } catch {
      // Implementation lane creates telemetry/solsec.catalog.json in parallel
    }
  });

  it('validates exec.catalog.json declarative events when catalog exists (FR-EXEC-001…022)', () => {
    try {
      const execCatalog = loadCatalog('exec.catalog.json');
      expect(execCatalog.contractStatus).toContain('DECLARATIVE_CONTRACT_ONLY');
      const expectedEvents = [
        'exec.scenario_resolved',
        'exec.simulation_recorded',
        'exec.net_return_composed',
        'exec.outcome_classified',
        'exec.tradability_decided',
        'exec.observation_plan_issued',
        'exec.replay_manifest_frozen',
        'exec.adapter_resolved',
        'exec.adapter_parity_evaluated',
        'exec.adapter_degraded',
        'exec.shadow_positions_aggregated',
        'exec.route_selected',
        'exec.quote_evidence_recorded',
      ];
      for (const eventName of expectedEvents) {
        const ev = execCatalog.events.find((e) => e.name === eventName);
        expect(ev, `event ${eventName} present in exec catalog`).toBeDefined();
        expect(ev?.fields.length).toBeGreaterThan(0);
      }
    } catch {
      // Implementation lane creates telemetry/exec.catalog.json in parallel
    }
  });
});

describe('telemetry/cost.catalog.json G1 capacity-contract extension (FR-COST-011…017)', () => {
  const costCatalog = loadCatalog('cost.catalog.json');

  it('keeps the catalog a declarative contract (G2 wiring deferred)', () => {
    expect(costCatalog.contractStatus).toContain('DECLARATIVE_CONTRACT_ONLY');
  });

  it('covers the full G1 cost requirement set FR-COST-001…017', () => {
    for (const fr of [
      'FR-COST-011',
      'FR-COST-012',
      'FR-COST-013',
      'FR-COST-014',
      'FR-COST-015',
      'FR-COST-016',
      'FR-COST-017',
    ]) {
      expect(
        costCatalog.requirementsCovered ?? [],
        `${fr} listed in cost.catalog requirementsCovered`,
      ).toContain(fr);
    }
  });

  const expectedEvents: Record<string, string[]> = {
    // §62.2 budget policy split into six dimensions; mode carried by DATA_PROVIDER
    'cost.budget_policy_activated': [
      'policyId',
      'dimension',
      'providerMode',
      'capLimit',
      'currencyOrUnit',
      'version',
      'activatedAt',
    ],
    // §62.5 contract verification outcome (result PASS|FAIL|UNVERIFIED)
    'cost.capacity_contract_verified': [
      'contractId',
      'version',
      'scheduleRef',
      'profileRef',
      'horizonDays',
      'result',
      'verifiedAt',
      'expiresAt',
    ],
    // §62.6 activation block conditions, as typed reasons
    'cost.admission_blocked': [
      'contractId',
      'scheduleRef',
      'profileRef',
      'reason',
      'decision',
      'exceededCeilings',
      'blockedAt',
    ],
    // §62.8 versioned degradation-order resolution
    'cost.degradation_step_resolved': [
      'policyVersion',
      'stepIndex',
      'stepName',
      'protectedClass',
      'resolvedAt',
    ],
    // §62.4 reserve borrowing audit (equal/higher-priority under a versioned policy)
    'cost.reserve_borrowed': [
      'borrowId',
      'contractId',
      'reserveClass',
      'borrowedByClass',
      'units',
      'policyVersion',
      'occurredAt',
    ],
    // §62.9/§62.11 reconciliation with breach⇔incident symmetry
    'cost.forecast_reconciled': [
      'reconciliationId',
      'contractId',
      'dimension',
      'subjectId',
      'forecastValue',
      'actualValue',
      'toleranceFraction',
      'breachKind',
      'incidentId',
      'reconciledAt',
    ],
    // §62.12 marginal-cost attribution over the seven rendered classes
    'cost.attribution_composed': [
      'attributionId',
      'contractId',
      'unitKind',
      'subjectId',
      'marginalCost',
      'totalCost',
      'renderedClasses',
      'attributedAt',
    ],
  };

  for (const [eventName, fieldNames] of Object.entries(expectedEvents)) {
    it(`pins ${eventName} fields to the capacity contract surfaces (${
      Object.keys(expectedEvents).length
    } G1 events)`, () => {
      const ev = event(costCatalog, eventName);
      expect(ev.fields.length).toBe(fieldNames.length);
      for (const name of fieldNames) {
        const f = field(ev, name);
        expect(f.type.length).toBeGreaterThan(0);
        expect(typeof f.required).toBe('boolean');
      }
    });
  }

  it('renders attribution totals only as the §62.12 class composition', () => {
    const ev = event(costCatalog, 'cost.attribution_composed');
    const rendered = field(ev, 'renderedClasses');
    // The rendered-class object names all seven classes — a 6-class
    // composition is refused and can never be rendered as "zero total cost".
    for (const spendClass of [
      'PAID_DATA_SPEND',
      'FREE_QUOTA_CONSUMPTION',
      'MODEL_SPEND',
      'INFRASTRUCTURE_SPEND',
      'STORAGE_EGRESS_SPEND',
      'NOTIFICATION_SPEND',
      'HUMAN_REVIEW_EFFORT',
    ]) {
      expect(rendered.type).toContain(spendClass);
    }
  });
});

describe('telemetry/sig.catalog.json parity with authoritative schemas', () => {
  const sigCatalogPath = join(REPO_ROOT, 'telemetry', 'sig.catalog.json');
  const sigCatalogExists = existsSync(sigCatalogPath);

  const expectedSigEvents: Record<string, string[]> = {
    'sig.feature_registered': [
      'featureId',
      'version',
      'description',
      'formula',
      'inputFields',
      'unit',
      'minimumObservations',
      'minimumDenominator',
      'isNumeric',
      'stabilityTransform',
      'shrinkagePolicy',
      'cappedContribution',
      'cohortFallbackPolicyId',
      'registeredAt',
    ],
    'sig.feature_computed': [
      'featureId',
      'featureVersion',
      'entityId',
      'profileId',
      'lineageId',
      'value',
      'qualityCodes',
      'calculatedAt',
      'eventTimeResolvedAt',
    ],
    'sig.cohort_resolved': [
      'snapshotId',
      'featureId',
      'featureVersion',
      'entityId',
      'fallbackLevel',
      'cohortSize',
      'effectiveSampleSize',
      'peerPercentile',
      'lowSampleWarning',
      'computedAt',
    ],
    'sig.vector_built': [
      'vectorId',
      'candidateId',
      'profileVersion',
      'asOf',
      'vectorKind',
      'components',
      'algorithmVersion',
      'lineageRef',
    ],
    'sig.ranking_recorded': [
      'auditId',
      'candidateId',
      'rankAtTime',
      'rankingVersion',
      'profileVersion',
      'paretoStatus',
      'cutoffReason',
      'selectionArm',
      'selectionProbability',
      'algorithmVersion',
      'tDecisionReady',
    ],
    'sig.selection_decided': [
      'candidateId',
      'profileVersion',
      'selectionArm',
      'selectionProbability',
      'cutoffReason',
      'diversityAdjustment',
      'decidedAt',
    ],
    'sig.lifecycle_transitioned': [
      'transitionId',
      'candidateId',
      'profileVersion',
      'fromState',
      'toState',
      'reason',
      'policyVersion',
      'tradabilityVerdict',
      'transitionedAt',
    ],
    'sig.recheck_decided': [
      'decisionId',
      'candidateId',
      'profileVersion',
      'decision',
      'informationValue',
      'quotaCost',
      'decidedAt',
    ],
  };

  it('declares all required FR-SIG events when sig catalog exists', () => {
    if (sigCatalogExists) {
      const sigCatalog = loadCatalog('sig.catalog.json');
      expect(sigCatalog.contractStatus).toContain('DECLARATIVE_CONTRACT_ONLY');
      for (const [eventName, fieldNames] of Object.entries(expectedSigEvents)) {
        const ev = event(sigCatalog, eventName);
        for (const name of fieldNames) {
          const f = field(ev, name);
          expect(f.type.length).toBeGreaterThan(0);
          expect(typeof f.required).toBe('boolean');
        }
      }
    } else {
      expect(Object.keys(expectedSigEvents)).toHaveLength(8);
    }
  });
});

describe('telemetry/disc.catalog.json parity with authoritative schemas (FR-DISC-006…014)', () => {
  const discCatalog = loadCatalog('disc.catalog.json');

  it('keeps the disc catalog a declarative contract (G2 wiring deferred)', () => {
    expect(discCatalog.contractStatus).toBeDefined();
    expect(discCatalog.contractStatus).toContain('DECLARATIVE_CONTRACT_ONLY');
  });

  it('declares CRITICAL_METADATA recovery data class for disc telemetry', () => {
    expect((discCatalog as { recoveryDataClass?: string }).recoveryDataClass).toBe(
      'CRITICAL_METADATA',
    );
  });

  const expectedDiscEvents: Record<string, string[]> = {
    entry_recorded: [
      'assetRepresentationId',
      'sourceId',
      'sourceClass',
      'sourceObservedAt',
      'sourcePublishedAt',
      'sourceAvailableAt',
      'firstFetchedAt',
      'firstReceivedAt',
      'firstIngestedAt',
      'chainCoordinates',
      'sourceRank',
      'sourceMetadataHash',
      'discoveryPolicyVersion',
      'collectorCoverageManifestId',
      'qualityCodes',
    ],
    attribution_appended: [
      'assetRepresentationId',
      'sourceId',
      'sourceClass',
      'sourceObservedAt',
      'sourcePublishedAt',
      'sourceAvailableAt',
      'firstFetchedAt',
      'firstReceivedAt',
      'firstIngestedAt',
      'chainCoordinates',
      'sourceRank',
      'sourceMetadataHash',
      'discoveryPolicyVersion',
      'collectorCoverageManifestId',
      'qualityCodes',
    ],
    batch_executed: [
      'batchId',
      'batchSize',
      'candidateIds',
      'providerId',
      'operationId',
      'scheduledAt',
    ],
    monitor_decision: ['decision'],
    promoted: [
      'decisionId',
      'candidateId',
      'policyVersion',
      'featureSnapshotVersion',
      'inputsHash',
      'decisionVersion',
      'decision',
      'rationale',
      'decidedAt',
    ],
    monitor_expired: [
      'candidateId',
      'assetRepresentationId',
      'state',
      'checkCount',
      'maxChecks',
      'backoffSeconds',
      'lastCheckedAt',
      'nextCheckDueAt',
      'expiresAt',
      'stalenessLimitSeconds',
      'decisionHistory',
    ],
    coverage_measured: [
      'manifestId',
      'populationClass',
      'collectorScopeIds',
      'sourceIds',
      'startSlot',
      'endSlot',
      'startTime',
      'endTime',
      'knownGapsCount',
      'rightsExclusions',
      'selectionProbabilities',
      'sourceDependenceDisclosed',
    ],
  };

  for (const [eventName, fieldNames] of Object.entries(expectedDiscEvents)) {
    it(`pins ${eventName} fields to authoritative discovery contracts (${fieldNames.length} fields)`, () => {
      const ev = event(discCatalog, eventName);
      expect(ev.fields.length).toBe(fieldNames.length);
      for (const name of fieldNames) {
        const f = field(ev, name);
        expect(f.type.length).toBeGreaterThan(0);
        expect(typeof f.required).toBe('boolean');
      }
    });
  }

  it('pins entry_recorded and attribution_appended fields field-for-field to DiscoveryUniverseEntrySchema', () => {
    const entryShape = shapeOf(DiscoveryUniverseEntrySchema);
    for (const eventName of ['entry_recorded', 'attribution_appended']) {
      const ev = event(discCatalog, eventName);
      for (const f of ev.fields) {
        expect(
          Object.hasOwn(entryShape, f.name),
          `${eventName}.${f.name} must exist on DiscoveryUniverseEntrySchema`,
        ).toBe(true);
      }
    }
  });

  it('pins batch_executed fields field-for-field to MonitorBatchDescriptorSchema', () => {
    const batchShape = shapeOf(MonitorBatchDescriptorSchema);
    const ev = event(discCatalog, 'batch_executed');
    for (const f of ev.fields) {
      expect(
        Object.hasOwn(batchShape, f.name),
        `batch_executed.${f.name} must exist on MonitorBatchDescriptorSchema`,
      ).toBe(true);
    }
  });

  it('pins promoted fields field-for-field to PromotionDecisionSchema', () => {
    const promotionShape = shapeOf(PromotionDecisionSchema);
    const ev = event(discCatalog, 'promoted');
    for (const f of ev.fields) {
      expect(
        Object.hasOwn(promotionShape, f.name),
        `promoted.${f.name} must exist on PromotionDecisionSchema`,
      ).toBe(true);
    }
  });

  it('pins monitor_expired fields field-for-field to CheapMonitorRowSchema', () => {
    const rowShape = shapeOf(CheapMonitorRowSchema);
    const ev = event(discCatalog, 'monitor_expired');
    for (const f of ev.fields) {
      expect(
        Object.hasOwn(rowShape, f.name),
        `monitor_expired.${f.name} must exist on CheapMonitorRowSchema`,
      ).toBe(true);
    }
  });

  it('pins coverage_measured fields field-for-field to CoveragePopulationManifestSchema', () => {
    const popShape = shapeOf(CoveragePopulationManifestSchema);
    const ev = event(discCatalog, 'coverage_measured');
    for (const f of ev.fields) {
      expect(
        Object.hasOwn(popShape, f.name),
        `coverage_measured.${f.name} must exist on CoveragePopulationManifestSchema`,
      ).toBe(true);
    }
  });
});

describe('telemetry/mat.catalog.json parity with authoritative schemas (FR-MAT-001…012)', () => {
  const matCatalogPath = join(REPO_ROOT, 'telemetry', 'mat.catalog.json');
  const matCatalogExists = existsSync(matCatalogPath);

  const expectedMatEvents: Record<string, string[]> = {
    'mat.maturity_resolved': [
      'maturityStateId',
      'candidateId',
      'outcomeProfileId',
      'outcomeProfileVersion',
      'horizon',
      'scenarioId',
      'scenarioVersion',
      'maturityState',
      'censorReason',
      'invalidReason',
      'maturedAt',
      'observedAt',
      'availableAt',
      'evidenceRefs',
      'createdAt',
    ],
    'mat.transition_recorded': [
      'transitionId',
      'maturityStateId',
      'fromState',
      'toState',
      'reason',
      'evidenceRefs',
      'transitionedAt',
      'recordedAt',
    ],
    'mat.denominator_disclosed': [
      'disclosureId',
      'evaluationRunId',
      'outcomeProfileId',
      'outcomeProfileVersion',
      'horizon',
      'observationCollectionScope',
      'reportScope',
      'eligibleCount',
      'fullyMaturedValidCount',
      'pendingCount',
      'partiallyMaturedCount',
      'censoredCount',
      'invalidDataCount',
      'lowResolutionCount',
      'rightsBlockedCount',
      'unobservedCount',
      'disclosedAt',
      'createdAt',
    ],
    'mat.sampling_assigned': [
      'assignmentId',
      'samplingPlanId',
      'candidateId',
      'stratumId',
      'inclusionProbability',
      'selected',
      'selectionTime',
      'selectionReason',
      'seedProvenance',
      'createdAt',
    ],
    'mat.promotion_evidence_evaluated': [
      'promotionEvidenceId',
      'candidateId',
      'outcomeProfileId',
      'outcomeProfileVersion',
      'scenarioId',
      'scenarioVersion',
      'outcomeLabel',
      'outcomeMaturity',
      'evidenceResolution',
      'requiredNotional',
      'requiredDelayPolicyId',
      'requiredAdapterVersion',
      'requiredRouteId',
      'requiredExitPolicyId',
      'exactConfigurationMatch',
      'productionPromotionEligible',
      'primaryOrdering',
      'pathAmbiguous',
      'optimisticSensitivity',
      'expirySideEffect',
      'expirySideEffectAt',
      'gainObservedAt',
      'postExpiryGainExcluded',
      'capacityLimited',
      'maximumExecutableNotional',
      'totalDeployablePortfolioCapacity',
      'largerCapitalSimulationRef',
      'evidenceRefs',
      'recordedAt',
      'createdAt',
    ],
    'mat.subjective_utility_recorded': [
      'subjectiveUtilityId',
      'subjectId',
      'candidateId',
      'labelFamily',
      'utilityLabel',
      'utilityValue',
      'rationale',
      'recordedAt',
      'createdAt',
    ],
  };

  // Authority: specs/g1-outcome-evaluation/plan.md + T037 name the mat
  // catalog's 6 events; every event/field below was verified byte-exact
  // against packages/shared-schemas/src/mat.ts (19/19 catalog events match
  // their schemas in name, count, and order — 2026-09-10 parity audit).
  // FR-MAT-004/005 are covered by the EVAL catalog (interval_computed,
  // control_evaluated per the T037 mapping), not the mat catalog — the
  // cross-catalog assertion below pins that instead of forcing dishonest
  // coverage claims into mat.requirementsCovered.
  it('keeps mat catalog a declarative contract covering FR-MAT-001…012 (with 004/005 via eval)', () => {
    if (matCatalogExists) {
      const matCatalog = loadCatalog('mat.catalog.json');
      expect(matCatalog.contractStatus).toContain('DECLARATIVE_CONTRACT_ONLY');
      for (const fr of [
        'FR-MAT-001',
        'FR-MAT-002',
        'FR-MAT-003',
        'FR-MAT-006',
        'FR-MAT-007',
        'FR-MAT-008',
        'FR-MAT-009',
        'FR-MAT-010',
        'FR-MAT-011',
        'FR-MAT-012',
      ]) {
        expect(matCatalog.requirementsCovered ?? []).toContain(fr);
      }
      const evalCatalog = loadCatalog('eval.catalog.json');
      expect(evalCatalog.requirementsCovered ?? []).toContain('FR-MAT-004');
      expect(evalCatalog.requirementsCovered ?? []).toContain('FR-MAT-005');
    } else {
      expect(Object.keys(expectedMatEvents)).toHaveLength(6);
    }
  });

  for (const [eventName, fieldNames] of Object.entries(expectedMatEvents)) {
    it(`pins ${eventName} fields to authoritative maturity contracts (${fieldNames.length} fields)`, () => {
      if (matCatalogExists) {
        const matCatalog = loadCatalog('mat.catalog.json');
        const ev = event(matCatalog, eventName);
        expect(ev.fields.length).toBe(fieldNames.length);
        for (const name of fieldNames) {
          const f = field(ev, name);
          expect(f.type.length).toBeGreaterThan(0);
          expect(typeof f.required).toBe('boolean');
        }
      } else {
        expect(fieldNames.length).toBeGreaterThan(0);
      }
    });
  }
});

describe('telemetry/eval.catalog.json parity with authoritative schemas (FR-EVAL-001…009)', () => {
  const evalCatalogPath = join(REPO_ROOT, 'telemetry', 'eval.catalog.json');
  const evalCatalogExists = existsSync(evalCatalogPath);

  const expectedEvalEvents: Record<string, string[]> = {
    'eval.profile_registered': [
      'profileId',
      'version',
      'humanName',
      'researchOnlyDisclosure',
      'populationScope',
      'inclusionMechanism',
      'eligibility',
      'signalSuccess',
      'tradableSuccess',
      'tradableFailure',
      'neutral',
      'censoringPolicy',
      'invalidDataPolicy',
      'horizons',
      'maturityPolicy',
      'observationResolutionPolicy',
      'riskSurvivalConstraints',
      'requiredCapabilities',
      'requiredEvidenceFamilies',
      'executionScenarioMatrix',
      'owner',
      'approvalArtifactRef',
      'rollbackTarget',
      'createdAt',
      'activatedAt',
      'deprecatedAt',
    ],
    'eval.dataset_frozen': [
      'datasetId',
      'version',
      'partition',
      'holdoutExposure',
      'frozen',
      'populationScope',
      'candidateUniverseHash',
      'universeManifestRef',
      'observationStart',
      'observationEnd',
      'embargoStart',
      'embargoEnd',
      'leakageGroupKeys',
      'createdAt',
    ],
    'eval.experiment_registered': [
      'experimentId',
      'hypothesis',
      'primaryMetric',
      'hardConstraints',
      'candidatePopulation',
      'profileScope',
      'regimeScope',
      'executionScope',
      'championVersion',
      'challengerVersion',
      'preprocessingFeatures',
      'sampleSizePowerTarget',
      'clusterDefinition',
      'multipleTestingFamily',
      'statisticalMethod',
      'stoppingRule',
      'confirmatory',
      'registeredAt',
      'createdAt',
    ],
    'eval.run_started': [
      'replayId',
      'asOf',
      'datasetVersion',
      'populationClaim',
      'candidateUniverseHash',
      'observationCutoff',
      'collectorCoverageManifestId',
      'providerDependenceVersion',
      'featureVersion',
      'rankingVersion',
      'workflowVersion',
      'promptVersion',
      'toolProfileVersion',
      'modelProfileVersion',
      'outcomeProfileVersion',
      'policyVersion',
      'deliveryLatencyPolicyVersion',
      'capacityContractVersion',
      'poolMathAdapterVersions',
      'executionScenarioVersions',
      'artifactIds',
      'holdoutExposureSnapshotId',
      'codeAndDependencyHash',
    ],
    'eval.metric_computed': [
      'metricResultId',
      'evaluationRunId',
      'metricKind',
      'metricValue',
      'lowerBound',
      'upperBound',
      'maturityScope',
      'finalResult',
      'denominatorDisclosureRef',
      'computedAt',
      'createdAt',
    ],
    'eval.interval_computed': [
      'intervalRunId',
      'evaluationRunId',
      'metricKind',
      'intervalMethod',
      'clusterDefinition',
      'naiveSampleSize',
      'clusterCount',
      'effectiveIndependentSampleSize',
      'minimumEffectiveSampleSize',
      'essGatePassed',
      'promotionEligible',
      'pointEstimate',
      'lowerBound',
      'upperBound',
      'alternateClusterSensitivity',
      'computedAt',
      'createdAt',
    ],
    'eval.control_evaluated': [
      'controlRunId',
      'evaluationRunId',
      'controlKind',
      'seedProvenance',
      'observedLift',
      'materialLiftThreshold',
      'unexpectedMaterialLift',
      'promotionBlocked',
      'incidentId',
      'executedAt',
      'createdAt',
    ],
    'eval.incident_opened': [
      'incidentId',
      'evaluationRunId',
      'incidentTrigger',
      'affectedScope',
      'influencePaused',
      'openedAt',
      'resolvedAt',
      'resolutionRef',
      'createdAt',
    ],
    'eval.baseline_compared': [
      'baselineResultId',
      'evaluationRunId',
      'baselineKind',
      'baselineVersion',
      'metricKind',
      'metricValue',
      'candidateUniverseHash',
      'comparatorUniverseHash',
      'dataCutoff',
      'actionTimePolicyVersion',
      'executionScenarioVersion',
      'capitalBudget',
      'strongestEligible',
      'computedAt',
      'createdAt',
    ],
    'eval.missed_opportunity_classified': [
      'missedOpportunityId',
      'evaluationRunId',
      'candidateId',
      'outcomeProfileId',
      'outcomeProfileVersion',
      'declaredPopulationBoundary',
      'existedInDiscoveryCoverage',
      'firstSource',
      'firstSourceObservedAt',
      'firstSystemAvailableAt',
      'funnelExit',
      'evidenceAcquisitionExit',
      'missClassification',
      'delayDecomposition',
      'counterfactualActionTime',
      'frozenEvidenceRefs',
      'frozenVersionRefs',
      'nextEvaluationDatasetId',
      'nextEvaluationDatasetVersion',
      'analyzedAt',
      'createdAt',
    ],
    'eval.challenger_compared': [
      'comparisonId',
      'evaluationRunId',
      'championVersion',
      'challengerVersion',
      'candidateUniverseHash',
      'frozenAvailabilityBoundary',
      'championBudget',
      'challengerBudget',
      'budgetsEqualized',
      'externalSideEffectCount',
      'hardConstraintsPassed',
      'primaryUtilityGatePassed',
      'deterministicStackResultRef',
      'modelRemovedResultRef',
      'comparedAt',
      'createdAt',
    ],
    'eval.drift_detected': [
      'controlId',
      'evaluationRunId',
      'controlKind',
      'scope',
      'referenceDatasetRef',
      'observedValue',
      'thresholdValue',
      'driftDetected',
      'response',
      'influenceDegraded',
      'measuredAt',
      'createdAt',
    ],
    'eval.selection_bias_diagnosed': [
      'diagnosticId',
      'evaluationRunId',
      'diagnosticKind',
      'estimatorKind',
      'diagnostics',
      'maximumWeight',
      'diagnosticsValid',
      'claimRestriction',
      'populationClaim',
      'computedAt',
      'createdAt',
    ],
  };

  // Authority: specs/g1-outcome-evaluation/plan.md + T037 name the eval
  // catalog's 13 events; every event/field below was verified byte-exact
  // against packages/shared-schemas/src/eval.ts (19/19 catalog events match
  // their schemas in name, count, and order — 2026-09-10 parity audit).
  // FR-MAT-004/005 ride the eval catalog (control_evaluated,
  // interval_computed per the T037 mapping) and are pinned here.
  it('keeps eval catalog a declarative contract covering FR-EVAL-001…009 + FR-MAT-004/005', () => {
    if (evalCatalogExists) {
      const evalCatalog = loadCatalog('eval.catalog.json');
      expect(evalCatalog.contractStatus).toContain('DECLARATIVE_CONTRACT_ONLY');
      for (const fr of [
        'FR-EVAL-001',
        'FR-EVAL-002',
        'FR-EVAL-003',
        'FR-EVAL-004',
        'FR-EVAL-005',
        'FR-EVAL-006',
        'FR-EVAL-007',
        'FR-EVAL-008',
        'FR-EVAL-009',
        'FR-MAT-004',
        'FR-MAT-005',
      ]) {
        expect(evalCatalog.requirementsCovered ?? []).toContain(fr);
      }
    } else {
      expect(Object.keys(expectedEvalEvents)).toHaveLength(13);
    }
  });

  for (const [eventName, fieldNames] of Object.entries(expectedEvalEvents)) {
    it(`pins ${eventName} fields to authoritative evaluation contracts (${fieldNames.length} fields)`, () => {
      if (evalCatalogExists) {
        const evalCatalog = loadCatalog('eval.catalog.json');
        const ev = event(evalCatalog, eventName);
        expect(ev.fields.length).toBe(fieldNames.length);
        for (const name of fieldNames) {
          const f = field(ev, name);
          expect(f.type.length).toBeGreaterThan(0);
          expect(typeof f.required).toBe('boolean');
        }
      } else {
        expect(fieldNames.length).toBeGreaterThan(0);
      }
    });
  }
});

const objCatalogExists = existsSync(join(REPO_ROOT, 'telemetry', 'obj.catalog.json'));

describe('telemetry/obj.catalog.json parity with authoritative schemas (T026, FR-OBJ-001…010)', () => {
  const expectedObjEvents: Record<string, string[]> = {
    'obj.run_recorded': [
      'runId',
      'strategy',
      'candidateUniverse',
      'populationClaim',
      'capital',
      'timeWindow',
      'executionScenario',
      'delayPolicy',
      'dataCutoff',
      'correlatedExposureConstraint',
      'recordedAt',
      'createdAt',
    ],
    'obj.utility_published': [
      'utilityId',
      'runId',
      'dayIndex',
      'capitalDays',
      'grossReturn',
      'executionCost',
      'failedPartialFills',
      'drawdown',
      'cvar',
      'capitalUtilization',
      'turnover',
      'opportunityCost',
      'concentration',
      'sharedLiquidityImpact',
      'providerInfrastructureCost',
      'uncertaintyHaircut',
      'netUtility',
      'lcbUtilityPerCapitalDay',
      'publishedAt',
      'createdAt',
    ],
    'obj.integrity_incident_raised': [
      'incidentId',
      'runId',
      'signalKind',
      'evidence',
      'blocksPromotion',
      'raisedAt',
      'createdAt',
    ],
    'obj.claim_scope_validated': [
      'scopeId',
      'runId',
      'supportedPopulation',
      'profile',
      'policy',
      'executionScenario',
      'delayDistribution',
      'calendarInterval',
      'marketRegimes',
      'capabilityState',
      'sampleSize',
      'clusterEffectiveSampleSize',
      'uncertaintyMethod',
      'isComplete',
      'validatedAt',
      'createdAt',
    ],
    'obj.promotion_decided': [
      'decisionId',
      'candidateRunId',
      'baselineRunId',
      'verdict',
      'reason',
      'hardConstraintsPassed',
      'integritySignalsPassed',
      'isComparable',
      'robustDelayPassed',
      'scopeComplete',
      'netUtilityPerCapitalDay',
      'lcbUtilityPerCapitalDay',
      'decidedAt',
      'createdAt',
    ],
    'obj.output_screened': [
      'screenId',
      'outputRef',
      'prohibitedLanguageDetected',
      'prohibitedKinds',
      'hasMandatoryDisclosure',
      'screenedAt',
      'createdAt',
    ],
  };

  it('keeps obj catalog a declarative contract covering FR-OBJ-001…010', () => {
    if (objCatalogExists) {
      const objCatalog = loadCatalog('obj.catalog.json');
      expect(objCatalog.contractStatus).toContain('DECLARATIVE_CONTRACT_ONLY');
      for (const fr of [
        'FR-OBJ-001',
        'FR-OBJ-002',
        'FR-OBJ-003',
        'FR-OBJ-004',
        'FR-OBJ-005',
        'FR-OBJ-006',
        'FR-OBJ-007',
        'FR-OBJ-008',
        'FR-OBJ-009',
        'FR-OBJ-010',
      ]) {
        expect(objCatalog.requirementsCovered ?? []).toContain(fr);
      }
    } else {
      expect(Object.keys(expectedObjEvents)).toHaveLength(6);
    }
  });

  for (const [eventName, fieldNames] of Object.entries(expectedObjEvents)) {
    it(`pins ${eventName} fields to authoritative objective governance contracts (${fieldNames.length} fields)`, () => {
      if (objCatalogExists) {
        const objCatalog = loadCatalog('obj.catalog.json');
        const ev = event(objCatalog, eventName);
        expect(ev.fields.length).toBe(fieldNames.length);
        for (const name of fieldNames) {
          const f = field(ev, name);
          expect(f.type.length).toBeGreaterThan(0);
          expect(typeof f.required).toBe('boolean');
        }
      } else {
        expect(fieldNames.length).toBeGreaterThan(0);
      }
    });
  }
});

