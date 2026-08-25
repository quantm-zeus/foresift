/**
 * Source fingerprints (FR-PROV-010; §15.7). Versioned behavioral/structural
 * signatures per operation — canonical JSON payloads describing HOW a source
 * behaves (lineage shape, correlation structure, timing profile, outage
 * overlap, schema characteristics, first-seen behavior), never WHAT it said.
 * Payload material is structurally absent: only canonical estimator inputs
 * and references into stored artifacts persist.
 */
import type { ClockPort } from '@foresift/domain';
import { fixedClock, utcTimestamp } from '@foresift/domain';
import { canonicalJson, type DatabaseEngine } from '@foresift/persistence';
import { ProvErrorCode, FingerprintError } from './errors.ts';
import {
  SourceFingerprintRecordSchema,
  type FingerprintKind,
  type SourceFingerprintRecord,
} from './schemas.ts';

interface FingerprintRow {
  provider_id: string;
  operation_id: string;
  operation_version: string;
  fingerprint_kind: string;
  fingerprint_version: number;
  payload_canonical: string;
  estimator_input_refs: unknown;
  computed_at: Date | string;
}

function iso(value: Date | string): string {
  return typeof value === 'string'
    ? value.replace(' ', 'T')
    : value.toISOString().replace('.000Z', 'Z');
}

function rowToRecord(row: FingerprintRow): SourceFingerprintRecord {
  return SourceFingerprintRecordSchema.parse({
    providerId: row.provider_id,
    operationId: row.operation_id,
    operationVersion: row.operation_version,
    kind: row.fingerprint_kind,
    fingerprintVersion: Number(row.fingerprint_version),
    payloadCanonical: row.payload_canonical,
    estimatorInputRefs: row.estimator_input_refs,
    computedAt: iso(row.computed_at),
  });
}

export class SourceFingerprintService {
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

  /**
   * Capture one fingerprint observation as the next version for its
   * (identity, kind). The payload serializes canonically so equal
   * observations compare byte-equal across captures.
   */
  async capture(input: {
    readonly providerId: string;
    readonly operationId: string;
    readonly operationVersion: string;
    readonly kind: FingerprintKind;
    readonly payload: unknown;
    readonly estimatorInputRefs?: readonly string[];
  }): Promise<SourceFingerprintRecord> {
    let payloadCanonical: string;
    try {
      payloadCanonical = canonicalJson(input.payload);
    } catch {
      throw new FingerprintError(
        'fingerprint payload must be JSON-canonicalizable',
        {},
        ProvErrorCode.PROV_FINGERPRINT_PAYLOAD_INVALID,
      );
    }
    if (payloadCanonical === 'null' || payloadCanonical.length === 0) {
      throw new FingerprintError(
        'fingerprint payload must carry observable structure, not null',
        {},
        ProvErrorCode.PROV_FINGERPRINT_PAYLOAD_INVALID,
      );
    }
    const maxRows = await this.engine.query<{ fingerprint_version: number }>(
      `SELECT coalesce(max(fingerprint_version), 0) AS fingerprint_version
       FROM prov.prov_source_fingerprints
       WHERE provider_id = $1 AND operation_id = $2 AND operation_version = $3
         AND fingerprint_kind = $4`,
      [input.providerId, input.operationId, input.operationVersion, input.kind],
    );
    const nextVersion = Number(maxRows.rows[0]?.fingerprint_version ?? 0) + 1;
    const inserted = await this.engine.query<FingerprintRow>(
      `INSERT INTO prov.prov_source_fingerprints (
         provider_id, operation_id, operation_version, fingerprint_kind,
         fingerprint_version, payload_canonical, estimator_input_refs, computed_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8)
       RETURNING *`,
      [
        input.providerId,
        input.operationId,
        input.operationVersion,
        input.kind,
        nextVersion,
        payloadCanonical,
        JSON.stringify([...(input.estimatorInputRefs ?? [])]),
        this.clock.now(),
      ],
    );
    return rowToRecord(inserted.rows[0]!);
  }

  async history(
    providerId: string,
    operationId: string,
    operationVersion: string,
    kind?: FingerprintKind | undefined,
  ): Promise<SourceFingerprintRecord[]> {
    const rows =
      kind === undefined
        ? await this.engine.query<FingerprintRow>(
            `SELECT * FROM prov.prov_source_fingerprints
             WHERE provider_id = $1 AND operation_id = $2 AND operation_version = $3
             ORDER BY fingerprint_kind ASC, fingerprint_version ASC`,
            [providerId, operationId, operationVersion],
          )
        : await this.engine.query<FingerprintRow>(
            `SELECT * FROM prov.prov_source_fingerprints
             WHERE provider_id = $1 AND operation_id = $2 AND operation_version = $3
               AND fingerprint_kind = $4
             ORDER BY fingerprint_version ASC`,
            [providerId, operationId, operationVersion, kind],
          );
    return rows.rows.map(rowToRecord);
  }

  async latest(
    providerId: string,
    operationId: string,
    operationVersion: string,
    kind: FingerprintKind,
  ): Promise<SourceFingerprintRecord | undefined> {
    const rows = await this.engine.query<FingerprintRow>(
      `SELECT * FROM prov.prov_source_fingerprints
       WHERE provider_id = $1 AND operation_id = $2 AND operation_version = $3
         AND fingerprint_kind = $4
       ORDER BY fingerprint_version DESC LIMIT 1`,
      [providerId, operationId, operationVersion, kind],
    );
    const row = rows.rows[0];
    return row === undefined ? undefined : rowToRecord(row);
  }
}
