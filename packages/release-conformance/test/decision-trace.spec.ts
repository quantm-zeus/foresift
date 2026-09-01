/**
 * Unit suite for decision trace store, fail-closed assembly, and point-in-time retrieval (FR-TRACE-005 / AC-267).
 */
/* eslint-disable @typescript-eslint/no-explicit-any -- salvaged lane tests: mock objects cast against a runtime-typed surface (see tests/automation/state-authority-v2.spec.ts convention) */
import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
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
  assembleDecisionTrace,
  recordDecisionTrace,
  fetchDecisionTraceByRef,
  fetchDecisionTraceById,
} from '../src/index.ts';
import {
  VALID_DECISION_TRACE_INPUT,
  VALID_DECISION_TRACE_RECORD as _VALID_DECISION_TRACE_RECORD,
  MISSING_DIMENSION_FIXTURES,
} from '../../../tests/fixtures/trace/index.ts';

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

describe('decision trace assembly and point-in-time store (FR-TRACE-005, AC-267)', () => {
  describe('fail-closed assembly with content addressing', () => {
    it('assembles a complete valid DecisionTraceRecord with deterministic content-addressed traceId', () => {
      const trace = assembleDecisionTrace(VALID_DECISION_TRACE_INPUT);
      expect(trace).toBeDefined();
      expect(trace.traceId.startsWith('trc-')).toBe(true);
      expect(trace.decisionRef).toBe(VALID_DECISION_TRACE_INPUT.decisionRef);
      expect(trace.manifestSha256).toBe(VALID_DECISION_TRACE_INPUT.manifestSha256);
      expect(trace.policyVersions).toEqual(VALID_DECISION_TRACE_INPUT.policyVersions);
    });

    for (const [missingDim, fixture] of Object.entries(MISSING_DIMENSION_FIXTURES)) {
      it(`refuses assembly when missing required dimension '${missingDim}' naming the exact dimension`, () => {
        expect(() => assembleDecisionTrace(fixture as any)).toThrow(
          new RegExp(`${missingDim}|missing required dimension`, 'i'),
        );
      });
    }
  });

  describe('insert-only persistence and point-in-time fetch', () => {
    it('persists a decision trace and retrieves it by decisionRef', async () => {
      const trace = assembleDecisionTrace({
        ...VALID_DECISION_TRACE_INPUT,
        decisionRef: 'dec-unique-pitr-001',
      });

      await recordDecisionTrace(engine, trace);

      const fetched = await fetchDecisionTraceByRef(engine, 'dec-unique-pitr-001');
      expect(fetched).toBeDefined();
      expect(fetched?.traceId).toBe(trace.traceId);
      expect(fetched?.manifestSha256).toBe(trace.manifestSha256);
      expect(fetched?.requirementIds).toEqual(trace.requirementIds);
      expect(fetched?.policyVersions).toEqual(trace.policyVersions);
    });

    it('retrieves a decision trace by traceId', async () => {
      const trace = assembleDecisionTrace({
        ...VALID_DECISION_TRACE_INPUT,
        decisionRef: 'dec-unique-pitr-002',
      });

      await recordDecisionTrace(engine, trace);

      const fetched = await fetchDecisionTraceById(engine, trace.traceId);
      expect(fetched).toBeDefined();
      expect(fetched?.decisionRef).toBe('dec-unique-pitr-002');
    });

    it('refuses UPDATE or DELETE mutations on trace.decision_traces (insert-only)', async () => {
      const trace = assembleDecisionTrace({
        ...VALID_DECISION_TRACE_INPUT,
        decisionRef: 'dec-immutable-check',
      });

      await recordDecisionTrace(engine, trace);

      // Mutating should be refused by refuse_mutation trigger
      await expect(
        engine.query(
          'UPDATE trace.decision_traces SET manifest_sha256 = $1 WHERE decision_ref = $2',
          [
            '0000000000000000000000000000000000000000000000000000000000000000',
            'dec-immutable-check',
          ],
        ),
      ).rejects.toThrow();

      await expect(
        engine.query('DELETE FROM trace.decision_traces WHERE decision_ref = $1', [
          'dec-immutable-check',
        ]),
      ).rejects.toThrow();
    });
  });
});
