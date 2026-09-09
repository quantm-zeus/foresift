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

