/**
 * Activation-readiness evaluation (AC-272). One operation, one verdict:
 * ELIGIBLE only when EVERY gate is simultaneously satisfied — lifecycle
 * state in service, no unexcepted deprecation, rights verified with a
 * currently open window, configured verification kinds fresh, and zero
 * quarantined malicious-response exposure. Any single failure BLOCKS with
 * a machine-readable reason list; absence of configuration fails closed.
 */
import type { ClockPort } from '@foresift/domain';
import { fixedClock, utcTimestamp } from '@foresift/domain';
import type { DatabaseEngine } from '@foresift/persistence';
import { ProvErrorCode, ReadinessError } from './errors.ts';
import type { LifecycleState } from './schemas.ts';

export interface ReadinessReason {
  readonly code: string;
  readonly detail: string;
}

export interface ReadinessVerdict {
  readonly providerId: string;
  readonly operationId: string;
  readonly operationVersion: string;
  readonly verdict: 'ELIGIBLE' | 'BLOCKED';
  readonly reasons: readonly ReadinessReason[];
}

/** States that can never serve consumption (DEPRECATED is judged separately). */
const HARD_BLOCKING_STATES: ReadonlySet<LifecycleState> = new Set([
  'DISCOVERED',
  'BLOCKED',
  'REMOVED',
]);

interface DefinitionRow {
  version: string;
  current_state: string;
  deprecated_at: Date | string | null;
  sunset_at: Date | string | null;
}

interface DeclarationRow {
  verification_expires_at: Date | string;
}

interface TtlConfigRow {
  kind: string;
}

interface QuarantineCountRow {
  n: string;
}

function iso(value: Date | string): string {
  return typeof value === 'string'
    ? value.replace(' ', 'T')
    : value.toISOString().replace('.000Z', 'Z');
}

/**
 * Canonical reason ordering keeps verdicts byte-stable across evaluations —
 * callers diff reasons, so evaluation order must never matter to output.
 */
const REASON_ORDER = [
  'LIFECYCLE_STATE_BLOCKING',
  'OPERATION_UNKNOWN',
  'DEPRECATED_WITHOUT_EXCEPTION',
  'RIGHTS_UNVERIFIED',
  'VERIFICATION_LAPSED',
  'QUARANTINED_EXPOSURE',
];

export class ReadinessEvaluator {
  private readonly engine: DatabaseEngine;
  private readonly clock: ClockPort;

  constructor(options: {
    readonly engine: DatabaseEngine;
    /** Injected clock (Constitution XI). */
    readonly clock?: ClockPort;
  }) {
    this.engine = options.engine;
    this.clock = options.clock ?? fixedClock(utcTimestamp('1970-01-01T00:00:00Z'));
  }

  async evaluate(input: {
    readonly providerId: string;
    readonly operationId: string;
    readonly operationVersion: string;
  }): Promise<ReadinessVerdict> {
    if (
      input.providerId.trim() === '' ||
      input.operationId.trim() === '' ||
      input.operationVersion.trim() === ''
    ) {
      throw new ReadinessError(
        'readiness evaluation requires non-empty provider/operation/version identity',
        {},
        ProvErrorCode.PROV_READINESS_INPUT_INVALID,
      );
    }
    const nowMs = this.clock.nowEpochMs();
    const now = this.clock.now();
    const reasons: ReadinessReason[] = [];

    const defs = await this.engine.query<DefinitionRow>(
      `SELECT version, current_state, deprecated_at, sunset_at
       FROM prov.prov_operations
       WHERE provider_id = $1 AND operation_id = $2 AND version = $3`,
      [input.providerId, input.operationId, input.operationVersion],
    );
    const def = defs.rows[0];
    if (def === undefined) {
      reasons.push({
        code: 'OPERATION_UNKNOWN',
        detail: 'no registered definition for this identity — nothing is evaluable',
      });
      return this.finish(input, reasons);
    }

    // Gate 1: lifecycle state in service.
    const state = def.current_state as LifecycleState;
    if (HARD_BLOCKING_STATES.has(state)) {
      reasons.push({
        code: 'LIFECYCLE_STATE_BLOCKING',
        detail: `current state ${state} cannot serve consumption`,
      });
    }

    // Gate 2: DEPRECATED serves only under a valid migration exception.
    if (state === 'DEPRECATED' || def.deprecated_at !== null) {
      const exceptions = await this.engine.query<{ n: string }>(
        `SELECT count(*)::text AS n FROM prov.prov_migration_exceptions
         WHERE provider_id = $1 AND operation_id = $2
           AND revoked_at IS NULL AND exception_expires_at > $3`,
        [input.providerId, input.operationId, now],
      );
      if (Number(exceptions.rows[0]?.n ?? '0') === 0) {
        reasons.push({
          code: 'DEPRECATED_WITHOUT_EXCEPTION',
          detail: 'deprecated operation has no valid migration exception at the current instant',
        });
      }
    }

    // Gate 3: rights declared AND verification window still open on the
    // LATEST version (capture-time snapshots are honored at use sites; a
    // lapsed latest declaration blocks NEW ingestion).
    const decls = await this.engine.query<DeclarationRow>(
      `SELECT verification_expires_at FROM prov.prov_rights_declarations
       WHERE provider_id = $1 AND operation_id = $2
       ORDER BY rights_version DESC LIMIT 1`,
      [input.providerId, input.operationId],
    );
    const latestDeclaration = decls.rows[0];
    if (
      latestDeclaration === undefined ||
      Date.parse(iso(latestDeclaration.verification_expires_at)) <= nowMs
    ) {
      reasons.push({
        code: 'RIGHTS_UNVERIFIED',
        detail:
          latestDeclaration === undefined
            ? 'no rights declaration exists for this operation'
            : 'latest rights-declaration verification window has closed',
      });
    }

    // Gate 4: every CONFIGURED verification kind for this provider must be
    // fresh for this exact version. Unconfigured kinds are absent policy,
    // not freshness — but a configured kind without a live success blocks.
    const configs = await this.engine.query<TtlConfigRow>(
      'SELECT kind FROM prov.prov_verification_ttl_config WHERE provider_id = $1 ORDER BY kind ASC',
      [input.providerId],
    );
    for (const config of configs.rows) {
      const kind = config.kind;
      const records = await this.engine.query<{
        expires_at: Date | string;
        outcome: string;
      }>(
        `SELECT expires_at, outcome FROM prov.prov_verification_records
         WHERE provider_id = $1 AND operation_id = $2 AND operation_version = $3
           AND kind = $4 AND outcome = 'SUCCEEDED'
         ORDER BY verified_at DESC LIMIT 1`,
        [input.providerId, input.operationId, input.operationVersion, kind],
      );
      const record = records.rows[0];
      if (
        record === undefined ||
        Date.parse(iso(record.expires_at)) <= nowMs
      ) {
        reasons.push({
          code: 'VERIFICATION_LAPSED',
          detail: `verification kind ${kind} ${
            record === undefined ? 'has no successful record' : 'is expired'
          } for ${input.operationVersion}`,
        });
      }
    }

    // Gate 5: any quarantined malicious response on this operation means
    // hazardous bytes crossed this boundary before — blocked until cleared.
    const quarantines = await this.engine.query<QuarantineCountRow>(
      `SELECT count(*)::text AS n FROM prov.prov_response_quarantine
       WHERE provider_id = $1 AND operation_id = $2`,
      [input.providerId, input.operationId],
    );
    if (Number(quarantines.rows[0]?.n ?? '0') > 0) {
      reasons.push({
        code: 'QUARANTINED_EXPOSURE',
        detail: `${quarantines.rows[0]?.n} quarantined malicious response(s) recorded for this operation`,
      });
    }

    return this.finish(input, reasons);
  }

  private finish(
    input: {
      readonly providerId: string;
      readonly operationId: string;
      readonly operationVersion: string;
    },
    reasons: ReadinessReason[],
  ): ReadinessVerdict {
    const sorted = [...reasons].sort(
      (a, b) =>
        REASON_ORDER.indexOf(a.code) - REASON_ORDER.indexOf(b.code) ||
        a.detail.localeCompare(b.detail),
    );
    return {
      providerId: input.providerId,
      operationId: input.operationId,
      operationVersion: input.operationVersion,
      verdict: sorted.length === 0 ? 'ELIGIBLE' : 'BLOCKED',
      reasons: sorted,
    };
  }
}
