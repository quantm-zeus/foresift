/**
 * Field-level data-quality repository (FR-DATA-005, §13.9).
 *
 * Enforces "null alone is insufficient" at the boundary AND in SQL: a stored
 * null field must carry at least one explicit code, and VALID-only never
 * explains a null. Read APIs filter fields by their quality state so
 * consumers can distinguish usable values from coded absences.
 */
import { qualityCode, type QualityCode } from '@foresift/domain';
import { ForesiftError, ErrorCode } from '@foresift/domain';
import type { DatabaseEngine } from '../db.ts';

export interface FieldQualityInput {
  readonly fieldQualityId: string;
  readonly observationId: string;
  /** Dotted path of the field within the observation payload. */
  readonly fieldPath: string;
  /** Raw stored value; absent means the field is null and MUST be coded. */
  readonly valueRaw?: string | null;
  readonly qualityCodes: readonly QualityCode[];
}

/** Boundary mirror of the §13.9 null-alone-is-insufficient rule. */
export function assertNullAloneIsInsufficient(
  valueRaw: string | null | undefined,
  codes: readonly QualityCode[],
): void {
  if (valueRaw !== null && valueRaw !== undefined) return;
  if (codes.length < 1) {
    throw new ForesiftError(
      ErrorCode.QUALITY_NULL_WITHOUT_CODE,
      'a null field requires at least one explicit quality code',
      {},
    );
  }
  if (codes.length === 1 && codes[0] === 'VALID') {
    throw new ForesiftError(
      ErrorCode.QUALITY_NULL_WITHOUT_CODE,
      'VALID alone cannot explain a null field',
      {},
    );
  }
}

export async function recordFieldQuality(
  engine: DatabaseEngine,
  input: FieldQualityInput,
): Promise<void> {
  const validated = input.qualityCodes.map((c) => qualityCode(c));
  assertNullAloneIsInsufficient(input.valueRaw, validated);
  await engine.query(
    `INSERT INTO observation_field_quality
       (field_quality_id, observation_id, field_path, value_raw, quality_codes)
     VALUES ($1,$2,$3,$4,$5)`,
    [
      input.fieldQualityId,
      input.observationId,
      input.fieldPath,
      input.valueRaw ?? null,
      validated.map(String),
    ],
  );
}

export interface StoredFieldQuality {
  readonly fieldQualityId: string;
  readonly observationId: string;
  readonly fieldPath: string;
  readonly valueRaw: string | null;
  readonly qualityCodes: readonly string[];
}

/** All recorded field-quality rows of one observation. */
export async function fieldQualityForObservation(
  engine: DatabaseEngine,
  observationId: string,
): Promise<readonly StoredFieldQuality[]> {
  const rows = await engine.query<{
    field_quality_id: string;
    observation_id: string;
    field_path: string;
    value_raw: string | null;
    quality_codes: string[];
  }>(
    `SELECT field_quality_id, observation_id, field_path, value_raw, quality_codes
     FROM observation_field_quality WHERE observation_id = $1 ORDER BY field_path`,
    [observationId],
  );
  return rows.rows.map((r) => ({
    fieldQualityId: r.field_quality_id,
    observationId: r.observation_id,
    fieldPath: r.field_path,
    valueRaw: r.value_raw,
    qualityCodes: r.quality_codes,
  }));
}

/** The quality state of a single stored field. */
export type FieldQualityState =
  | 'USABLE' // non-null value carrying no adverse coding
  | 'CODED_NULL' // explicit null with explanatory codes
  | 'CODED_VALUE'; // non-null value with precision/provenance caveats

export function fieldQualityStateOf(field: StoredFieldQuality): FieldQualityState {
  if (field.valueRaw === null) return 'CODED_NULL';
  const adverse = field.qualityCodes.some((c) => c !== 'VALID');
  return adverse ? 'CODED_VALUE' : 'USABLE';
}

/** Query API: fields filtered by quality state across observations. */
export async function fieldsByQualityState(
  engine: DatabaseEngine,
  filter: {
    state?: FieldQualityState;
    code?: QualityCode;
    observationIds?: readonly string[];
    limit?: number;
  } = {},
): Promise<readonly StoredFieldQuality[]> {
  const params: unknown[] = [];
  const clauses: string[] = [];

  if (filter.code !== undefined) {
    params.push(qualityCode(filter.code));
    clauses.push(`$${params.length} = ANY(quality_codes)`);
  }
  if (filter.observationIds !== undefined) {
    params.push(filter.observationIds.map(String));
    clauses.push(`observation_id = ANY($${params.length})`);
  }
  switch (filter.state) {
    case 'USABLE':
      clauses.push(
        "value_raw IS NOT NULL AND NOT EXISTS (SELECT 1 FROM unnest(quality_codes) c WHERE c <> 'VALID')",
      );
      break;
    case 'CODED_NULL':
      clauses.push('value_raw IS NULL');
      break;
    case 'CODED_VALUE':
      clauses.push(
        "value_raw IS NOT NULL AND EXISTS (SELECT 1 FROM unnest(quality_codes) c WHERE c <> 'VALID')",
      );
      break;
    default:
      break;
  }

  const where = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '';
  params.push(filter.limit ?? 500);
  const rows = await engine.query<{
    field_quality_id: string;
    observation_id: string;
    field_path: string;
    value_raw: string | null;
    quality_codes: string[];
  }>(
    `SELECT field_quality_id, observation_id, field_path, value_raw, quality_codes
     FROM observation_field_quality ${where} ORDER BY observation_id, field_path
     LIMIT $${params.length}`,
    params,
  );
  return rows.rows.map((r) => ({
    fieldQualityId: r.field_quality_id,
    observationId: r.observation_id,
    fieldPath: r.field_path,
    valueRaw: r.value_raw,
    qualityCodes: r.quality_codes,
  }));
}
