/**
 * Field-level data quality (FR-DATA-005, §13.9): "null alone is
 * insufficient" is enforced at the repository boundary AND structurally by a
 * SQL CHECK; read APIs distinguish usable values from coded absences.
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { PGlite } from '@electric-sql/pglite';
import { chainIdentity, utcTimestamp } from '@foresift/domain';
import {
  appendObservation,
  applyMigrations,
  assertNullAloneIsInsufficient,
  createEngine,
  ensureChain,
  fieldQualityForObservation,
  fieldQualityStateOf,
  fieldsByQualityState,
  insertDex,
  insertPool,
  PRECISION_RETAINING_TIMESTAMP_PARSERS,
  recordFieldQuality,
  type DatabaseEngine,
  type ObservationInput,
} from '../src/index.ts';

const MIGRATIONS_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../migrations',
);

let db: PGlite;
let engine: DatabaseEngine;

beforeAll(async () => {
  db = new PGlite({ parsers: PRECISION_RETAINING_TIMESTAMP_PARSERS });
  engine = createEngine(db, 'pglite');
  await applyMigrations({ engine, migrationsDir: MIGRATIONS_DIR });
  // observation_field_quality FKs to observations; seed one subject pool.
  await ensureChain(engine, 'eip155:1');
  await insertDex(engine, 'eip155:1', 'uniswap');
  await insertPool(engine, {
    chainId: chainIdentity({ chainId: 'eip155:1' }).chainId,
    dexId: 'uniswap',
    poolAddress: '0x00000000000000000000000000000000c0ffee01',
  });
}, 120_000);

afterAll(async () => {
  await db.close();
}, 30_000);

function baseObservation(observationId: string): ObservationInput {
  return {
    observationId,
    subjectPoolId: 'eip155:1/uniswap/0x00000000000000000000000000000000c0ffee01',
    eventAt: utcTimestamp('2026-01-05T12:00:00Z'),
    availableAt: utcTimestamp('2026-01-05T12:00:05Z'),
    sourceObservedAt: utcTimestamp('2026-01-05T11:59:58Z'),
    fetchedAt: utcTimestamp('2026-01-05T12:00:04Z'),
    ingestedAt: utcTimestamp('2026-01-05T12:00:05Z'),
    availabilityProvenance: 'PROVIDER_LIVE_RESPONSE',
    rawAmount: '1250000000000000000',
    decimals: 18,
    qualityCodes: [],
    coordinates: {
      chainId: 'eip155:1',
      blockNumberOrSlot: '19000100',
      blockHash: '0x' + 'ab'.repeat(32),
      transactionHash: '0x' + 'cd'.repeat(32),
      transactionIndex: 7,
      confirmationLevel: 'FINALIZED',
    },
  };
}

describe('null alone is insufficient (§13.9)', () => {
  it('refuses a null with no codes at the boundary', () => {
    expect(() => assertNullAloneIsInsufficient(null, [])).toThrowError(
      /at least one explicit quality code/,
    );
  });

  it('refuses VALID as the sole explanation of a null', () => {
    expect(() => assertNullAloneIsInsufficient(null, ['VALID'])).toThrowError(
      /VALID alone cannot explain/,
    );
  });

  it('accepts a null explained by an explicit code', () => {
    expect(() => assertNullAloneIsInsufficient(null, ['MISSING_PROVIDER'])).not.toThrow();
  });

  it('the SQL CHECK refuses a coded null inserted directly', async () => {
    const obs = baseObservation('obs_quality_seed');
    await appendObservation(engine, obs);
    await expect(
      engine.query(
        `INSERT INTO observation_field_quality
           (field_quality_id, observation_id, field_path, value_raw, quality_codes)
         VALUES ('fq_bad', $1, 'payload.price', NULL, ARRAY['VALID']::text[])`,
        [obs.observationId],
      ),
    ).rejects.toThrowError(/observation_field_quality_null_requires_code/);
  });
});

describe('field-quality recording and state queries', () => {
  it('records usable, coded-value, and coded-null fields and reads them back', async () => {
    const obs = baseObservation('obs_quality_1');
    await appendObservation(engine, obs);

    await recordFieldQuality(engine, {
      fieldQualityId: 'fq_usable',
      observationId: obs.observationId,
      fieldPath: 'payload.volume_raw',
      valueRaw: '1250000',
      qualityCodes: ['VALID'],
    });
    await recordFieldQuality(engine, {
      fieldQualityId: 'fq_coded_value',
      observationId: obs.observationId,
      fieldPath: 'payload.price_usd',
      valueRaw: '3.14159',
      qualityCodes: ['ESTIMATED'],
    });
    await recordFieldQuality(engine, {
      fieldQualityId: 'fq_coded_null',
      observationId: obs.observationId,
      fieldPath: 'payload.provider_fee',
      valueRaw: null,
      qualityCodes: ['MISSING_PROVIDER'],
    });

    const stored = await fieldQualityForObservation(engine, obs.observationId);
    expect(stored.map((f) => f.fieldPath)).toEqual([
      'payload.price_usd',
      'payload.provider_fee',
      'payload.volume_raw',
    ]);
    expect(fieldQualityStateOf(stored[2]!)).toBe('USABLE');
    expect(fieldQualityStateOf(stored[0]!)).toBe('CODED_VALUE');
    expect(fieldQualityStateOf(stored[1]!)).toBe('CODED_NULL');
  });

  it('filters fields by quality state across observations', async () => {
    const usable = await fieldsByQualityState(engine, { state: 'USABLE' });
    expect(usable.length).toBeGreaterThanOrEqual(1);
    expect(usable.every((f) => f.valueRaw !== null)).toBe(true);

    const codedNulls = await fieldsByQualityState(engine, { state: 'CODED_NULL' });
    expect(codedNulls.every((f) => f.valueRaw === null)).toBe(true);
    expect(codedNulls.some((f) => f.fieldQualityId === 'fq_coded_null')).toBe(true);

    const estimated = await fieldsByQualityState(engine, { code: 'ESTIMATED' });
    expect(estimated.map((f) => f.fieldQualityId)).toEqual(['fq_coded_value']);

    const scoped = await fieldsByQualityState(engine, {
      observationIds: ['obs_quality_1'],
      limit: 10,
    });
    expect(scoped).toHaveLength(3);
  });
});
