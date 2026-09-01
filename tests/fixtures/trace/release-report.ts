/**
 * Release report and SBOM fixtures for FR-TRACE-006 / AC-269 testing.
 */

export interface SbomComponent {
  readonly name: string;
  readonly version: string;
  readonly integrity: string;
  readonly type: 'npm' | 'workspace';
}

export interface SbomProjection {
  readonly bomFormat: 'CycloneDX';
  readonly specVersion: '1.5';
  readonly components: readonly SbomComponent[];
  readonly inventoryHash: string;
}

export interface ReleaseReportRecord {
  readonly reportId: string;
  readonly documentHash: string;
  readonly manifestHash: string;
  readonly normalizedHash: string;
  readonly migrationHashes: Record<string, string>;
  readonly schemaHashes: Record<string, string>;
  readonly dependencySbomHash: string;
  readonly conformanceResults: {
    readonly overall: 'PASSED' | 'FAILED';
    readonly totalRulesEvaluated: number;
    readonly passedCount: number;
    readonly failureCount: number;
    readonly findings: readonly {
      readonly requirementId: string;
      readonly rule: string;
      readonly path: string;
      readonly message: string;
    }[];
  };
  readonly unresolvedDeviations: readonly {
    readonly id: string;
    readonly rule: string;
    readonly path: string;
    readonly justification: string;
    readonly expiryDate?: string;
  }[];
  readonly activationState: {
    readonly milestone: string;
    readonly status: 'ACTIVE' | 'BLOCKED' | 'PENDING';
    readonly activeGroups: readonly string[];
    readonly gatesPassed: readonly string[];
  };
  readonly rollbackTarget: {
    readonly previousReportId: string;
    readonly previousDocumentHash: string;
    readonly previousManifestHash: string;
  };
  readonly generatedAt: string;
}

export const VALID_SBOM_FIXTURE: SbomProjection = {
  bomFormat: 'CycloneDX',
  specVersion: '1.5',
  components: [
    {
      name: '@electric-sql/pglite',
      version: '0.2.14',
      integrity: 'sha512-mock-pglite-integrity-hash',
      type: 'npm',
    },
    {
      name: 'zod',
      version: '3.23.8',
      integrity: 'sha512-mock-zod-integrity-hash',
      type: 'npm',
    },
  ],
  inventoryHash: 'd7a8fbb984d412e697b0a79e49a26a575a6c62c2f16b2512f458e0a8ff242bc6',
};

export const VALID_RELEASE_REPORT_FIXTURE: ReleaseReportRecord = {
  reportId: 'rel-report-v6.0.0-g0',
  documentHash: 'baa521d9c67e67a86d7ddb111c793b67462ed4c7acc89cec34ab9f5ade077299',
  manifestHash: 'e0f9f1284473fe097fde591138d16984ae8580feaf13333e22594717eec690ff',
  normalizedHash: '1f9b6590c8331dd52ae63c51a93e8e6b631b3a70c37df3e619486e1779e2db8e',
  migrationHashes: {
    'g0_trace_0001_trace_schema.sql':
      'sha256:1111111111111111111111111111111111111111111111111111111111111111',
    'g0_trace_0002_decision_traces.sql':
      'sha256:2222222222222222222222222222222222222222222222222222222222222222',
  },
  schemaHashes: {
    'packages/shared-schemas/src/trace.ts':
      'sha256:3333333333333333333333333333333333333333333333333333333333333333',
  },
  dependencySbomHash: 'd7a8fbb984d412e697b0a79e49a26a575a6c62c2f16b2512f458e0a8ff242bc6',
  conformanceResults: {
    overall: 'PASSED',
    totalRulesEvaluated: 12,
    passedCount: 12,
    failureCount: 0,
    findings: [],
  },
  unresolvedDeviations: [],
  activationState: {
    milestone: 'G0',
    status: 'ACTIVE',
    activeGroups: ['G0'],
    gatesPassed: ['gate:manual', 'gate:legal', 'gate:rights', 'gate:statistical', 'gate:owner'],
  },
  rollbackTarget: {
    previousReportId: 'rel-report-v5.9.0',
    previousDocumentHash: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    previousManifestHash: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
  },
  generatedAt: '2026-08-31T08:00:00.000Z',
};
