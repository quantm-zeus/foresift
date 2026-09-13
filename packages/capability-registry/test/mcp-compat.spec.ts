/**
 * MCP compatibility-matrix unit suite (T023, FR-PROD-005, AC-144).
 *
 * PGlite hooks carry explicit 120s timeouts (the full `prod` migration set is
 * applied per file).
 */
import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { PGlite } from '@electric-sql/pglite';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  applyMigrations,
  createEngine,
  PRECISION_RETAINING_TIMESTAMP_PARSERS,
  type DatabaseEngine,
} from '@foresift/persistence';
import {
  cellUsability,
  insertMcpCompatibilityCell,
  insertMcpConformanceRun,
  insertMcpRevision,
  insertMcpTargetClient,
  mcpCompatibilityCells,
  resolveCompatibilityMatrix,
  resolveProtocolRevision,
} from '../src/index.ts';

const MIGRATIONS_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../migrations',
);

const NOW = '2026-06-01T00:00:00Z';
const RECENT = '2026-05-01T00:00:00Z';
const STALE = '2020-01-01T00:00:00Z';
const CLIENTS = ['client-a', 'client-b', 'client-stale'] as const;

let db: PGlite;
let engine: DatabaseEngine;

beforeAll(async () => {
  db = new PGlite({ parsers: PRECISION_RETAINING_TIMESTAMP_PARSERS });
  engine = createEngine(db, 'pglite');
  await applyMigrations({ engine, migrationsDir: MIGRATIONS_DIR });
  for (const clientId of CLIENTS) {
    await insertMcpTargetClient(engine, {
      clientId,
      clientName: `Client ${clientId}`,
      version: '1.0.0',
      authMode: 'OAUTH_2_1',
    });
  }
}, 180_000);

afterAll(async () => {
  await db.close();
});

async function rejection(work: Promise<unknown>): Promise<{ code?: string }> {
  try {
    await work;
  } catch (error) {
    return error as { code?: string };
  }
  throw new Error('expected a typed refusal, but the operation succeeded');
}

async function addTestedRevision(
  revision: string,
  channel: 'STABLE' | 'DRAFT',
  staleClients: readonly string[] = [],
): Promise<void> {
  await insertMcpRevision(engine, {
    revision,
    channel,
    sdkVersion: '1.2.0',
    transport: 'STREAMABLE_HTTP',
    originPolicyRef: 'origin-1',
  });
  for (const clientId of CLIENTS) {
    const stale = staleClients.includes(clientId);
    await insertMcpCompatibilityCell(engine, {
      cellId: `${revision}-${clientId}`,
      revision,
      clientId,
      conformanceFixtureRef: `fixture-${clientId}`,
      liveTestDate: stale ? STALE : RECENT,
      result: 'PASS',
    });
    if (!revision.endsWith('-no-run')) {
      await insertMcpConformanceRun(engine, {
        runId: `run-${revision}-${clientId}`,
        revision,
        clientId,
        fixtureRef: `fixture-${clientId}`,
        result: 'PASS',
        ranAt: RECENT,
      });
    }
  }
}

describe('§69.7 compatibility matrix resolution (AC-144)', () => {
  it('resolves the baseline stable revision for every supported client through passing cells', async () => {
    await addTestedRevision('2025-11-25', 'STABLE');
    const resolution = await resolveCompatibilityMatrix(engine, { now: NOW });
    expect(resolution.defaultRevision).toBe('2025-11-25');
    expect(resolution.defaultChannel).toBe('STABLE');
    expect(resolution.cells.length).toBe(CLIENTS.length);
    for (const cell of resolution.cells) {
      expect(cell.usable, `${cell.revision}×${cell.clientId}`).toBe(true);
      expect(cell.reason).toBeNull();
    }
  }, 120_000);

  it('marks a stale or untested cell unusable and never defaults that revision', async () => {
    await addTestedRevision('2026-03-01', 'STABLE', ['client-stale']);
    await addTestedRevision('2026-04-01', 'STABLE', []);
    // Remove one run to make a cell untested.
    await engine.query(`DELETE FROM prod.mcp_conformance_runs WHERE run_id = $1`, [
      'run-2026-04-01-client-b',
    ]);

    const resolution = await resolveCompatibilityMatrix(engine, { now: NOW });
    expect(resolution.usableRevisions).toContain('2025-11-25');
    expect(resolution.usableRevisions).not.toContain('2026-03-01');
    expect(resolution.usableRevisions).not.toContain('2026-04-01');
    // With 2026-04-01 excluded, the latest usable stable remains the baseline.
    expect(resolution.defaultRevision).toBe('2025-11-25');

    const cells = await mcpCompatibilityCells(engine);
    const staleCell = cells.find(
      (cell) => cell.revision === '2026-03-01' && cell.clientId === 'client-stale',
    );
    const passingRuns = CLIENTS.map((clientId) => ({
      revision: '2026-03-01',
      clientId,
    }));
    const stale = cellUsability({
      cell: staleCell,
      passingRuns,
      revision: '2026-03-01',
      clientId: 'client-stale',
      now: NOW,
    });
    expect(stale.usable).toBe(false);
    expect(stale.reason).toBe('CELL_NOT_USABLE');
  }, 120_000);

  it('defaults to the latest mutually tested stable revision', async () => {
    await addTestedRevision('2026-01-15', 'STABLE');
    const resolution = await resolveCompatibilityMatrix(engine, { now: NOW });
    expect(resolution.defaultRevision).toBe('2026-01-15');
  }, 120_000);

  it('refuses a draft revision as the default (law and SQL) and keeps it opt-in', async () => {
    const draftDefault = await rejection(
      insertMcpRevision(engine, {
        revision: '2026-05-01-rc.1',
        channel: 'DRAFT',
        sdkVersion: '2.0.0-rc.1',
        transport: 'STREAMABLE_HTTP',
        originPolicyRef: 'origin-1',
        isDefault: true,
      }),
    );
    expect(draftDefault.code).toBe('PROD_MCP_DRAFT_DEFAULT');

    const sqlDraftDefault = await rejection(
      engine.query(
        `INSERT INTO prod.mcp_revisions
           (revision, channel, sdk_version, transport, origin_policy_ref, is_default)
         VALUES ('2026-05-02-rc.1', 'DRAFT', '2.0.0-rc.2', 'STREAMABLE_HTTP', 'origin-1', true)`,
      ),
    );
    expect(sqlDraftDefault.code).toBe('23514');

    await addTestedRevision('2026-05-01-rc.1', 'DRAFT');
    const withOptIn = await resolveCompatibilityMatrix(engine, {
      now: NOW,
      optInDraftRevision: '2026-05-01-rc.1',
    });
    expect(withOptIn.optInRevision).toBe('2026-05-01-rc.1');
    // The server default is still a stable revision.
    expect(withOptIn.defaultRevision).toBe('2026-01-15');
    if (withOptIn.optInRevision !== null) {
      expect(withOptIn.optInRevision.endsWith('-rc.1')).toBe(true);
    }
  }, 120_000);

  it('follows the declared compatibility policy for missing/unsupported revisions', async () => {
    const strictAllowed = await resolveProtocolRevision(engine, {
      requestedRevision: '2026-01-15',
      now: NOW,
      policy: 'STRICT',
    });
    expect(strictAllowed.resolvedRevision).toBe('2026-01-15');
    expect(strictAllowed.substituted).toBe(false);

    const strictUnknown = await rejection(
      resolveProtocolRevision(engine, {
        requestedRevision: '1999-01-01',
        now: NOW,
        policy: 'STRICT',
      }),
    );
    expect(strictUnknown.code).toBe('PROD_ACTIVATION_GATE_REFUSED');

    const fallback = await resolveProtocolRevision(engine, {
      requestedRevision: '1999-01-01',
      now: NOW,
      policy: 'BASELINE_FALLBACK',
    });
    expect(fallback.resolvedRevision).toBe('2025-11-25');
    expect(fallback.substituted).toBe(true);

    const optInUnknown = await rejection(
      resolveProtocolRevision(engine, {
        requestedRevision: '1999-01-01',
        now: NOW,
        policy: 'OPT_IN_ONLY',
      }),
    );
    expect(optInUnknown.code).toBe('PROD_ACTIVATION_GATE_REFUSED');

    const draftOptIn = await resolveProtocolRevision(engine, {
      requestedRevision: '2026-05-01-rc.1',
      now: NOW,
      policy: 'OPT_IN_ONLY',
      optInRevisions: ['2026-05-01-rc.1'],
    });
    expect(draftOptIn.resolvedRevision).toBe('2026-05-01-rc.1');

    const missing = await resolveProtocolRevision(engine, {
      requestedRevision: undefined,
      now: NOW,
      policy: 'BASELINE_FALLBACK',
    });
    expect(missing.resolvedRevision).toBe('2025-11-25');
    expect(missing.substituted).toBe(true);
  }, 120_000);
});
