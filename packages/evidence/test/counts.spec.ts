/**
 * Immutable matured-count projections over frozen bundles (FR-DATA-004/
 * 006, AC-247): projections are served only through replay-realizable windows;
 * counts derive from frozen-at/before-boundary evidence of RETURNED decisions
 * completed within the window; below-threshold results report honestly.
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { PGlite } from '@electric-sql/pglite';
import { ErrorCode, ForesiftError, utcTimestamp } from '@foresift/domain';
import {
  applyMigrations,
  createEngine,
  PRECISION_RETAINING_TIMESTAMP_PARSERS,
  type DatabaseEngine,
} from '@foresift/persistence';
import { projectMaturedCounts } from '../src/index.ts';

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

  // Frozen bundles: fe-1/fe-2/fe-4 freeze before the boundary; fe-3 freezes
  // AFTER it and must never count as matured at that boundary.
  const bundles: Array<[string, string]> = [
    ['fe-1', '2026-03-05T00:00:00Z'],
    ['fe-2', '2026-03-06T00:00:00Z'],
    ['fe-3', '2026-04-10T00:00:00Z'],
    ['fe-4', '2026-03-15T00:00:00Z'],
  ];
  for (const [bundleId, frozenAt] of bundles) {
    await engine.query(
      `INSERT INTO evidence_bundles (bundle_id, content_hash, manifest, frozen_at)
       VALUES ($1, $2, $3::jsonb, $4)`,
      [
        bundleId,
        // Content-addressed identity: 64 hex chars derived from the bundle id.
        `sha256:${Buffer.from(bundleId).toString('hex').padEnd(64, '0')}`,
        JSON.stringify({ bundleId }),
        utcTimestamp(frozenAt),
      ],
    );
  }

  // pd-1 RETURNED completed 03-20 with {fe-1, fe-2}; pd-2 RETURNED completed
  // 03-25 with {fe-2, fe-3}; pd-3 INVALID_RESPONSE completed 03-26 with fe-4
  // (not RETURNED → not matured). The post-boundary decision case is covered
  // by the pd-9 scenario further down.
  await engine.query(
    `INSERT INTO evidence_acquisition_decisions
       (decision_id, candidate_id, evidence_family, policy_version, state,
        requested_at, completed_at, assignment_probability, impact_recorded_at, evidence_ids)
     VALUES
       ('pd-1','cand-x','DEX_TRADES','acq-policy/v1','RETURNED',
        '2026-03-01T00:00:00Z','2026-03-20T00:00:00Z',0.3,'2026-03-01T01:00:00Z',
        ARRAY['fe-1','fe-2']),
       ('pd-2','cand-x','DEX_TRADES','acq-policy/v1','RETURNED',
        '2026-03-02T00:00:00Z','2026-03-25T00:00:00Z',0.3,'2026-03-02T01:00:00Z',
        ARRAY['fe-2','fe-3']),
       ('pd-3','cand-x','DEX_TRADES','acq-policy/v1','INVALID_RESPONSE',
        '2026-03-03T00:00:00Z','2026-03-26T00:00:00Z',0.3,'2026-03-03T01:00:00Z',
        ARRAY['fe-4'])`,
  );
}, 120_000);

afterAll(async () => {
  await db.close();
}, 30_000);

describe('projectMaturedCounts', () => {
  it('counts distinct frozen evidence of returned decisions inside the window', async () => {
    const projection = await projectMaturedCounts(engine, {
      candidateId: 'cand-x',
      evidenceFamily: 'DEX_TRADES',
      windowStartInclusive: utcTimestamp('2026-03-01T00:00:00Z'),
      windowEndInclusive: utcTimestamp('2026-03-31T00:00:00Z'),
      resolvedAt: utcTimestamp('2026-04-01T00:00:00Z'),
      promotionThreshold: 2,
    });
    // Distinct matured set: fe-1, fe-2 (fe-3 freezes after the boundary; the
    // duplicate fe-2 collapses; pd-3 is not a RETURNED outcome).
    expect(projection.maturedCount).toBe(2);
    expect(projection.promotionEligible).toBe(true);
  });

  it('reports below-threshold results honestly as ineligible', async () => {
    const projection = await projectMaturedCounts(engine, {
      candidateId: 'cand-x',
      evidenceFamily: 'DEX_TRADES',
      windowStartInclusive: utcTimestamp('2026-03-01T00:00:00Z'),
      windowEndInclusive: utcTimestamp('2026-03-21T00:00:00Z'), // only pd-1 completed by then
      resolvedAt: utcTimestamp('2026-04-01T00:00:00Z'),
      promotionThreshold: 5,
    });
    expect(projection.maturedCount).toBe(2); // fe-1, fe-2 — never inflated to reach 5
    expect(projection.promotionEligible).toBe(false);
  });

  it('refuses windows extending beyond the replay boundary', async () => {
    const err = await projectMaturedCounts(engine, {
      candidateId: 'cand-x',
      evidenceFamily: 'DEX_TRADES',
      windowStartInclusive: utcTimestamp('2026-03-01T00:00:00Z'),
      windowEndInclusive: utcTimestamp('2026-04-15T00:00:00Z'), // past resolvedAt
      resolvedAt: utcTimestamp('2026-04-01T00:00:00Z'),
      promotionThreshold: 1,
    }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ForesiftError);
    expect((err as ForesiftError).code).toBe(ErrorCode.SOURCE_FROZEN_COUNT_IMMUTABLE);
  });

  it('is stable under recomputation — a projection cannot drift once resolved', async () => {
    const request = {
      candidateId: 'cand-x' as const,
      evidenceFamily: 'DEX_TRADES' as const,
      windowStartInclusive: utcTimestamp('2026-03-01T00:00:00Z'),
      windowEndInclusive: utcTimestamp('2026-03-31T00:00:00Z'),
      resolvedAt: utcTimestamp('2026-04-01T00:00:00Z'),
      promotionThreshold: 2,
    };
    const first = await projectMaturedCounts(engine, request);
    // New evidence arrives and freezes later — the RESOLVED projection at the
    // same boundary must remain identical (frozen historical truth).
    await engine.query(
      `INSERT INTO evidence_bundles (bundle_id, content_hash, manifest, frozen_at)
       VALUES ('fe-9', $1, '{}'::jsonb, '2026-06-01T00:00:00Z')`,
      [`sha256:${'cd'.repeat(32)}`],
    );
    await engine.query(
      `INSERT INTO evidence_acquisition_decisions
         (decision_id, candidate_id, evidence_family, policy_version, state,
          requested_at, completed_at, assignment_probability, impact_recorded_at, evidence_ids)
       VALUES ('pd-9','cand-x','DEX_TRADES','acq-policy/v1','RETURNED',
               '2026-05-01T00:00:00Z','2026-05-20T00:00:00Z',0.3,'2026-05-01T01:00:00Z',
               ARRAY['fe-9'])`,
    );
    const second = await projectMaturedCounts(engine, request);
    expect(second.maturedCount).toBe(first.maturedCount);
    expect(second.promotionEligible).toBe(first.promotionEligible);
    // …and the boundary moving forward admits exactly the new item.
    const later = await projectMaturedCounts(engine, {
      ...request,
      windowStartInclusive: utcTimestamp('2026-05-01T00:00:00Z'),
      windowEndInclusive: utcTimestamp('2026-05-31T00:00:00Z'),
      resolvedAt: utcTimestamp('2026-07-01T00:00:00Z'),
    });
    expect(later.maturedCount).toBe(1);
  });
});
