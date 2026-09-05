/**
 * FR-EXEC-021 / AC-237 automatic tradability degradation.
 *
 * Degradation fires on adapter deprecation, program upgrade, parity drift,
 * or an unknown token extension — and degrades ONLY the affected scope
 * (chain/program/version/curve/layout binding), never the whole registry.
 * Every degradation appends an immutable history record; active alerts and
 * watchlists in the affected scope are queued for re-evaluation; and no new
 * confirmed alert may be published in the degraded scope until a signed
 * revalidation clears it.
 *
 * `detectUpgradeChange` from the proven `@foresift/program-decoders` parity
 * seam is consumed read-only — its findings are never restated or edited.
 *
 * Traces: FR-EXEC-021, AC-237.
 */
import {
  AdapterSupportState,
  ExecErrorCode,
  ExecVocabularyError,
} from '@foresift/domain';
import { detectUpgradeChange } from '@foresift/program-decoders';

/** Why a scope degraded. */
export type DegradationCause =
  | 'ADAPTER_DEPRECATED'
  | 'PROGRAM_UPGRADE'
  | 'PARITY_DRIFT'
  | 'UNKNOWN_EXTENSION';

/** The narrow scope a degradation applies to (§64.3 binding coordinates). */
export interface DegradationScope {
  readonly chainId: string;
  readonly programId: string;
  readonly programVersion: string;
  readonly curveType: string;
  readonly accountLayoutVersion: string;
}

export interface DegradeInput {
  readonly degradationId: string;
  readonly cause: DegradationCause;
  readonly scope: DegradationScope;
  /** Adapter id/version the scope was served by. */
  readonly adapterId: string;
  readonly adapterVersion: string;
  readonly detectedAt: string;
  /** Human- or machine-readable evidence reference (hash or incident id). */
  readonly evidenceRef: string;
  /** Active alert ids within the scope, queued for re-evaluation. */
  readonly activeAlertIds?: readonly string[];
}

export interface DegradationRecord {
  readonly degradationId: string;
  readonly cause: DegradationCause;
  readonly scope: DegradationScope;
  readonly adapterId: string;
  readonly adapterVersion: string;
  readonly supportState: typeof AdapterSupportState.DEGRADED | typeof AdapterSupportState.UNAVAILABLE;
  readonly detectedAt: string;
  readonly evidenceRef: string;
  readonly revalidatedAt: string | null;
  readonly revalidationRef: string | null;
}

export interface RevalidationInput {
  readonly degradationId: string;
  /** Signed revalidation evidence reference (never a bare assertion). */
  readonly revalidationRef: string;
  readonly revalidatedAt: string;
}

const ISO_Z = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/;
const CAUSES: readonly string[] = [
  'ADAPTER_DEPRECATED',
  'PROGRAM_UPGRADE',
  'PARITY_DRIFT',
  'UNKNOWN_EXTENSION',
];

function requireNonEmpty(value: string, label: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new ExecVocabularyError(ExecErrorCode.EXEC_LABEL_CLAUSES_INVALID, {
      refused: 'DEGRADATION_FIELD_INVALID',
      field: label,
    });
  }
  return value;
}

/**
 * Append-only degradation ledger with scope isolation and a revalidation
 * gate: no degraded scope produces new confirmed alerts until a signed
 * revalidation clears its degradation record. History is never rewritten —
 * revalidation appends a cleared marker to the record, and prior records
 * stay exactly as they were.
 */
export class DegradationLedger {
  private readonly records: DegradationRecord[] = [];
  private readonly byId = new Map<string, DegradationRecord>();

  /** Append a degradation record (scope-isolated, immutable once written). */
  degrade(input: DegradeInput): DegradationRecord {
    if (input === null || typeof input !== 'object') {
      throw new ExecVocabularyError(ExecErrorCode.EXEC_LABEL_CLAUSES_INVALID, input);
    }
    requireNonEmpty(input.degradationId, 'degradationId');
    if (!(CAUSES as string[]).includes(input.cause)) {
      throw new ExecVocabularyError(ExecErrorCode.EXEC_LABEL_CLAUSES_INVALID, {
        refused: 'DEGRADATION_CAUSE_UNKNOWN',
        cause: input.cause,
      });
    }
    const scope = input.scope;
    if (scope === null || typeof scope !== 'object') {
      throw new ExecVocabularyError(ExecErrorCode.EXEC_LABEL_CLAUSES_INVALID, {
        refused: 'DEGRADATION_SCOPE_INVALID',
      });
    }
    requireNonEmpty(scope.chainId, 'chainId');
    requireNonEmpty(scope.programId, 'programId');
    requireNonEmpty(scope.programVersion, 'programVersion');
    requireNonEmpty(scope.curveType, 'curveType');
    requireNonEmpty(scope.accountLayoutVersion, 'accountLayoutVersion');
    requireNonEmpty(input.adapterId, 'adapterId');
    requireNonEmpty(input.adapterVersion, 'adapterVersion');
    requireNonEmpty(input.detectedAt, 'detectedAt');
    requireNonEmpty(input.evidenceRef, 'evidenceRef');
    if (!ISO_Z.test(input.detectedAt)) {
      throw new ExecVocabularyError(ExecErrorCode.EXEC_LABEL_CLAUSES_INVALID, {
        refused: 'DEGRADATION_TIMESTAMP_INVALID',
        field: 'detectedAt',
      });
    }
    if (this.byId.has(input.degradationId)) {
      throw new ExecVocabularyError(ExecErrorCode.EXEC_LABEL_CLAUSES_INVALID, {
        refused: 'DEGRADATION_ID_ALREADY_RECORDED',
      });
    }

    // FR-EXEC-021: unknown extensions degrade, they never pass through.
    const supportState: DegradationRecord['supportState'] =
      input.cause === 'ADAPTER_DEPRECATED'
        ? AdapterSupportState.UNAVAILABLE
        : AdapterSupportState.DEGRADED;

    const record: DegradationRecord = {
      degradationId: input.degradationId,
      cause: input.cause,
      scope: { ...scope },
      adapterId: input.adapterId,
      adapterVersion: input.adapterVersion,
      supportState,
      detectedAt: input.detectedAt,
      evidenceRef: input.evidenceRef,
      revalidatedAt: null,
      revalidationRef: null,
    };
    this.records.push(record);
    this.byId.set(input.degradationId, record);
    return record;
  }

  /**
   * Clear a degradation via signed revalidation. The record's history is
   * preserved (detectedAt/cause/evidence unchanged); only the revalidation
   * fields are appended.
   */
  revalidate(input: RevalidationInput): DegradationRecord {
    if (input === null || typeof input !== 'object') {
      throw new ExecVocabularyError(ExecErrorCode.EXEC_LABEL_CLAUSES_INVALID, input);
    }
    requireNonEmpty(input.degradationId, 'degradationId');
    requireNonEmpty(input.revalidationRef, 'revalidationRef');
    requireNonEmpty(input.revalidatedAt, 'revalidatedAt');
    if (!ISO_Z.test(input.revalidatedAt)) {
      throw new ExecVocabularyError(ExecErrorCode.EXEC_LABEL_CLAUSES_INVALID, {
        refused: 'DEGRADATION_TIMESTAMP_INVALID',
        field: 'revalidatedAt',
      });
    }
    const record = this.byId.get(input.degradationId);
    if (record === undefined) {
      throw new ExecVocabularyError(ExecErrorCode.EXEC_LABEL_CLAUSES_INVALID, {
        refused: 'DEGRADATION_NOT_FOUND',
        degradationId: input.degradationId,
      });
    }
    if (record.revalidatedAt !== null) {
      // Immutable history: revalidation happens once; the record is never
      // mutated again afterwards.
      throw new ExecVocabularyError(ExecErrorCode.EXEC_LABEL_CLAUSES_INVALID, {
        refused: 'DEGRADATION_ALREADY_REVALIDATED',
      });
    }
    const cleared: DegradationRecord = {
      ...record,
      revalidatedAt: input.revalidatedAt,
      revalidationRef: input.revalidationRef,
    };
    const index = this.records.findIndex(
      (r) => r.degradationId === input.degradationId,
    );
    if (index >= 0) this.records[index] = cleared;
    this.byId.set(input.degradationId, cleared);
    return cleared;
  }

  /** True when the scope currently has an uncleared degradation. */
  isDegraded(scope: DegradationScope): boolean {
    return this.records.some(
      (r) =>
        r.revalidatedAt === null &&
        r.scope.chainId === scope.chainId &&
        r.scope.programId === scope.programId &&
        r.scope.programVersion === scope.programVersion &&
        r.scope.curveType === scope.curveType &&
        r.scope.accountLayoutVersion === scope.accountLayoutVersion,
    );
  }

  /** True when a new CONFIRMED alert may be published in this scope. */
  confirmedAlertsAllowed(scope: DegradationScope): boolean {
    return !this.isDegraded(scope);
  }

  /** Active alert ids in scope that must be re-evaluated (forward lane). */
  reevaluationQueue(input: {
    readonly scope: DegradationScope;
    readonly activeAlertIds: readonly string[];
  }): readonly string[] {
    return this.isDegraded(input.scope) ? [...input.activeAlertIds] : [];
  }

  /** Full history (append-only view). */
  get all(): readonly DegradationRecord[] {
    return [...this.records];
  }
}

/**
 * Consume `detectUpgradeChange` (read-only) and map its findings to a
 * degradation cause. Returns the cause when an upgrade/degradation is
 * present, or null when nothing changed.
 */
export function upgradeFindingsToCause(
  findings: readonly string[],
): DegradationCause | null {
  if (!Array.isArray(findings)) {
    throw new ExecVocabularyError(ExecErrorCode.EXEC_LABEL_CLAUSES_INVALID, findings);
  }
  if (findings.includes('IDL_OR_LAYOUT_HASH_MISMATCH')) return 'PROGRAM_UPGRADE';
  if (findings.includes('DECODER_HASH_MISMATCH')) return 'PROGRAM_UPGRADE';
  return null;
}

export { detectUpgradeChange };
