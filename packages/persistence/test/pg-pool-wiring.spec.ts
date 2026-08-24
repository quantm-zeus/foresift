/**
 * Production pool parser wiring (FR-DATA-002, ADR-0014 engine
 * contract): the sanctioned `createProductionPgPool` constructor registers
 * `PRECISION_RETAINING_TIMESTAMP_PARSERS` (node-pg `types.setTypeParser`,
 * OIDs 1114/1184) at the moment of pool construction, before any Pool or
 * client exists. Driver defaults round-trip timestamps through JS Date and
 * truncate sub-millisecond digits on read-back, silently breaking byte-for-
 * byte receipt-hash round-trips — these tests pin the enforcement point so
 * the wiring cannot regress or be bypassed through the public API.
 *
 * The node-postgres module itself is not a dependency of this package; the
 * driver is injected structurally here exactly as production will inject it,
 * keeping PGlite test-only and the seam driver-free.
 */
import { describe, expect, it } from 'vitest';
import {
  createProductionPgPool,
  PRECISION_RETAINING_TIMESTAMP_PARSERS,
  wirePrecisionRetainingTimestampParsers,
  type PgDriverModule,
} from '../src/index.ts';

type Parser = (value: string) => unknown;

interface RecordedPool {
  readonly config: unknown;
}

function makeFakeDriver(): {
  driver: PgDriverModule<RecordedPool>;
  events: string[];
  registered: Map<number, Parser>;
  lastConfig: () => unknown;
} {
  const events: string[] = [];
  const registered = new Map<number, Parser>();
  let config: unknown;
  const driver: PgDriverModule<RecordedPool> = {
    types: {
      // Mirrors node-pg semantics: later registrations silently overwrite.
      setTypeParser(oid, parse) {
        registered.set(oid, parse);
        events.push(`setTypeParser:${oid}`);
      },
    },
    Pool: class {
      readonly config: unknown;
      constructor(poolConfig?: unknown) {
        this.config = poolConfig;
        config = poolConfig;
        events.push('new Pool');
      }
    },
  };
  return { driver, events, registered, lastConfig: () => config };
}

describe('createProductionPgPool wires precision-retaining timestamp parsers', () => {
  it('registers OIDs 1114 and 1184 before the first Pool exists', () => {
    const { driver, events, registered } = makeFakeDriver();

    const pool = createProductionPgPool(driver);

    expect(pool).toBeInstanceOf(driver.Pool);
    // Ordering IS the contract: parsers active before any client can query.
    expect(events).toEqual(['setTypeParser:1114', 'setTypeParser:1184', 'new Pool']);
    expect(registered.get(1114)).toBe(PRECISION_RETAINING_TIMESTAMP_PARSERS[1114]);
    expect(registered.get(1184)).toBe(PRECISION_RETAINING_TIMESTAMP_PARSERS[1184]);
  });

  it('passes configuration through to the Pool untouched', () => {
    const { driver, lastConfig } = makeFakeDriver();
    const poolConfig = { connectionString: 'postgres://example.invalid/foresift' };

    createProductionPgPool(driver, poolConfig);

    expect(lastConfig()).toBe(poolConfig);
  });

  it('registered parsers retain full fractional precision and normalize to ISO-8601 UTC', () => {
    const { driver, registered } = makeFakeDriver();
    createProductionPgPool(driver);
    const parse = registered.get(1184);
    if (parse === undefined) throw new Error('OID 1184 parser was not registered');

    expect(parse('2026-08-23 12:34:56.123456+00')).toBe('2026-08-23T12:34:56.123456Z');
    expect(parse('2026-08-23 12:34:56.5+00')).toBe('2026-08-23T12:34:56.5Z');
    expect(parse('2026-08-23 12:34:56+00')).toBe('2026-08-23T12:34:56Z');
  });

  it('registered parsers fail closed on non-UTC session text instead of reinterpreting', () => {
    const { driver, registered } = makeFakeDriver();
    createProductionPgPool(driver);
    const parse = registered.get(1114);
    if (parse === undefined) throw new Error('OID 1114 parser was not registered');

    expect(() => parse('2026-08-23 12:34:56+02')).toThrow(/unparseable UTC timestamp/);
  });

  it('re-wiring is idempotent against registries that tolerate re-registration', () => {
    const { driver, registered } = makeFakeDriver();
    createProductionPgPool(driver);

    wirePrecisionRetainingTimestampParsers(driver.types);

    expect(registered.size).toBe(2);
    expect(registered.get(1114)).toBe(PRECISION_RETAINING_TIMESTAMP_PARSERS[1114]);
    expect(registered.get(1184)).toBe(PRECISION_RETAINING_TIMESTAMP_PARSERS[1184]);
  });
});
