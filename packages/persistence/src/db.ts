/**
 * Engine port seam (ADR-001): repositories speak this narrow interface, never
 * a concrete driver. The deterministic PGlite engine is injected BY THE CALLER
 * — this module holds no static dependency on any driver package, which keeps
 * PGlite strictly test-only (ADR-0006) while production wires a real Pool.
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
      const savepoint = `foresift_sp_${this.depth}_${Date.now() % 1_000_000}`;
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
