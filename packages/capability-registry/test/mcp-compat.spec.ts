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
import { McpProtocolGuard } from '@foresift/security';
import {
  cellUsability,
  insertMcpCompatibilityCell,
  insertMcpConformanceRun,
  insertMcpRevision,
  insertMcpTargetClient,
  isGovernedMcpCompatibilityResolution,
  mcpCompatibilityCells,
  resolveCompatibilityMatrix,
  resolveProtocolRevision,
  snapshotCallerInput,
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

async function rejection(
  work: Promise<unknown>,
): Promise<{ code?: string; detail?: { readonly reason?: string } }> {
  try {
    await work;
  } catch (error) {
    return error as { code?: string; detail?: { readonly reason?: string } };
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
      fixtureRef: `fixture-${clientId}`,
      ranAt: RECENT,
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

describe('MCP opt-in validation and conformance provenance (C3/H10 regressions)', () => {
  it('refuses an unregistered opt-in revision instead of injecting it into the allow-list (C3 exploit)', async () => {
    // The pre-fix bypass: the raw string was added to the guard allow-list and
    // returned ALLOW for a revision that was never registered or tested.
    const refused = await rejection(
      resolveProtocolRevision(engine, {
        requestedRevision: '2099-01-01-evil',
        now: NOW,
        policy: 'OPT_IN_ONLY',
        optInRevisions: ['2099-01-01-evil'],
      }),
    );
    expect(refused.code).toBe('PROD_MCP_REVISION_CHANNEL_UNKNOWN');
    expect(refused.detail?.reason).toBe('REVISION_UNKNOWN');

    const matrixRefused = await rejection(
      resolveCompatibilityMatrix(engine, {
        now: NOW,
        optInDraftRevisions: ['2099-01-01-evil'],
      }),
    );
    expect(matrixRefused.code).toBe('PROD_MCP_REVISION_CHANNEL_UNKNOWN');
  }, 120_000);

  it('refuses a registered STABLE revision smuggled through the opt-in list (C3)', async () => {
    const refused = await rejection(
      resolveProtocolRevision(engine, {
        requestedRevision: '2026-01-15',
        now: NOW,
        policy: 'OPT_IN_ONLY',
        optInRevisions: ['2026-01-15'],
      }),
    );
    expect(refused.code).toBe('PROD_MCP_DRAFT_DEFAULT');
    expect(refused.detail?.reason).toBe('DRAFT_NOT_OPTED_IN');
  }, 120_000);

  it('refuses a DRAFT opt-in with no usable conformance cell for every client (C3)', async () => {
    await addTestedRevision('2026-07-01-rc.1', 'DRAFT', ['client-b']);
    const refused = await rejection(
      resolveCompatibilityMatrix(engine, {
        now: NOW,
        optInDraftRevisions: ['2026-07-01-rc.1'],
      }),
    );
    expect(refused.code).toBe('PROD_ACTIVATION_GATE_REFUSED');
    expect(refused.detail?.reason).toBe('CELL_NOT_USABLE');
  }, 120_000);

  it('does not resolve a DB-backed matrix whose only run is for a different fixture (H10)', async () => {
    await insertMcpRevision(engine, {
      revision: '2026-09-01-rc.9',
      channel: 'DRAFT',
      sdkVersion: '3.0.0-rc.9',
      transport: 'STREAMABLE_HTTP',
      originPolicyRef: 'origin-1',
    });
    for (const clientId of CLIENTS) {
      await insertMcpCompatibilityCell(engine, {
        cellId: `wrong-fixture-${clientId}`,
        revision: '2026-09-01-rc.9',
        clientId,
        conformanceFixtureRef: `fixture-${clientId}`,
        liveTestDate: RECENT,
        result: 'PASS',
      });
      await insertMcpConformanceRun(engine, {
        runId: `wrong-fixture-run-${clientId}`,
        revision: '2026-09-01-rc.9',
        clientId,
        fixtureRef: 'fixture-OTHER',
        result: 'PASS',
        ranAt: RECENT,
      });
    }
    // The DB-backed matrix must reject the fixture-mismatched runs, so the
    // draft is not mutually tested and cannot be opted in.
    const refused = await rejection(
      resolveCompatibilityMatrix(engine, {
        now: NOW,
        optInDraftRevisions: ['2026-09-01-rc.9'],
      }),
    );
    expect(refused.code).toBe('PROD_ACTIVATION_GATE_REFUSED');
    expect(refused.detail?.reason).toBe('CELL_NOT_USABLE');
  }, 120_000);

  it('never lets a run for a different fixture satisfy a cell (H10 provenance)', () => {
    const cell = {
      cellId: 'prov-cell',
      revision: '2099-01-01',
      clientId: 'client-a',
      conformanceFixtureRef: 'fixture-a',
      liveTestDate: RECENT,
      result: 'PASS' as const,
      notes: null,
    };
    const wrongFixture = cellUsability({
      cell,
      passingRuns: [
        {
          revision: '2099-01-01',
          clientId: 'client-a',
          fixtureRef: 'fixture-OTHER',
          ranAt: RECENT,
        },
      ],
      revision: '2099-01-01',
      clientId: 'client-a',
      now: NOW,
    });
    expect(wrongFixture.usable).toBe(false);
    expect(wrongFixture.reason).toBe('CELL_NOT_USABLE');

    const matching = cellUsability({
      cell,
      passingRuns: [
        { revision: '2099-01-01', clientId: 'client-a', fixtureRef: 'fixture-a', ranAt: RECENT },
      ],
      revision: '2099-01-01',
      clientId: 'client-a',
      now: NOW,
    });
    expect(matching.usable).toBe(true);
  });

  it('cannot widen the staleness window with a caller override (H10 staleness)', () => {
    const cell = {
      cellId: 'stale-cell',
      revision: '2099-02-01',
      clientId: 'client-a',
      conformanceFixtureRef: 'fixture-a',
      liveTestDate: STALE,
      result: 'PASS' as const,
      notes: null,
    };
    const stale = cellUsability({
      cell,
      passingRuns: [
        { revision: '2099-02-01', clientId: 'client-a', fixtureRef: 'fixture-a', ranAt: STALE },
      ],
      revision: '2099-02-01',
      clientId: 'client-a',
      now: NOW,
      // The pre-fix bypass: an enormous override kept a stale cell usable.
      maxAgeSeconds: 1e12,
    });
    expect(stale.usable).toBe(false);
    expect(stale.reason).toBe('CELL_NOT_USABLE');
  });

  /**
   * R11 (audit fifth round). `McpProtocolGuard.inspect` tested the allow-list
   * with `allowedRevisions.includes(...)` and `resolveProtocolRevision` trusted
   * the guard verdict with no numeric re-check. Shadowing
   * `Array.prototype.includes` to return `true` therefore made the guard ALLOW
   * any requested revision, re-opening audit C3 at the FR-PROD-003 surface.
   */
  it('R11: a shadowed Array.prototype.includes cannot ALLOW an arbitrary MCP revision', async () => {
    // Guarantee at least one mutually tested STABLE revision exists.
    await addTestedRevision('2026-12-01', 'STABLE');

    const proto = Array.prototype as unknown as Record<string, unknown>;
    const originalIncludes = proto['includes'];
    // Surgical: only an allow-list that actually carries the sentinel revision
    // is widened, so real PGlite query plumbing in this test keeps its native
    // `includes` semantics.
    proto['includes'] = function (this: unknown, search: unknown): boolean {
      const self = this as unknown[];
      if (Array.isArray(self)) {
        let sentinel = false;
        for (let index = 0; index < self.length; index += 1) {
          if (self[index] === '2026-12-01') {
            sentinel = true;
            break;
          }
        }
        if (sentinel) return true;
      }
      return (originalIncludes as (this: unknown, value: unknown) => boolean).call(self, search);
    };
    try {
      // 1. The guard's own membership test must stay exact.
      const guard = new McpProtocolGuard({
        allowedRevisions: ['2026-12-01'],
        maxMessageBytes: 1024,
      });
      const direct = guard.inspect({
        protocolRevision: '2099-01-01-evil',
        contentType: 'application/json',
        method: 'POST',
        messageBytes: 1,
      });
      expect(direct.decision).toBe('REFUSE');

      // 2. The FR-PROD-003 surface must never trust a defeated guard verdict.
      //    (Defence in depth: with the guard hardened this path already refuses
      //    via the declared policy; the assertion stays as the surface check.)
      const refused = await rejection(
        resolveProtocolRevision(engine, {
          requestedRevision: '2099-01-01-evil',
          now: NOW,
          policy: 'OPT_IN_ONLY',
        }),
      );
      expect(refused.code).toBe('PROD_ACTIVATION_GATE_REFUSED');
    } finally {
      proto['includes'] = originalIncludes;
    }
  }, 120_000);
});

/**
 * Sixth-round independent verification (V6-1/V6-2). `cellUsability` counted a
 * FUTURE-dated run as fresh, a malformed `now` disabled the staleness comparison
 * (`NaN > bound` is false), and `'' === ''` satisfied fixture provenance. All
 * three made a non-existent or stale test satisfy a production-readiness cell.
 */
describe('MCP conformance freshness and fixture provenance (V6-1/V6-2 regressions)', () => {
  const cell = {
    cellId: 'v6-cell',
    revision: '2099-03-01',
    clientId: 'client-a',
    conformanceFixtureRef: 'fixture-a',
    liveTestDate: RECENT,
    result: 'PASS' as const,
    notes: null,
  };

  it('V6-1: a FUTURE-dated conformance run is not evidence that a test happened', () => {
    const future = cellUsability({
      cell,
      passingRuns: [
        {
          revision: '2099-03-01',
          clientId: 'client-a',
          fixtureRef: 'fixture-a',
          ranAt: '2030-01-01T00:00:00Z',
        },
      ],
      revision: '2099-03-01',
      clientId: 'client-a',
      now: NOW,
    });
    expect(future.usable).toBe(false);
    expect(future.reason).toBe('CELL_NOT_USABLE');
  });

  it('V6-1: a malformed `now` yields a typed refusal rather than a throw', () => {
    // At `29f1841` the malformed instant reached `mcpCompatibilityCellUsable`
    // and threw `TIMESTAMP_INVALID`; the hardening returns the same fail-closed
    // outcome as a typed verdict so the caller never has to catch a domain throw.
    let malformed: ReturnType<typeof cellUsability> | undefined;
    expect(() => {
      malformed = cellUsability({
        cell,
        passingRuns: [
          { revision: '2099-03-01', clientId: 'client-a', fixtureRef: 'fixture-a', ranAt: STALE },
        ],
        revision: '2099-03-01',
        clientId: 'client-a',
        now: 'not-an-instant',
      });
    }).not.toThrow();
    expect(malformed?.usable).toBe(false);
    expect(malformed?.reason).toBe('CELL_NOT_USABLE');
  });

  it('V6-1: a valid in-window run still satisfies the cell (no over-refusal)', () => {
    const matching = cellUsability({
      cell,
      passingRuns: [
        { revision: '2099-03-01', clientId: 'client-a', fixtureRef: 'fixture-a', ranAt: RECENT },
      ],
      revision: '2099-03-01',
      clientId: 'client-a',
      now: NOW,
    });
    expect(matching.usable).toBe(true);
  });

  it('V6-2: a blank declared fixture reference cannot be satisfied by a blank run', () => {
    const blankCell = { ...cell, conformanceFixtureRef: '' };
    const blankToBlank = cellUsability({
      cell: blankCell,
      passingRuns: [
        { revision: '2099-03-01', clientId: 'client-a', fixtureRef: '', ranAt: RECENT },
      ],
      revision: '2099-03-01',
      clientId: 'client-a',
      now: NOW,
    });
    expect(blankToBlank.usable).toBe(false);
    expect(blankToBlank.reason).toBe('CELL_NOT_USABLE');
  });

  it('V6-2: a blank run fixture reference never satisfies a non-blank cell', () => {
    const blankRun = cellUsability({
      cell,
      passingRuns: [
        { revision: '2099-03-01', clientId: 'client-a', fixtureRef: '', ranAt: RECENT },
      ],
      revision: '2099-03-01',
      clientId: 'client-a',
      now: NOW,
    });
    expect(blankRun.usable).toBe(false);
    expect(blankRun.reason).toBe('CELL_NOT_USABLE');
  });

  it('V6-2: both write sites refuse a blank fixture reference', async () => {
    // A registered revision makes both foreign keys valid, so at `29f1841` the
    // inserts SUCCEEDED (the DB CHECK only rejects length 0, not whitespace) and
    // the only reason this test fails there is the missing typed refusal.
    const revision = '2099-04-01';
    await insertMcpRevision(engine, {
      revision,
      channel: 'STABLE',
      sdkVersion: '1.2.0',
      transport: 'STREAMABLE_HTTP',
      originPolicyRef: 'origin-1',
    });

    const blankCell = await rejection(
      insertMcpCompatibilityCell(engine, {
        cellId: 'v6-blank-cell',
        revision,
        clientId: 'client-a',
        conformanceFixtureRef: '   ',
        liveTestDate: RECENT,
        result: 'PASS',
      }),
    );
    expect(blankCell.code).toBe('PROD_ACTIVATION_GATE_REFUSED');

    const blankRun = await rejection(
      insertMcpConformanceRun(engine, {
        runId: 'v6-blank-run',
        revision,
        clientId: 'client-a',
        fixtureRef: '',
        result: 'PASS',
        ranAt: RECENT,
      }),
    );
    expect(blankRun.code).toBe('PROD_ACTIVATION_GATE_REFUSED');

    // No blank row was persisted by either refused write.
    const persistedCells = await engine.query<{ cell_id: string }>(
      `SELECT cell_id FROM prod.mcp_compatibility_matrix WHERE cell_id = $1`,
      ['v6-blank-cell'],
    );
    expect(persistedCells.rows).toEqual([]);
    const persistedRuns = await engine.query<{ run_id: string }>(
      `SELECT run_id FROM prod.mcp_conformance_runs WHERE run_id = $1`,
      ['v6-blank-run'],
    );
    expect(persistedRuns.rows).toEqual([]);
  }, 120_000);
});

/**
 * HIGH-5: the governed resolver output must be distinguishable by provenance so
 * a downstream admission (`apps/api` protocol wiring) can require it. The brand
 * is keyed by object identity, so a spread copy or a `structuredClone` is
 * refused even though it is structurally identical.
 */
describe('HIGH-5: governed MCP resolution provenance brand', () => {
  it('brands a real resolution and refuses hand-built/cloned copies', async () => {
    const resolution = await resolveCompatibilityMatrix(engine, { now: NOW });
    expect(isGovernedMcpCompatibilityResolution(resolution)).toBe(true);
    expect(isGovernedMcpCompatibilityResolution({ ...resolution })).toBe(false);
    expect(isGovernedMcpCompatibilityResolution(structuredClone(resolution))).toBe(false);
    expect(isGovernedMcpCompatibilityResolution(null)).toBe(false);
    expect(isGovernedMcpCompatibilityResolution(undefined)).toBe(false);
  }, 120_000);
});

/**
 * M2: `Math.min` is captured at module init, so a same-realm caller that shadows
 * the global cannot widen (or collapse) the non-overridable freshness clamp and
 * revive a stale conformance cell.
 */
describe('M2: captured Math.min keeps the freshness clamp closed', () => {
  const staleCell = {
    cellId: 'm2-stale-cell',
    revision: '2099-03-01',
    clientId: 'client-a',
    conformanceFixtureRef: 'fixture-a',
    liveTestDate: STALE,
    result: 'PASS' as const,
    notes: null,
  };
  const freshCell = {
    cellId: 'm2-fresh-cell',
    revision: '2099-04-01',
    clientId: 'client-a',
    conformanceFixtureRef: 'fixture-a',
    liveTestDate: RECENT,
    result: 'PASS' as const,
    notes: null,
  };

  it('still refuses a stale cell when the global Math.min is shadowed wide-open', () => {
    const originalMin = Math.min;
    try {
      // A shadow that reports "no clamp at all" would otherwise keep the stale
      // run inside a caller-widened window.
      Math.min = (() => Number.MAX_SAFE_INTEGER) as typeof Math.min;
      const verdict = cellUsability({
        cell: staleCell,
        passingRuns: [
          { revision: '2099-03-01', clientId: 'client-a', fixtureRef: 'fixture-a', ranAt: STALE },
        ],
        revision: '2099-03-01',
        clientId: 'client-a',
        now: NOW,
      });
      expect(verdict.usable).toBe(false);
      expect(verdict.reason).toBe('CELL_NOT_USABLE');
    } finally {
      Math.min = originalMin;
    }
  });

  it('still admits a fresh cell when the global Math.min is shadowed to zero', () => {
    const originalMin = Math.min;
    try {
      Math.min = (() => 0) as typeof Math.min;
      const verdict = cellUsability({
        cell: freshCell,
        passingRuns: [
          { revision: '2099-04-01', clientId: 'client-a', fixtureRef: 'fixture-a', ranAt: RECENT },
        ],
        revision: '2099-04-01',
        clientId: 'client-a',
        now: NOW,
      });
      expect(verdict.usable).toBe(true);
    } finally {
      Math.min = originalMin;
    }
  });
});

/**
 * Defense-in-depth (V7-C1/H1 helper consistency): `snapshotCallerInput` must
 * materialize EVERY own string key — including non-enumerable ones — and must
 * not be collapsed by a shadowed `Array.isArray`.
 *
 * Pre-fix, `Object.keys` dropped a non-enumerable own field (a guard that treats
 * "field absent" as "no violation" can fail open), and
 * `Array.isArray = () => true` made every plain-object snapshot an EMPTY array.
 */
describe('shadow-safe snapshotCallerInput hardening', () => {
  it('materializes a non-enumerable own data field and getter exactly once', () => {
    const carrier: Record<string, unknown> = {};
    Object.defineProperty(carrier, 'hiddenData', {
      value: 'materialized',
      enumerable: false,
      writable: true,
      configurable: true,
    });
    let reads = 0;
    Object.defineProperty(carrier, 'hiddenGetter', {
      enumerable: false,
      configurable: true,
      get() {
        reads += 1;
        return 'read-once';
      },
    });
    Object.defineProperty(carrier, 'visible', {
      value: 'v',
      enumerable: true,
      writable: true,
      configurable: true,
    });
    const snapshot = snapshotCallerInput(carrier) as Record<string, unknown>;
    expect(snapshot['hiddenData']).toBe('materialized');
    expect(snapshot['hiddenGetter']).toBe('read-once');
    expect(snapshot['visible']).toBe('v');
    expect(reads).toBe(1);
  });

  it('does not collapse when the global Array.isArray is shadowed to always-true', () => {
    const originalIsArray = Array.isArray;
    try {
      (Array as unknown as { isArray: unknown }).isArray = () => true;
      const snapshot = snapshotCallerInput({ a: 1, b: 'two' }) as Record<string, unknown>;
      expect(snapshot['a']).toBe(1);
      expect(snapshot['b']).toBe('two');
      const arraySnapshot = snapshotCallerInput([1, 2]) as readonly number[];
      expect(arraySnapshot.length).toBe(2);
      expect(arraySnapshot[0]).toBe(1);
    } finally {
      (Array as unknown as { isArray: unknown }).isArray = originalIsArray;
    }
  });
});
