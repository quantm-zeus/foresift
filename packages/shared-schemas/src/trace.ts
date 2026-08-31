/** Shared FR-TRACE record vocabulary. Runtime validation lives in release-conformance. */
export const TRACE_GATE_KINDS = [
  'MANUAL',
  'LEGAL',
  'RIGHTS',
  'STATISTICAL',
  'OWNER_APPROVAL',
] as const;
export type TraceGateKind = (typeof TRACE_GATE_KINDS)[number];

export interface TraceGateEvidencePayload {
  readonly approver: string;
  readonly gateKind: TraceGateKind;
  readonly scopeRefs: readonly string[];
  readonly subject: string;
  readonly issuedAt: string;
  readonly expiresAt: string;
  readonly reason?: string;
  readonly revocationRef?: string | null;
  readonly metadata?: Readonly<Record<string, unknown>>;
}
export interface TraceGateEvidenceRecord {
  readonly evidenceId: string;
  readonly payload: TraceGateEvidencePayload;
  readonly payloadSha256: string;
  readonly signature: string;
  readonly gateKind: TraceGateKind;
  readonly scopeRefs: readonly string[];
  readonly approver: string;
  readonly issuedAt: string;
  readonly expiresAt: string;
  readonly revokedAt?: string | null;
  readonly recordedAt: string;
}
export interface DecisionTraceRecord {
  readonly traceId: string;
  readonly decisionRef: string;
  readonly requirementIds: readonly string[];
  readonly policyVersions: Readonly<Record<string, string>>;
  readonly featureVersions: Readonly<Record<string, string>>;
  readonly modelVersions: Readonly<Record<string, string>>;
  readonly toolVersions: Readonly<Record<string, string>>;
  readonly providerVersions: Readonly<Record<string, string>>;
  readonly adapterVersions: Readonly<Record<string, string>>;
  readonly artifactVersions: Readonly<Record<string, string>>;
  readonly testReleaseId: string;
  readonly conformanceReleaseId: string;
  readonly manifestSha256: string;
  readonly releaseReportId: string;
  readonly recordedAt: string;
}
export const TRACE_TELEMETRY_FIELDS = [
  'eventName',
  'requirementRefs',
  'contractStatus',
  'recoveryDataClass',
] as const;
