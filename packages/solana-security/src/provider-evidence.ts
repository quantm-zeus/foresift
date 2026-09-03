import {
  ProviderVerdict,
  SecurityConflictClass,
  SecuritySeverity,
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
  /** Undefined is an explicit absence, not evidence that the asset is safe. */
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
  if (ids.length === 0 || ids.some((id) => id.trim().length === 0)) {
    throw new RangeError('deterministicFindingIds must contain non-empty evidence identifiers');
  }
  return [...new Set(ids)];
}

/** Persist a provider report as its own evidence group, retaining the raw payload by hash. */
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
 * Resolve provider evidence without allowing it to rewrite deterministic truth.
 * SAFE conflicts with deterministic HIGH/CRITICAL; provider-only risk stays unresolved;
 * and absent/unavailable provider data preserves the deterministic severity unchanged.
 */
export function resolveSecurityConflict(input: SecurityConflictInput): SecurityConflictResolution {
  const findingIds = requireFindingIds(input.deterministicFindingIds);
  const report = input.providerReport;

  if (report === undefined || report.verdict === ProviderVerdict.UNABLE_TO_VERIFY) {
    return {
      effectiveSeverity: input.deterministicSeverity,
      resolutionSide: 'DETERMINISTIC',
      providerEvidenceDisposition: 'ABSENT',
      providerAbsent: true,
      qualityCodes: ['MISSING_PROVIDER'],
      conflict: null,
    };
  }

  const knownSevereRisk = SEVERITY_RANK[input.deterministicSeverity] >= SEVERITY_RANK.HIGH;
  const optimismConflict = report.verdict === ProviderVerdict.SAFE && knownSevereRisk;
  const uncorroboratedProviderRisk =
    report.verdict === ProviderVerdict.RISK_DETECTED &&
    SEVERITY_RANK[input.deterministicSeverity] < SEVERITY_RANK.HIGH;

  if (!optimismConflict && !uncorroboratedProviderRisk) {
    return {
      effectiveSeverity: input.deterministicSeverity,
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
      : SecurityConflictClass.PROVIDER_RISK_UNCONFIRMED,
    deterministicFindingIds: findingIds,
    resolution: 'DETERMINISTIC',
    resolvedAt,
    availableAt,
  });
  return {
    effectiveSeverity: input.deterministicSeverity,
    resolutionSide: optimismConflict ? 'DETERMINISTIC' : 'UNRESOLVED_INDEPENDENT_EVIDENCE',
    providerEvidenceDisposition: optimismConflict
      ? 'INDEPENDENT_SUPPORTING_EVIDENCE'
      : 'UNRESOLVED_INDEPENDENT_EVIDENCE',
    providerAbsent: false,
    qualityCodes: ['CONFLICTING'],
    conflict,
  };
}

/** Persist the comparison result when (and only when) it contains a conflict row. */
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
