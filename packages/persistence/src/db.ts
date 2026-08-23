/**
 * Engine port seam (ADR-001): repositories speak this narrow interface, never
 * a concrete driver. The deterministic PGlite engine is injected BY THE CALLER
 * — this module holds no static dependency on any driver package, which keeps
 * PGlite strictly test-only (ADR-0009) while production wires a real Pool.
 *
 * The seam exposes exactly two execution primitives plus transactions:
 *  - exec   : multi-statement SQL (DDL, migration scripts)
 *  - query  : parameterized statements returning rows
 *  - transaction : scoped unit of work with commit/rollback semantics
 *    (nested work uses savepoints so composition stays safe).
 */

/** Minimal structural shape required of the injected client (e.g. PGlite). */
export interface RawSqlClient {
  exec(sql: string): Promise<unknown>;
  query<T = Record<string, unknown>>(
    sql: string,
    params?: readonly unknown[],
  ): Promise<{ rows: T[]; fields?: unknown }>;
}

export interface QueryResult<T = Record<string, unknown>> {
  readonly rows: T[];
}

/** The port every repository and the migrator program against. */
export interface DatabaseEngine {
  readonly engineKind: 'pglite' | 'pg';
  /** Multi-statement SQL (DDL/scripts). No parameters. */
  exec(sql: string): Promise<void>;
  /** Parameterized statement ($1, $2, …) returning rows. */
  query<T = Record<string, unknown>>(
    sql: string,
    params?: readonly unknown[],
  ): Promise<QueryResult<T>>;
  /**
   * Run `work` atomically: committed on success, rolled back on throw.
   * Nesting is supported via savepoints.
   */
  transaction<T>(work: (engine: DatabaseEngine) => Promise<T>): Promise<T>;
}

/**
 * Process-wide savepoint sequence: keeps names unique across nesting depths
 * AND concurrent transactions without reading the wall clock — determinism
 * requirement of the DR drill harnesses.
 */
let savepointSequence = 0;

class TransactionalEngine implements DatabaseEngine {
  readonly engineKind: 'pglite' | 'pg';
  private readonly client: RawSqlClient;
  private readonly depth: number;

  constructor(client: RawSqlClient, kind: 'pglite' | 'pg', depth = 0) {
    this.client = client;
    this.engineKind = kind;
    this.depth = depth;
  }

  async exec(sql: string): Promise<void> {
    await this.client.exec(sql);
  }

  async query<T = Record<string, unknown>>(
    sql: string,
    params?: readonly unknown[],
  ): Promise<QueryResult<T>> {
    const result =
      params === undefined
        ? await this.client.query<T>(sql)
        : await this.client.query<T>(sql, params);
    return { rows: result.rows };
  }

  async transaction<T>(work: (engine: DatabaseEngine) => Promise<T>): Promise<T> {
    if (this.depth > 0) {
      const savepoint = `foresift_sp_${this.depth}_${(savepointSequence += 1)}`;
      await this.client.exec(`SAVEPOINT ${savepoint}`);
      try {
        return await work(new TransactionalEngine(this.client, this.engineKind, this.depth + 1));
      } catch (error) {
        await this.client.exec(`ROLLBACK TO SAVEPOINT ${savepoint}`);
        throw error;
      }
    }
    await this.client.exec('BEGIN');
    try {
      const result = await work(
        new TransactionalEngine(this.client, this.engineKind, this.depth + 1),
      );
      await this.client.exec('COMMIT');
      return result;
    } catch (error) {
      await this.client.exec('ROLLBACK');
      throw error;
    }
  }
}

/**
 * Wrap an already-constructed SQL client (PGlite in tests, a pg Pool client
 * wrapper in production) into the engine port.
 */
export function createEngine(client: RawSqlClient, kind: 'pglite' | 'pg'): DatabaseEngine {
  return new TransactionalEngine(client, kind, 0);
}

// --- Precision-retaining timestamp reads -------------------------------------

/** PostgreSQL text form of a UTC timestamp: `2026-01-01 12:34:56.123456+00`. */
const PG_UTC_TIMESTAMP_TEXT = /^(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}:\d{2})(\.\d+)?\+00$/;

/**
 * Convert the engine's timestamp text into the §13.1 ISO-8601 UTC shape
 * WITHOUT discarding fractional digits. Driver defaults parse `timestamptz`
 * through JS `Date`, which truncates sub-millisecond precision on read-back
 * and breaks byte-for-byte receipt-hash round-trips; these parsers keep the
 * exact stored digits and arrive as plain strings instead.
 */
function parseUtcTimestampText(value: string): string {
  const match = PG_UTC_TIMESTAMP_TEXT.exec(value);
  if (match === null) {
    // Fail closed: a non-UTC session timezone or exotic value must never be
    // silently reinterpreted (that is how precision loss shipped historically).
    throw new Error(`unparseable UTC timestamp from engine: ${JSON.stringify(value)}`);
  }
  return `${match[1]}T${match[2]}${match[3] ?? ''}Z`;
}

/**
 * Type-parser overrides for engines that accept postgres type-OID parsers
 * (PGlite `parsers`, node-pg `types.setTypeParser`): OIDs 1114 (`timestamp`)
 * and 1184 (`timestamptz`) yield normalized ISO strings retaining full
 * source precision. Every test engine wires these in; a production pool MUST
 * do the same (ADR-0009's engine contract).
 */
export const PRECISION_RETAINING_TIMESTAMP_PARSERS: Record<number, (value: string) => string> = {
  1114: parseUtcTimestampText,
  1184: parseUtcTimestampText,
};
