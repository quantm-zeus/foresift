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
  type TokenControlFinding,
} from '@foresift/shared-schemas';

/**
 * §65.7 provider-evidence plane. External security-provider reports form ONE
 * independent evidence group: a SAFE provider output is optimism that can
 * never override a deterministic CRITICAL/HIGH finding, uncorroborated
 * provider risk stays unresolved independent evidence (never promoted into
 * deterministic severity), and missing provider data is recorded as absence —
 * never negative evidence that reduces severity (§35.12, INV-008).
 */
export const PROVIDER_EVIDENCE_POLICY_VERSION = 'solsec-provider-evidence@1';

const SEVERITY_RANK: Readonly<Record<SecuritySeverity, number>> = {
  [SecuritySeverity.NONE]: 0,
  [SecuritySeverity.LOW]: 1,
  [SecuritySeverity.MEDIUM]: 2,
  [SecuritySeverity.HIGH]: 3,
  [SecuritySeverity.CRITICAL]: 4,
};

export interface SecurityConflictResolutionInput {
  readonly assessmentId: string;
  /** Deterministic control findings; their carried severity is the control plane. */
  readonly deterministicFindings: readonly TokenControlFinding[];
  /** Every received provider report; preserved verbatim as independent evidence. */
  readonly providerReports: readonly SecurityProviderReport[];
  readonly availableAt: string;
  readonly resolvedAt?: string;
}

export interface SecurityConflictResolution {
  readonly assessmentId: string;
  /** Versioned comparison policy identity (FR-SOLSEC-002 evidence law). */
  readonly policyVersion: string;
  /** Deterministic severity after comparison — providers never move it. */
  readonly effectiveSeverity: SecuritySeverity;
  readonly providerOptimismOverridden: boolean;
  /** Conflict rows to persist; `resolution` always names the deterministic side. */
  readonly conflicts: readonly SecurityConflict[];
  /** Provider risk without deterministic corroboration, kept as unresolved evidence. */
  readonly unresolvedProviderRisk: readonly SecurityProviderReport[];
  /** Parsed provider reports, preserved without loss as one evidence group. */
  readonly providerReports: readonly SecurityProviderReport[];
  readonly qualityCodes: readonly QualityCode[];
}

function requireNonEmpty(value: string, field: string): string {
  if (value.trim().length === 0) throw new RangeError(`${field} must be non-empty`);
  return value;
}

/**
 * Compares, but never merges, provider and deterministic evidence. Severity is
 * the maximum carried by the deterministic findings; provider verdicts can
 * raise conflicts, never the severity itself.
 */
export function resolveSecurityConflict(
  input: SecurityConflictResolutionInput,
): SecurityConflictResolution {
  requireNonEmpty(input.assessmentId, 'assessmentId');
  if (!Number.isFinite(Date.parse(input.availableAt)))
    throw new RangeError('availableAt must be a parseable timestamp');
  const resolvedAt = input.resolvedAt ?? input.availableAt;
  if (!Number.isFinite(Date.parse(resolvedAt)))
    throw new RangeError('resolvedAt must be a parseable timestamp');
  if (Date.parse(input.availableAt) < Date.parse(resolvedAt))
    throw new Error('AVAILABLE_AT_PRECEDES_RESOLVED_AT');

  const parsedFindings = input.deterministicFindings.map((finding) => {
    const parsed = parseSolsecSchema('TokenControlFinding', finding);
    if (parsed.assessmentId !== input.assessmentId)
      throw new RangeError('deterministic findings must share the resolution assessment');
    return parsed;
  });
  const evaluatedFindingIds = [
    ...new Set(parsedFindings.map((finding) => finding.findingId)),
  ].sort();
  let severity: SecuritySeverity = SecuritySeverity.NONE;
  for (const finding of parsedFindings) {
    if (finding.severity !== null && SEVERITY_RANK[finding.severity] > SEVERITY_RANK[severity])
      severity = finding.severity;
  }
  const establishingIds = [
    ...new Set(
      parsedFindings
        .filter((finding) => finding.severity !== null && finding.severity === severity)
        .map((finding) => finding.findingId),
    ),
  ].sort();

  const reports = input.providerReports.map((report) => {
    const parsed = parseSolsecSchema('SecurityProviderReport', report);
    if (parsed.assessmentId !== input.assessmentId)
      throw new RangeError('provider report and deterministic findings must share an assessment');
    return parsed;
  });

  const makeConflict = (
    report: SecurityProviderReport,
    conflictClass: SecurityConflictClass,
    deterministicFindingIds: readonly string[],
  ): SecurityConflict =>
    parseSolsecSchema('SecurityConflict', {
      conflictId: `security-conflict:${encodeURIComponent(input.assessmentId)}:${encodeURIComponent(report.reportId)}`,
      assessmentId: input.assessmentId,
      providerReportId: report.reportId,
      conflictClass,
      deterministicFindingIds: [...deterministicFindingIds],
      resolution: 'DETERMINISTIC',
      resolvedAt,
      availableAt: input.availableAt,
    });

  const conflicts: SecurityConflict[] = [];
  const unresolvedProviderRisk: SecurityProviderReport[] = [];
  let providerOptimismOverridden = false;
  for (const report of reports) {
    // A provider that could not verify is recorded as absence; absence never
    // reduces deterministic severity (§35.12).
    if (report.verdict === ProviderVerdict.UNABLE_TO_VERIFY) continue;
    if (report.verdict === ProviderVerdict.SAFE) {
      if (SEVERITY_RANK[severity] >= SEVERITY_RANK[SecuritySeverity.HIGH]) {
        providerOptimismOverridden = true;
        conflicts.push(
          makeConflict(report, SecurityConflictClass.PROVIDER_OPTIMISM_OVERRIDDEN, establishingIds),
        );
      }
      continue;
    }
    // Provider risk standing alone (deterministic side concluded NONE) stays
    // unresolved independent evidence; it is never promoted into severity.
    if (report.verdict === ProviderVerdict.RISK_DETECTED && severity === SecuritySeverity.NONE) {
      unresolvedProviderRisk.push(report);
      // The conflict schema requires at least one deterministic finding id;
      // with none evaluated, the report is exposed only as unresolved evidence.
      if (evaluatedFindingIds.length > 0)
        conflicts.push(
          makeConflict(
            report,
            SecurityConflictClass.PROVIDER_RISK_NO_DETERMINISTIC_CORROBORATION,
            evaluatedFindingIds,
          ),
        );
    }
  }

  const qualityCodes: QualityCode[] =
    providerOptimismOverridden || unresolvedProviderRisk.length > 0
      ? ['CONFLICTING']
      : reports.length === 0
        ? ['MISSING_PROVIDER']
        : ['VALID'];

  return {
    assessmentId: input.assessmentId,
    policyVersion: PROVIDER_EVIDENCE_POLICY_VERSION,
    effectiveSeverity: severity,
    providerOptimismOverridden,
    conflicts,
    unresolvedProviderRisk,
    providerReports: reports,
    qualityCodes,
  };
}

/** Persists one provider response as its own independent evidence group. */
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

/** Persists a recorded conflict; `resolution` always names the deterministic side. */
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

/** Resolves the comparison and persists every conflict row it produced. */
export async function resolveAndRecordSecurityConflict(
  engine: DatabaseEngine,
  input: SecurityConflictResolutionInput,
): Promise<SecurityConflictResolution> {
  const resolution = resolveSecurityConflict(input);
  for (const conflict of resolution.conflicts) await recordSecurityConflict(engine, conflict);
  return resolution;
}
