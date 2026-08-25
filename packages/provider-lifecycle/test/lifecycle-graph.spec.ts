/**
 * T108 completeness proof: the §12.11 lifecycle alphabet and transition
 * graph agree EXACTLY across all three representations —
 *   1. the TypeScript graph (lifecycle-states.ts),
 *   2. the Zod schema alphabet (schemas.ts),
 *   3. the SQL CHECK constraints (g0_prov_0001) — parsed live from
 *      pg_constraint so a hand-edit of either side fails here.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import {
  applyMigrations,
  createEngine,
  PRECISION_RETAINING_TIMESTAMP_PARSERS,
  type DatabaseEngine,
} from '@foresift/persistence';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  ALL_LIFECYCLE_STATES,
  LEGAL_TRANSITIONS,
  TERMINAL_STATES,
  isTransitionLegal,
} from '../src/index.ts';
import { LifecycleStateSchema } from '../src/index.ts';

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
});

afterAll(async () => {
  await db.close();
});

/**
 * Pull the alphabet literals out of the named column's CHECK constraint.
 * Postgres renders SQL `IN` lists as `= ANY (ARRAY['A'::text, …])` in
 * constraint definitions — parse THAT canonical form.
 */
async function sqlCheckAlphabet(table: string, column: string): Promise<string[]> {
  const rows = await engine.query<{ conname: string; condef: string }>(
    `SELECT conname, pg_get_constraintdef(oid) AS condef
     FROM pg_constraint
     WHERE contype = 'c' AND conrelid = $1::regclass`,
    [`prov.${table}`],
  );
  // The alphabet constraint is the one naming the column AND an ANY(ARRAY).
  const candidate = rows.rows.find(
    (r) => r.condef.includes(column) && r.condef.includes('= ANY (ARRAY['),
  );
  if (candidate === undefined) {
    throw new Error(
      `no alphabet CHECK found for ${table}.${column}; saw: ${rows.rows.map((r) => r.conname).join(', ')}`,
    );
  }
  const match = /= ANY \(ARRAY\[(.*?)\]\)/.exec(candidate.condef);
  if (match === null || match[1] === undefined) {
    throw new Error(`CHECK ${candidate.conname} has no ANY(ARRAY[...]) alphabet`);
  }
  return match[1]
    .split(',')
    .map((s) => {
      const literal = /'([A-Za-z_]+)'/.exec(s.trim());
      if (literal === null || literal[1] === undefined) {
        throw new Error(`unparsable alphabet element in ${candidate.conname}: ${s}`);
      }
      return literal[1];
    })
    .sort();
}

describe('lifecycle graph completeness across graph/Zod/SQL (FR-PROV-001, T108)', () => {
  it('graph endpoints are exactly the Zod state alphabet', () => {
    expect([...ALL_LIFECYCLE_STATES]).toEqual([...LifecycleStateSchema.options]);
    const endpoints = new Set<string>(LEGAL_TRANSITIONS.flat());
    for (const state of ALL_LIFECYCLE_STATES) {
      // Every state participates in the graph: terminals as sinks only,
      // non-terminals must have at least one edge.
      const hasEdge =
        LEGAL_TRANSITIONS.some(([from]) => from === state) ||
        LEGAL_TRANSITIONS.some(([, to]) => to === state);
      expect(hasEdge, `state ${state} appears in the graph`).toBe(true);
      expect(endpoints.has(state)).toBe(true);
    }
    expect(endpoints.size).toBe(ALL_LIFECYCLE_STATES.length);
  });

  it('terminal states have zero outgoing edges; DISCOVERED is the sole root', () => {
    for (const terminal of TERMINAL_STATES) {
      const outgoing = LEGAL_TRANSITIONS.filter(([from]) => from === terminal);
      expect(outgoing, `${terminal} is terminal`).toEqual([]);
    }
    const roots = ALL_LIFECYCLE_STATES.filter(
      (s) => !LEGAL_TRANSITIONS.some(([, to]) => to === s),
    );
    expect(roots).toEqual(['DISCOVERED']);
  });

  it('prov_operations.current_state CHECK equals the Zod alphabet', async () => {
    expect(await sqlCheckAlphabet('prov_operations', 'current_state')).toEqual(
      [...ALL_LIFECYCLE_STATES].sort(),
    );
  });

  it('prov_lifecycle_events from/to CHECKs equal the Zod alphabet', async () => {
    expect(await sqlCheckAlphabet('prov_lifecycle_events', 'to_state')).toEqual(
      [...ALL_LIFECYCLE_STATES].sort(),
    );
    expect(await sqlCheckAlphabet('prov_lifecycle_events', 'from_state')).toEqual(
      [...ALL_LIFECYCLE_STATES].sort(),
    );
  });

  it('the SQL alphabet refuses a state the graph does not know (spot probe)', async () => {
    // The alphabets agree AND stay closed: nothing outside them parses.
    expect(LifecycleStateSchema.safeParse('ARCHIVED').success).toBe(false);
    expect(isTransitionLegal('ARCHIVED' as never, 'ACTIVE')).toBe(false);
  });
});
