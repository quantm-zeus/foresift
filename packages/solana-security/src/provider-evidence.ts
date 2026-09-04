import {
  ProviderVerdict,
  SecurityConflictClass,
  SecuritySeverity,
  securitySeverity,
  type QualityCode,
} from '@foresift/domain';
import type { DatabaseEngine } from '@foresift/persistence';
import {
  parseSolsecSchema,
  type SecurityConflict,
  type SecurityProviderReport,
} from '@foresift/shared-schemas';

const SEVERITY_RANK: Readonly<Record<SecuritySeverity, number>> = {
  [SecuritySeverity.NONE]: 0,
  [SecuritySeverity.LOW]: 1,
  [SecuritySeverity.MEDIUM]: 2,
  [SecuritySeverity.HIGH]: 3,
  [SecuritySeverity.CRITICAL]: 4,
};

export interface SecurityConflictInput {
  readonly assessmentId: string;
  readonly deterministicSeverity: SecuritySeverity;
  readonly deterministicFindingIds: readonly string[];
  /** Undefined means provider evidence is absent, never that the asset is safe. */
  readonly providerReport?: SecurityProviderReport;
  readonly conflictId?: string;
  readonly resolvedAt?: string;
  readonly availableAt?: string;
}

export type ProviderEvidenceDisposition =
  'INDEPENDENT_SUPPORTING_EVIDENCE' | 'UNRESOLVED_INDEPENDENT_EVIDENCE' | 'ABSENT';

export interface SecurityConflictResolution {
  readonly effectiveSeverity: SecuritySeverity;
  readonly resolutionSide: 'DETERMINISTIC' | 'UNRESOLVED_INDEPENDENT_EVIDENCE';
  readonly providerEvidenceDisposition: ProviderEvidenceDisposition;
  readonly providerAbsent: boolean;
  readonly qualityCodes: readonly QualityCode[];
  readonly conflict: SecurityConflict | null;
}

function requireFindingIds(ids: readonly string[]): readonly string[] {
  const unique = [...new Set(ids)];
  if (unique.length === 0 || unique.some((id) => id.trim().length === 0))
    throw new RangeError('deterministicFindingIds must contain non-empty evidence identifiers');
  return unique;
}

/** Stores one provider response as an independent evidence group. */
export async function recordSecurityProviderReport(
  engine: DatabaseEngine,
  input: SecurityProviderReport,
): Promise<SecurityProviderReport> {
  const report = parseSolsecSchema('SecurityProviderReport', input);
  await engine.query(
    `INSERT INTO security_provider_reports (
       report_id, assessment_id, source_id, provider_report_id, provider_version,
       verdict, raw_payload_ref, finding_ids, observed_at, available_at, quality_codes)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
    [
      report.reportId,
      report.assessmentId,
      report.sourceId,
      report.providerReportId,
      report.providerVersion,
      report.verdict,
      report.rawPayloadRef,
      report.findingIds,
      report.observedAt,
      report.availableAt,
      report.qualityCodes,
    ],
  );
  return report;
}

export const persistSecurityProviderReport = recordSecurityProviderReport;

/**
 * Compares, but never merges, provider and deterministic evidence. Provider
 * optimism cannot lower deterministic HIGH/CRITICAL risk, and provider-only
 * risk remains unresolved independent evidence.
 */
export function resolveSecurityConflict(input: SecurityConflictInput): SecurityConflictResolution {
  if (input.assessmentId.trim().length === 0)
    throw new RangeError('assessmentId must be non-empty');
  const deterministicSeverity = securitySeverity(input.deterministicSeverity);
  const findingIds = requireFindingIds(input.deterministicFindingIds);
  const report =
    input.providerReport === undefined
      ? undefined
      : parseSolsecSchema('SecurityProviderReport', input.providerReport);
  if (report !== undefined && report.assessmentId !== input.assessmentId)
    throw new RangeError('provider report and deterministic findings must share an assessment');

  if (report === undefined || report.verdict === ProviderVerdict.UNABLE_TO_VERIFY) {
    return {
      effectiveSeverity: deterministicSeverity,
      resolutionSide: 'DETERMINISTIC',
      providerEvidenceDisposition: 'ABSENT',
      providerAbsent: report === undefined,
      qualityCodes: ['MISSING_PROVIDER'],
      conflict: null,
    };
  }

  const knownSevereRisk = SEVERITY_RANK[deterministicSeverity] >= SEVERITY_RANK.HIGH;
  const optimismConflict = report.verdict === ProviderVerdict.SAFE && knownSevereRisk;
  const uncorroboratedProviderRisk =
    report.verdict === ProviderVerdict.RISK_DETECTED &&
    deterministicSeverity === SecuritySeverity.NONE;

  if (!optimismConflict && !uncorroboratedProviderRisk) {
    return {
      effectiveSeverity: deterministicSeverity,
      resolutionSide: 'DETERMINISTIC',
      providerEvidenceDisposition: 'INDEPENDENT_SUPPORTING_EVIDENCE',
      providerAbsent: false,
      qualityCodes: ['VALID'],
      conflict: null,
    };
  }

  const resolvedAt = input.resolvedAt ?? report.observedAt;
  const availableAt = input.availableAt ?? report.availableAt;
  const conflict = parseSolsecSchema('SecurityConflict', {
    conflictId:
      input.conflictId ??
      `security-conflict:${encodeURIComponent(input.assessmentId)}:${encodeURIComponent(report.reportId)}`,
    assessmentId: input.assessmentId,
    providerReportId: report.reportId,
    conflictClass: optimismConflict
      ? SecurityConflictClass.PROVIDER_OPTIMISM_OVERRIDDEN
      : SecurityConflictClass.PROVIDER_RISK_NO_DETERMINISTIC_CORROBORATION,
    deterministicFindingIds: findingIds,
    resolution: 'DETERMINISTIC',
    resolvedAt,
    availableAt,
  });
  return {
    effectiveSeverity: deterministicSeverity,
    resolutionSide: optimismConflict ? 'DETERMINISTIC' : 'UNRESOLVED_INDEPENDENT_EVIDENCE',
    providerEvidenceDisposition: optimismConflict
      ? 'INDEPENDENT_SUPPORTING_EVIDENCE'
      : 'UNRESOLVED_INDEPENDENT_EVIDENCE',
    providerAbsent: false,
    qualityCodes: ['CONFLICTING'],
    conflict,
  };
}

/** Persists comparison evidence only when the comparison produced a conflict. */
export async function recordSecurityConflict(
  engine: DatabaseEngine,
  conflict: SecurityConflict,
): Promise<SecurityConflict> {
  const parsed = parseSolsecSchema('SecurityConflict', conflict);
  await engine.query(
    `INSERT INTO security_conflicts (
       conflict_id, assessment_id, provider_report_id, conflict_class,
       deterministic_finding_ids, resolution, resolved_at, available_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
    [
      parsed.conflictId,
      parsed.assessmentId,
      parsed.providerReportId,
      parsed.conflictClass,
      parsed.deterministicFindingIds,
      parsed.resolution,
      parsed.resolvedAt,
      parsed.availableAt,
    ],
  );
  return parsed;
}

export async function resolveAndRecordSecurityConflict(
  engine: DatabaseEngine,
  input: SecurityConflictInput,
): Promise<SecurityConflictResolution> {
  const resolution = resolveSecurityConflict(input);
  if (resolution.conflict !== null) await recordSecurityConflict(engine, resolution.conflict);
  return resolution;
}
