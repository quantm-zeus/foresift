/**
 * Accept/refuse matrices for the trace schema family (FR-TRACE-001…006, AC-265…269).
 * Every `.strict()` schema must refuse unknown keys fail-closed (ADR-0013).
 */
import { describe, expect, it } from 'bun:test';
import {
  TRACE_SCHEMA_REGISTRY_VERSION,
  TRACE_SCHEMAS,
  RequirementRefSchema,
  TraceIdPatternSchema,
  SupersessionLinkSchema,
  GateEvidenceRecordSchema,
  DecisionTraceRecordSchema,
  ReleaseReportRecordSchema,
  parseTraceSchema,
  type TraceSchemaName,
} from '../src/trace.ts';
import {
  VALID_GATE_RECORDS,
  VALID_DECISION_TRACE_RECORD,
  MISSING_DIMENSION_FIXTURES,
  VALID_RELEASE_REPORT_FIXTURE,
} from '../../../tests/fixtures/trace/index.ts';

describe('trace schema registry (FR-TRACE-001…006, ADR-0013)', () => {
  it('is versioned and registers all FR-TRACE schema names', () => {
    expect(TRACE_SCHEMA_REGISTRY_VERSION).toBe(1);
    expect(Object.keys(TRACE_SCHEMAS).sort()).toEqual(
      [
        'DecisionTraceRecord',
        'GateEvidenceRecord',
        'ReleaseReportRecord',
        'RequirementRef',
        'SupersessionLink',
        'TraceIdPattern',
      ].sort(),
    );
  });

  describe('parseTraceSchema helper', () => {
    it('parses valid payload successfully', () => {
      const parsed = parseTraceSchema('RequirementRef', 'FR-TRACE-001');
      expect(parsed).toBe('FR-TRACE-001');
    });

    it('refuses invalid input throwing an error', () => {
      expect(() => parseTraceSchema('RequirementRef', 'INVALID-FORMAT')).toThrow();
    });
  });

  describe('RequirementRefSchema (FR-TRACE-001, FR-TRACE-002)', () => {
    const validRefs = [
      'FR-TRACE-001',
      'FR-CORE-005',
      'FR-DATA-016',
      'AC-001',
      'AC-265',
      'AC-269',
      'INV-001',
      'INV-010',
      'ADR-0001',
      'ADR-0020',
    ];

    const invalidRefs = [
      'fr-trace-001',
      'AC-1',
      'AC-01',
      'INV-1',
      'ADR-1',
      'REQUIREMENT-1',
      'UNKNOWN',
      '',
      123,
      null,
      undefined,
    ];

    for (const ref of validRefs) {
      it(`accepts valid requirement/acceptance/invariant/adr ref: ${ref}`, () => {
        expect(RequirementRefSchema.safeParse(ref).success).toBe(true);
      });
    }

    for (const ref of invalidRefs) {
      it(`refuses invalid requirement ref: ${String(ref)}`, () => {
        expect(RequirementRefSchema.safeParse(ref).success).toBe(false);
      });
    }
  });

  describe('TraceIdPatternSchema (FR-TRACE-002)', () => {
    const validIds = [
      'feature:liquidity-v2',
      'schema:trace.decision_traces',
      'api:/api/v1/tools',
      'tool:analyze_solana_asset',
      'policy:risk-threshold',
      'artifact:sha256:baa521d9c67e67a86d7ddb111c793b67462ed4c7acc89cec34ab9f5ade077299',
      'test:AC-265.spec.ts',
    ];

    for (const id of validIds) {
      it(`accepts valid runtime ID pattern: ${id}`, () => {
        expect(TraceIdPatternSchema.safeParse(id).success).toBe(true);
      });
    }

    it('refuses empty or whitespace-only strings', () => {
      expect(TraceIdPatternSchema.safeParse('').success).toBe(false);
      expect(TraceIdPatternSchema.safeParse('   ').success).toBe(false);
    });
  });

  describe('SupersessionLinkSchema (FR-TRACE-002)', () => {
    const validLink = {
      replacedId: 'FR-OLD-001',
      supersededById: 'FR-NEW-001',
      namespace: 'requirement',
      recordedAt: '2026-08-31T08:00:00.000Z',
      reason: 'Replaced by split requirements in v6.0',
    };

    it('accepts valid supersession link payload', () => {
      expect(SupersessionLinkSchema.safeParse(validLink).success).toBe(true);
    });

    it('refuses missing replacedId or supersededById', () => {
      expect(
        SupersessionLinkSchema.safeParse({ ...validLink, replacedId: undefined }).success,
      ).toBe(false);
      expect(
        SupersessionLinkSchema.safeParse({ ...validLink, supersededById: undefined }).success,
      ).toBe(false);
    });

    it('refuses invalid namespace', () => {
      expect(
        SupersessionLinkSchema.safeParse({ ...validLink, namespace: 'unvetted_namespace' }).success,
      ).toBe(false);
    });

    it('refuses extra unknown keys (strict mode)', () => {
      expect(
        SupersessionLinkSchema.safeParse({ ...validLink, rogueKey: 'unauthorized' }).success,
      ).toBe(false);
    });
  });

  describe('GateEvidenceRecordSchema (FR-TRACE-004, AC-268)', () => {
    for (const [kind, record] of Object.entries(VALID_GATE_RECORDS)) {
      it(`accepts valid ${kind} gate evidence record`, () => {
        const result = GateEvidenceRecordSchema.safeParse(record);
        expect(result.success).toBe(true);
      });
    }

    it('refuses invalid payloadSha256 hash shape', () => {
      const invalid = {
        ...VALID_GATE_RECORDS.MANUAL,
        payloadSha256: 'not-a-sha256',
      };
      expect(GateEvidenceRecordSchema.safeParse(invalid).success).toBe(false);
    });

    it('refuses missing approver or scopeRefs', () => {
      expect(
        GateEvidenceRecordSchema.safeParse({ ...VALID_GATE_RECORDS.MANUAL, approver: undefined })
          .success,
      ).toBe(false);
      expect(
        GateEvidenceRecordSchema.safeParse({ ...VALID_GATE_RECORDS.MANUAL, scopeRefs: undefined })
          .success,
      ).toBe(false);
    });

    it('refuses empty scopeRefs array', () => {
      expect(
        GateEvidenceRecordSchema.safeParse({ ...VALID_GATE_RECORDS.MANUAL, scopeRefs: [] }).success,
      ).toBe(false);
    });

    it('refuses unknown keys (strict mode)', () => {
      expect(
        GateEvidenceRecordSchema.safeParse({ ...VALID_GATE_RECORDS.MANUAL, unvetted: true })
          .success,
      ).toBe(false);
    });
  });

  describe('DecisionTraceRecordSchema (FR-TRACE-005, AC-267)', () => {
    it('accepts complete decision trace record with all dimensions present', () => {
      const result = DecisionTraceRecordSchema.safeParse(VALID_DECISION_TRACE_RECORD);
      expect(result.success).toBe(true);
    });

    for (const [missingDim, fixture] of Object.entries(MISSING_DIMENSION_FIXTURES)) {
      it(`refuses decision trace missing required dimension: ${missingDim}`, () => {
        const result = DecisionTraceRecordSchema.safeParse(fixture);
        expect(result.success).toBe(false);
      });
    }

    it('refuses invalid manifestSha256 hash', () => {
      const invalid = {
        ...VALID_DECISION_TRACE_RECORD,
        manifestSha256: 'short-hash',
      };
      expect(DecisionTraceRecordSchema.safeParse(invalid).success).toBe(false);
    });

    it('refuses extra unknown keys (strict mode)', () => {
      expect(
        DecisionTraceRecordSchema.safeParse({
          ...VALID_DECISION_TRACE_RECORD,
          extraField: 'not-in-contract',
        }).success,
      ).toBe(false);
    });
  });

  describe('ReleaseReportRecordSchema (FR-TRACE-006, AC-269)', () => {
    it('accepts complete valid release report fixture', () => {
      const result = ReleaseReportRecordSchema.safeParse(VALID_RELEASE_REPORT_FIXTURE);
      expect(result.success).toBe(true);
    });

    it('refuses missing documentHash or manifestHash', () => {
      expect(
        ReleaseReportRecordSchema.safeParse({
          ...VALID_RELEASE_REPORT_FIXTURE,
          documentHash: undefined,
        }).success,
      ).toBe(false);
      expect(
        ReleaseReportRecordSchema.safeParse({
          ...VALID_RELEASE_REPORT_FIXTURE,
          manifestHash: undefined,
        }).success,
      ).toBe(false);
    });

    it('refuses missing activationState or rollbackTarget', () => {
      expect(
        ReleaseReportRecordSchema.safeParse({
          ...VALID_RELEASE_REPORT_FIXTURE,
          activationState: undefined,
        }).success,
      ).toBe(false);
      expect(
        ReleaseReportRecordSchema.safeParse({
          ...VALID_RELEASE_REPORT_FIXTURE,
          rollbackTarget: undefined,
        }).success,
      ).toBe(false);
    });

    it('refuses unknown keys (strict mode)', () => {
      expect(
        ReleaseReportRecordSchema.safeParse({
          ...VALID_RELEASE_REPORT_FIXTURE,
          unknownMetadata: 'disallowed',
        }).success,
      ).toBe(false);
    });
  });

  describe('Table-driven .strict() unknown-key refusal across all registered schemas', () => {
    const validSamples: Record<TraceSchemaName, unknown> = {
      RequirementRef: 'FR-TRACE-001',
      TraceIdPattern: 'tool:analyze_solana_asset',
      SupersessionLink: {
        replacedId: 'FR-OLD-001',
        supersededById: 'FR-NEW-001',
        namespace: 'requirement',
        recordedAt: '2026-08-31T08:00:00.000Z',
        reason: 'Superseded',
      },
      GateEvidenceRecord: VALID_GATE_RECORDS.MANUAL,
      DecisionTraceRecord: VALID_DECISION_TRACE_RECORD,
      ReleaseReportRecord: VALID_RELEASE_REPORT_FIXTURE,
    };

    for (const [name, sample] of Object.entries(validSamples) as [TraceSchemaName, unknown][]) {
      it(`${name} refuses unvetted/unknown keys in strict mode`, () => {
        const schema = TRACE_SCHEMAS[name];
        if (typeof sample === 'object' && sample !== null && !Array.isArray(sample)) {
          const polluted = { ...sample, __unexpected_polluting_key__: 'must_fail' };
          expect(schema.safeParse(polluted).success).toBe(false);
        }
      });
    }
  });
});
