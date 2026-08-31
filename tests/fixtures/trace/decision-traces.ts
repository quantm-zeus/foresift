/**
 * Decision and alert trace fixtures for FR-TRACE-005 / AC-267 testing.
 */
import { createHash } from 'node:crypto';
import { canonicalJson } from './gate-evidence.ts';

export interface DecisionTraceRecord {
  readonly traceId: string;
  readonly decisionRef: string;
  readonly requirementIds: readonly string[];
  readonly policyVersions: Record<string, string>;
  readonly featureVersions: Record<string, string>;
  readonly modelVersions: Record<string, string>;
  readonly toolVersions: Record<string, string>;
  readonly providerVersions: Record<string, string>;
  readonly adapterVersions: Record<string, string>;
  readonly artifactVersions: Record<string, string>;
  readonly testReleaseId: string;
  readonly conformanceReleaseId: string;
  readonly manifestSha256: string;
  readonly releaseReportId: string;
  readonly recordedAt: string;
}

export function computeDecisionTraceId(
  input: Omit<DecisionTraceRecord, 'traceId'>,
): string {
  const content = canonicalJson(input);
  return 'trc-' + createHash('sha256').update(content).digest('hex');
}

export const VALID_DECISION_TRACE_INPUT: Omit<DecisionTraceRecord, 'traceId'> = {
  decisionRef: 'dec-solana-opportunity-20260831-001',
  requirementIds: ['FR-CORE-001', 'FR-AGT-001', 'FR-TRACE-005'],
  policyVersions: {
    'risk-threshold-policy': '1.0.0',
    'opportunity-scoring': '2.1.0',
  },
  featureVersions: {
    'liquidity-depth-solana': '1.3.0',
    'volume-delta-5m': '1.0.0',
  },
  modelVersions: {
    'claude-3-7-sonnet': '2026-02-24',
  },
  toolVersions: {
    'analyze_solana_asset': '1.0.0',
    'fetch_holder_distribution': '1.0.0',
  },
  providerVersions: {
    'helius-rpc': 'v0',
    'pump-portal': 'v1',
  },
  adapterVersions: {
    'solana-rpc-adapter': '1.2.0',
    'dex-amm-adapter': '1.1.0',
  },
  artifactVersions: {
    'golden-fixtures': 'sha256:7f3cd2c0ab955a2a53d658dfe5544c2e4817bc9efaecbe96cf51b0c032f2b855',
    'token-universe': 'sha256:baa521d9c67e67a86d7ddb111c793b67462ed4c7acc89cec34ab9f5ade077299',
  },
  testReleaseId: 'test-release-v6.0.0-rc1',
  conformanceReleaseId: 'conf-release-v6.0.0-rc1',
  manifestSha256: 'e0f9f1284473fe097fde591138d16984ae8580feaf13333e22594717eec690ff',
  releaseReportId: 'rel-report-v6.0.0',
  recordedAt: '2026-08-31T08:00:00.000Z',
};

export const VALID_DECISION_TRACE_RECORD: DecisionTraceRecord = {
  traceId: computeDecisionTraceId(VALID_DECISION_TRACE_INPUT),
  ...VALID_DECISION_TRACE_INPUT,
};

/**
 * Fixture variants where exactly one required FR-TRACE-005 dimension is omitted.
 */
export const MISSING_DIMENSION_FIXTURES: Record<
  string,
  Partial<DecisionTraceRecord>
> = {
  requirementIds: (({ requirementIds, ...rest }) => rest)(VALID_DECISION_TRACE_RECORD),
  policyVersions: (({ policyVersions, ...rest }) => rest)(VALID_DECISION_TRACE_RECORD),
  featureVersions: (({ featureVersions, ...rest }) => rest)(VALID_DECISION_TRACE_RECORD),
  modelVersions: (({ modelVersions, ...rest }) => rest)(VALID_DECISION_TRACE_RECORD),
  toolVersions: (({ toolVersions, ...rest }) => rest)(VALID_DECISION_TRACE_RECORD),
  providerVersions: (({ providerVersions, ...rest }) => rest)(VALID_DECISION_TRACE_RECORD),
  adapterVersions: (({ adapterVersions, ...rest }) => rest)(VALID_DECISION_TRACE_RECORD),
  artifactVersions: (({ artifactVersions, ...rest }) => rest)(VALID_DECISION_TRACE_RECORD),
  testReleaseId: (({ testReleaseId, ...rest }) => rest)(VALID_DECISION_TRACE_RECORD),
  conformanceReleaseId: (({ conformanceReleaseId, ...rest }) => rest)(VALID_DECISION_TRACE_RECORD),
  manifestSha256: (({ manifestSha256, ...rest }) => rest)(VALID_DECISION_TRACE_RECORD),
  releaseReportId: (({ releaseReportId, ...rest }) => rest)(VALID_DECISION_TRACE_RECORD),
};
