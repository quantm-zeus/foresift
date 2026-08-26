/**
 * Source fingerprints (FR-PROV-010; §15.7 six kinds).
 *
 * Fingerprints capture WHAT A SOURCE LOOKS LIKE — lineage, correlation,
 * timing, outage behaviour, schema characteristics, first-seen behavior —
 * as CANONICAL JSON hashed with the repository's single serializer and
 * `sha256:<hex>` address form. Versions are monotonic per
 * (operation, kind): re-capture appends a new version; history is never
 * rewritten. `estimatorInputs` carries the references the future
 * ProviderDependenceEstimator will consume.
 */
import { canonicalJson, sha256Text } from '@foresift/persistence';
import type { DatabaseEngine } from '@foresift/persistence';
import type { UtcTimestamp } from '@foresift/domain';
import type { OperationRef } from './operation-registry.ts';
import { FINGERPRINT_KINDS, type FingerprintKind } from './vocabularies.ts';
import { FingerprintError, ProvErrorCode } from './errors.ts';

export interface SourceFingerprint {
  readonly fingerprintId: string;
  readonly ref: OperationRef;
  readonly kind: FingerprintKind;
  readonly version: number;
  readonly payloadCanonical: string;
  readonly payloadSha256: string;
  readonly computedAt: UtcTimestamp;
}

interface FingerprintRow {
  fingerprint_id: string;
  provider_id: string;
  operation_id: string;
  operation_version: string;
  kind: string;
  version: number | string;
  payload_canonical: string;
  payload_sha256: string;
  computed_at: Date | string;
}

function normalize(value: Date | string): UtcTimestamp {
  if (typeof value === 'string') return value as UtcTimestamp;
  return value.toISOString().replace('.000Z', 'Z') as UtcTimestamp;
}

/**
 * Canonicalize the caller's payload. A pre-stringified payload is accepted
 * ONLY when it already equals its own canonical form — anything else refuses
 * PROV_FINGERPRINT_PAYLOAD_NOT_CANONICAL rather than hashing a drifting byte
 * representation.
 */
export function canonicalizeFingerprintPayload(payload: unknown): string {
  if (typeof payload === 'string') {
    try {
      const parsed: unknown = JSON.parse(payload);
      if (canonicalJson(parsed) !== payload) {
        throw new FingerprintError(
          'fingerprint payload string is not in canonical form; pass the raw value or canonicalize first',
          {},
          ProvErrorCode.PROV_FINGERPRINT_PAYLOAD_NOT_CANONICAL,
        );
      }
      return payload;
    } catch (error) {
      if (error instanceof FingerprintError) throw error;
      throw new FingerprintError(
        'fingerprint payload string is not valid JSON',
        {},
        ProvErrorCode.PROV_FINGERPRINT_PAYLOAD_NOT_CANONICAL,
      );
    }
  }
  return canonicalJson(payload);
}

export class SourceFingerprints {
  private readonly engine: DatabaseEngine;

  constructor(engine: DatabaseEngine) {
    this.engine = engine;
  }

  /**
   * Capture one fingerprint version. Retries with the same fingerprint id
   * return the stored row unchanged; otherwise the version is the next
   * monotonically increasing number for (operation, kind).
   */
  async capture(input: {
    readonly fingerprintId: string;
    readonly ref: OperationRef;
    readonly kind: FingerprintKind;
    /** Raw JSON value (or an already-canonical JSON string). */
    readonly payload: unknown;
    readonly computedAt: UtcTimestamp;
    /** References consumed later by the ProviderDependenceEstimator. */
    readonly estimatorInputs?: Readonly<Record<string, string>>;
  }): Promise<SourceFingerprint> {
    if (!(FINGERPRINT_KINDS as readonly string[]).includes(input.kind)) {
      throw new FingerprintError(
        `fingerprint kind '${String(input.kind)}' is outside the six-kind alphabet`,
        { kind: String(input.kind) },
        ProvErrorCode.PROV_FINGERPRINT_KIND_UNKNOWN,
      );
    }

    const existing = await this.engine.query<FingerprintRow>(
      'SELECT * FROM prov.prov_source_fingerprints WHERE fingerprint_id = $1',
      [input.fingerprintId],
    );
    const prior = existing.rows[0];
    if (prior !== undefined) return this.rowToFingerprint(prior);

    const payloadCanonical = canonicalizeFingerprintPayload(input.payload);
    const payloadSha256 = sha256Text(payloadCanonical);

    const maxRow = await this.engine.query<{ version: number | string }>(
      `SELECT COALESCE(MAX(version), 0) AS version FROM prov.prov_source_fingerprints
       WHERE provider_id = $1 AND operation_id = $2 AND operation_version = $3 AND kind = $4`,
      [input.ref.providerId, input.ref.operationId, input.ref.version, input.kind],
    );
    const version = Number(maxRow.rows[0]?.version ?? 0) + 1;

    await this.engine.query(
      `INSERT INTO prov.prov_source_fingerprints (
         fingerprint_id, provider_id, operation_id, operation_version, kind,
         version, payload_canonical, payload_sha256, computed_at, estimator_inputs)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb)`,
      [
        input.fingerprintId,
        input.ref.providerId,
        input.ref.operationId,
        input.ref.version,
        input.kind,
        version,
        payloadCanonical,
        payloadSha256,
        input.computedAt,
        JSON.stringify(input.estimatorInputs ?? {}),
      ],
    );
    return {
      fingerprintId: input.fingerprintId,
      ref: input.ref,
      kind: input.kind,
      version,
      payloadCanonical,
      payloadSha256,
      computedAt: input.computedAt,
    };
  }

  /** Full versioned history for one (operation, kind), ascending. */
  async history(ref: OperationRef, kind: FingerprintKind): Promise<SourceFingerprint[]> {
    const rows = await this.engine.query<FingerprintRow>(
      `SELECT * FROM prov.prov_source_fingerprints
       WHERE provider_id = $1 AND operation_id = $2 AND operation_version = $3 AND kind = $4
       ORDER BY version`,
      [ref.providerId, ref.operationId, ref.version, kind],
    );
    return rows.rows.map((row) => this.rowToFingerprint(row));
  }

  async latest(ref: OperationRef, kind: FingerprintKind): Promise<SourceFingerprint | undefined> {
    const rows = await this.engine.query<FingerprintRow>(
      `SELECT * FROM prov.prov_source_fingerprints
       WHERE provider_id = $1 AND operation_id = $2 AND operation_version = $3 AND kind = $4
       ORDER BY version DESC LIMIT 1`,
      [ref.providerId, ref.operationId, ref.version, kind],
    );
    const row = rows.rows[0];
    return row === undefined ? undefined : this.rowToFingerprint(row);
  }

  private rowToFingerprint(row: FingerprintRow): SourceFingerprint {
    return {
      fingerprintId: row.fingerprint_id,
      ref: {
        providerId: row.provider_id,
        operationId: row.operation_id,
        version: row.operation_version,
      },
      kind: row.kind as FingerprintKind,
      version: Number(row.version),
      payloadCanonical: row.payload_canonical,
      payloadSha256: row.payload_sha256,
      computedAt: normalize(row.computed_at),
    };
  }
}
