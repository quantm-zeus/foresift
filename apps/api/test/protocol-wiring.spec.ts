/**
 * T008: MCP Protocol Wiring & Streamable HTTP Transport suite (FR-MCP-009, §17.3, AC-144, AC-251).
 * Tests apps/api/src/mcp/protocol-wiring.ts for protocol guard composition, streamable HTTP endpoint,
 * request correlation, and draft revision opt-in constraints.
 */
import { describe, expect, it } from 'bun:test';
import { MCP_PROTOCOL_BASELINE_REVISION } from '../../../packages/shared-schemas/src/index.ts';
import {
  resolveCompatibilityMatrix,
  type McpCompatibilityResolution,
} from '../../../packages/capability-registry/src/index.ts';
import type { DatabaseEngine } from '../../../packages/persistence/src/index.ts';
import {
  VALID_AUTHORIZED_CURSOR,
  UNAUTHORIZED_CURSOR_INSPECTION,
  ACTIVE_SESSION_FIXTURE,
  SESSION_CLAIM_MISMATCH_VECTORS,
  MAXIMUM_REQUEST_BYTES,
} from '../../../tests/fixtures/mcp/index.ts';

async function loadProtocolWiringModule() {
  return await import('../src/mcp/protocol-wiring.ts');
}

const GOVERNED_NOW = '2026-06-01T00:00:00Z';
const GOVERNED_RECENT = '2026-05-01T00:00:00Z';

/**
 * A small DISPATCH-BASED stub engine (HIGH-5): the governed resolver
 * (`resolveCompatibilityMatrix`) is a pure function of four DB reads, so a
 * dispatch stub yields a REAL branded resolution without moving this file from
 * the PURE lane into DATABASE_PGLITE.
 */
function stubEngine(rows: {
  readonly revisions: readonly Record<string, unknown>[];
  readonly clients: readonly Record<string, unknown>[];
  readonly cells: readonly Record<string, unknown>[];
  readonly runs: readonly Record<string, unknown>[];
}): DatabaseEngine {
  const engine = {
    engineKind: 'pglite' as const,
    async exec(): Promise<void> {},
    async query<T = Record<string, unknown>>(sql: string): Promise<{ rows: T[] }> {
      const matched = sql.includes('FROM prod.mcp_revisions')
        ? rows.revisions
        : sql.includes('FROM prod.mcp_target_clients')
          ? rows.clients
          : sql.includes('FROM prod.mcp_compatibility_matrix')
            ? rows.cells
            : sql.includes('FROM prod.mcp_conformance_runs')
              ? rows.runs
              : [];
      return { rows: matched as T[] };
    },
    async transaction<T>(work: (inner: DatabaseEngine) => Promise<T>): Promise<T> {
      return await work(engine as unknown as DatabaseEngine);
    },
  };
  return engine as unknown as DatabaseEngine;
}

function revisionRow(revision: string, channel: string): Record<string, unknown> {
  return {
    revision,
    channel,
    sdk_version: '1.0.0',
    transport: 'STREAMABLE_HTTP',
    origin_policy_ref: 'origin-1',
    is_default: revision === MCP_PROTOCOL_BASELINE_REVISION,
    superseded_by: null,
    created_at: '2025-11-25T00:00:00Z',
  };
}

function cellRow(revision: string, clientId: string): Record<string, unknown> {
  return {
    cell_id: `${revision}-${clientId}`,
    revision,
    client_id: clientId,
    conformance_fixture_ref: `fixture-${clientId}`,
    live_test_date: GOVERNED_RECENT,
    result: 'PASS',
    notes: null,
  };
}

function runRow(revision: string, clientId: string): Record<string, unknown> {
  return {
    run_id: `run-${revision}-${clientId}`,
    revision,
    client_id: clientId,
    fixture_ref: `fixture-${clientId}`,
    result: 'PASS',
    ran_at: GOVERNED_RECENT,
  };
}

const GOVERNED_CLIENT_ID = 'client-a';
const GOVERNED_DRAFT_REVISION = '2026-draft-v2';

/**
 * A REAL governed resolution from `resolveCompatibilityMatrix`, branded by the
 * capability-registry `WeakSet`. The protocol admission requires this brand.
 */
async function governedAdmission(
  options: { readonly optIn?: readonly string[] } = {},
): Promise<McpCompatibilityResolution> {
  const revisions = [revisionRow(MCP_PROTOCOL_BASELINE_REVISION, 'STABLE')];
  const cells = [cellRow(MCP_PROTOCOL_BASELINE_REVISION, GOVERNED_CLIENT_ID)];
  const runs = [runRow(MCP_PROTOCOL_BASELINE_REVISION, GOVERNED_CLIENT_ID)];
  if (options.optIn !== undefined) {
    revisions.push(revisionRow(GOVERNED_DRAFT_REVISION, 'DRAFT'));
    cells.push(cellRow(GOVERNED_DRAFT_REVISION, GOVERNED_CLIENT_ID));
    runs.push(runRow(GOVERNED_DRAFT_REVISION, GOVERNED_CLIENT_ID));
  }
  return await resolveCompatibilityMatrix(
    stubEngine({
      revisions,
      clients: [
        {
          client_id: GOVERNED_CLIENT_ID,
          client_name: 'Client A',
          version: '1.0.0',
          auth_mode: 'OAUTH_2_1',
        },
      ],
      cells,
      runs,
    }),
    {
      now: GOVERNED_NOW,
      ...(options.optIn === undefined ? {} : { optInDraftRevisions: options.optIn }),
    },
  );
}

describe('T008: MCP protocol wiring & Streamable HTTP transport (AC-144, AC-251)', () => {
  it('admits standard baseline revision 2025-11-25 and supported content types', async () => {
    const { createMcpProtocolMiddleware } = await loadProtocolWiringModule();
    const middleware = createMcpProtocolMiddleware({
      maxMessageBytes: MAXIMUM_REQUEST_BYTES,
      admission: await governedAdmission(),
    });

    const result = middleware.inspectRequest({
      protocolRevision: MCP_PROTOCOL_BASELINE_REVISION,
      contentType: 'application/json; charset=utf-8',
      method: 'POST',
      messageBytes: 2048,
    });
    expect(result.allowed).toBe(true);
  });

  it('refuses draft revisions unless explicitly opted in via configuration', async () => {
    const { createMcpProtocolMiddleware } = await loadProtocolWiringModule();
    // Default config: draft revision refused
    const defaultMiddleware = createMcpProtocolMiddleware({
      maxMessageBytes: MAXIMUM_REQUEST_BYTES,
      admission: await governedAdmission(),
    });
    const defaultResult = defaultMiddleware.inspectRequest({
      protocolRevision: '2026-draft-v2',
      contentType: 'application/json',
      method: 'POST',
      messageBytes: 1024,
    });
    expect(defaultResult.allowed).toBe(false);
    expect(defaultResult.reason).toBe('REVISION_UNSUPPORTED');

    // Opt-in config: the governed resolver validates the registered DRAFT and
    // places it in `optInRevisions` (never in `usableRevisions`).
    const optInMiddleware = createMcpProtocolMiddleware({
      maxMessageBytes: MAXIMUM_REQUEST_BYTES,
      admission: await governedAdmission({ optIn: [GOVERNED_DRAFT_REVISION] }),
    });
    const optInResult = optInMiddleware.inspectRequest({
      protocolRevision: '2026-draft-v2',
      contentType: 'application/json',
      method: 'POST',
      messageBytes: 1024,
    });
    expect(optInResult.allowed).toBe(true);
  });

  it('enforces POST method and application/json content type', async () => {
    const { createMcpProtocolMiddleware } = await loadProtocolWiringModule();
    const middleware = createMcpProtocolMiddleware({
      maxMessageBytes: MAXIMUM_REQUEST_BYTES,
      admission: await governedAdmission(),
    });

    const getResult = middleware.inspectRequest({
      protocolRevision: MCP_PROTOCOL_BASELINE_REVISION,
      contentType: 'application/json',
      method: 'GET',
      messageBytes: 100,
    });
    expect(getResult.allowed).toBe(false);
    expect(getResult.reason).toBe('METHOD_INVALID');

    const formResult = middleware.inspectRequest({
      protocolRevision: MCP_PROTOCOL_BASELINE_REVISION,
      contentType: 'application/x-www-form-urlencoded',
      method: 'POST',
      messageBytes: 100,
    });
    expect(formResult.allowed).toBe(false);
    expect(formResult.reason).toBe('CONTENT_TYPE_INVALID');
  });

  it('refuses oversized payloads exceeding 256 KiB limit', async () => {
    const { createMcpProtocolMiddleware } = await loadProtocolWiringModule();
    const middleware = createMcpProtocolMiddleware({
      maxMessageBytes: MAXIMUM_REQUEST_BYTES,
      admission: await governedAdmission(),
    });

    const result = middleware.inspectRequest({
      protocolRevision: MCP_PROTOCOL_BASELINE_REVISION,
      contentType: 'application/json',
      method: 'POST',
      messageBytes: MAXIMUM_REQUEST_BYTES + 1,
    });
    expect(result.allowed).toBe(false);
    expect(result.reason).toBe('MESSAGE_OVERSIZE');
  });

  it('enforces session binding claims matching established session', async () => {
    const { createMcpProtocolMiddleware } = await loadProtocolWiringModule();
    const middleware = createMcpProtocolMiddleware({
      maxMessageBytes: MAXIMUM_REQUEST_BYTES,
      admission: await governedAdmission(),
    });

    for (const vector of SESSION_CLAIM_MISMATCH_VECTORS) {
      const result = middleware.inspectRequest({
        protocolRevision: MCP_PROTOCOL_BASELINE_REVISION,
        contentType: 'application/json',
        method: 'POST',
        messageBytes: 512,
        session: {
          actor: ACTIVE_SESSION_FIXTURE.actor,
          profileId: ACTIVE_SESSION_FIXTURE.profileId,
          origin: ACTIVE_SESSION_FIXTURE.origin,
          protocolRevision: ACTIVE_SESSION_FIXTURE.protocolRevision,
        },
        requestClaims: vector.requestClaims,
      });
      expect(result.allowed, vector.name).toBe(false);
      expect(result.reason, vector.name).toBe('SESSION_BINDING_INVALID');
    }
  });

  it('validates resumable-cursor authorization', async () => {
    const { createMcpProtocolMiddleware } = await loadProtocolWiringModule();
    const middleware = createMcpProtocolMiddleware({
      maxMessageBytes: MAXIMUM_REQUEST_BYTES,
      admission: await governedAdmission(),
    });

    // Valid cursor
    const validResult = middleware.inspectRequest({
      protocolRevision: MCP_PROTOCOL_BASELINE_REVISION,
      contentType: 'application/json',
      method: 'POST',
      messageBytes: 512,
      resumableCursor: {
        cursor: VALID_AUTHORIZED_CURSOR.cursor,
        authorized: true,
      },
    });
    expect(validResult.allowed).toBe(true);

    // Unauthorized cursor
    const unauthResult = middleware.inspectRequest({
      protocolRevision: MCP_PROTOCOL_BASELINE_REVISION,
      contentType: 'application/json',
      method: 'POST',
      messageBytes: 512,
      resumableCursor: UNAUTHORIZED_CURSOR_INSPECTION,
    });
    expect(unauthResult.allowed).toBe(false);
    expect(unauthResult.reason).toBe('CURSOR_UNAUTHORIZED');
  });

  it('preserves JSON-RPC request-response correlation over Streamable HTTP transport', async () => {
    const { correlateJsonRpc } = await loadProtocolWiringModule();
    const request = { jsonrpc: '2.0', id: 'corr-req-001', method: 'ping' };
    const responsePayload = { status: 'ok' };

    const correlated = correlateJsonRpc(request.id, responsePayload);
    expect(correlated.jsonrpc).toBe('2.0');
    expect(correlated.id).toBe('corr-req-001');
    expect(correlated.result).toEqual(responsePayload);
  });
});

/**
 * V7-F9 fail-open: `McpProtocolWiring`'s constructor took free-form
 * `mutuallyTestedRevisions`/`draftRevisions`/`optInDraftRevisions` and
 * `createMcpProtocolMiddleware` forwarded a free-form `allowedRevisions`
 * verbatim, so a caller could admit `'TOTALLY-UNREGISTERED-EVIL'`. The governed
 * source of an allow-list is `resolveCompatibilityMatrix` /
 * `resolveProtocolRevision` (`McpCompatibilityResolution.usableRevisions`).
 */
describe('V7 fail-open: MCP admission is governed, never caller-assembled (F9)', () => {
  it('refuses the reviewer probe through the old free-form surfaces, still admits the baseline', async () => {
    const { createMcpProtocolMiddleware, McpProtocolWiring } = await loadProtocolWiringModule();
    // A JS caller still passing the removed free-form `allowedRevisions` has no
    // admission at all — refused at construction.
    expect(() =>
      createMcpProtocolMiddleware({
        maxMessageBytes: MAXIMUM_REQUEST_BYTES,
        allowedRevisions: ['TOTALLY-UNREGISTERED-EVIL'],
      } as never),
    ).toThrow(/admission/);
    expect(
      () =>
        new McpProtocolWiring({
          maximumRequestBytes: MAXIMUM_REQUEST_BYTES,
          mutuallyTestedRevisions: ['TOTALLY-UNREGISTERED-EVIL'],
        } as never),
    ).toThrow(/admission/);

    // A hand-assembled admission naming an unregistered revision is refused
    // before any guard is built: it cannot carry the capability-registry
    // provenance brand that only `resolveCompatibilityMatrix` can mint.
    expect(
      () =>
        new McpProtocolWiring({
          maximumRequestBytes: MAXIMUM_REQUEST_BYTES,
          admission: {
            defaultRevision: MCP_PROTOCOL_BASELINE_REVISION,
            usableRevisions: [MCP_PROTOCOL_BASELINE_REVISION, 'TOTALLY-UNREGISTERED-EVIL'],
            optInRevisions: [],
          },
        } as never),
    ).toThrow(/provenance brand/);

    // CONTROL: a governed baseline admission still admits the baseline.
    const middleware = createMcpProtocolMiddleware({
      maxMessageBytes: MAXIMUM_REQUEST_BYTES,
      admission: await governedAdmission(),
    });
    const result = middleware.inspectRequest({
      protocolRevision: MCP_PROTOCOL_BASELINE_REVISION,
      contentType: 'application/json',
      method: 'POST',
      messageBytes: 128,
    });
    expect(result.allowed).toBe(true);
  });

  it('accepts the real resolver shape, where opted-in drafts live OUTSIDE usableRevisions', async () => {
    const { createMcpProtocolMiddleware } = await loadProtocolWiringModule();
    // `resolveCompatibilityMatrix` returns `usableRevisions: [<baseline>]` and
    // `optInRevisions: ['<draft>']` as DISJOINT lists; the adapter must admit
    // their union, exactly like `resolveProtocolRevision`.
    const middleware = createMcpProtocolMiddleware({
      maxMessageBytes: MAXIMUM_REQUEST_BYTES,
      admission: await governedAdmission({ optIn: [GOVERNED_DRAFT_REVISION] }),
    });
    const optedIn = middleware.inspectRequest({
      protocolRevision: '2026-draft-v2',
      contentType: 'application/json',
      method: 'POST',
      messageBytes: 64,
    });
    expect(optedIn.allowed).toBe(true);
  });

  it('refuses every caller-declared or ungoverned revision list with a typed TypeError (HIGH-5)', async () => {
    const { createMcpProtocolMiddleware } = await loadProtocolWiringModule();
    const base = { maxMessageBytes: MAXIMUM_REQUEST_BYTES };
    const cases: readonly unknown[] = [
      { ...base, admission: undefined },
      { ...base, admission: null },
      { ...base, admission: 'baseline' },
      // The old free-form revision list.
      { ...base, admission: { allowedRevisions: ['TOTALLY-UNREGISTERED-EVIL'] } },
      // A resolver-SHAPED object a caller assembled by hand, naming an
      // unregistered revision.
      {
        ...base,
        admission: {
          defaultRevision: MCP_PROTOCOL_BASELINE_REVISION,
          usableRevisions: [MCP_PROTOCOL_BASELINE_REVISION, 'TOTALLY-UNREGISTERED-EVIL'],
          optInRevisions: [],
        },
      },
      // A resolver-SHAPED object with a non-baseline default.
      {
        ...base,
        admission: {
          defaultRevision: '2026-draft-v2',
          usableRevisions: ['2026-draft-v2'],
          optInRevisions: [],
        },
      },
      // An empty usableRevisions set.
      {
        ...base,
        admission: {
          defaultRevision: MCP_PROTOCOL_BASELINE_REVISION,
          usableRevisions: [],
          optInRevisions: [],
        },
      },
    ];
    for (const options of cases) {
      expect(() => createMcpProtocolMiddleware(options as never)).toThrow(TypeError);
    }
  });

  it('refuses a structuredClone of a real governed resolution (HIGH-5)', async () => {
    const { createMcpProtocolMiddleware } = await loadProtocolWiringModule();
    const real = await governedAdmission();
    const clone = structuredClone(real);
    expect(() =>
      createMcpProtocolMiddleware({
        maxMessageBytes: MAXIMUM_REQUEST_BYTES,
        admission: clone as never,
      }),
    ).toThrow(/provenance brand/);
  });

  it('uses the resolver defaultRevision (never a hard-pinned baseline) (HIGH-5/L1)', async () => {
    const { createMcpProtocolMiddleware } = await loadProtocolWiringModule();
    // A governed resolution whose mutually tested default is NOT the baseline
    // must be admitted on its own defaultRevision.
    const resolution = await resolveCompatibilityMatrix(
      stubEngine({
        revisions: [
          revisionRow(MCP_PROTOCOL_BASELINE_REVISION, 'STABLE'),
          revisionRow('2026-01-15', 'STABLE'),
        ],
        clients: [
          {
            client_id: GOVERNED_CLIENT_ID,
            client_name: 'Client A',
            version: '1.0.0',
            auth_mode: 'OAUTH_2_1',
          },
        ],
        cells: [
          cellRow(MCP_PROTOCOL_BASELINE_REVISION, GOVERNED_CLIENT_ID),
          cellRow('2026-01-15', GOVERNED_CLIENT_ID),
        ],
        runs: [
          runRow(MCP_PROTOCOL_BASELINE_REVISION, GOVERNED_CLIENT_ID),
          runRow('2026-01-15', GOVERNED_CLIENT_ID),
        ],
      }),
      { now: GOVERNED_NOW },
    );
    expect(resolution.defaultRevision).toBe('2026-01-15');
    const middleware = createMcpProtocolMiddleware({
      maxMessageBytes: MAXIMUM_REQUEST_BYTES,
      admission: resolution,
    });
    const result = middleware.inspectRequest({
      protocolRevision: '2026-01-15',
      contentType: 'application/json',
      method: 'POST',
      messageBytes: 64,
    });
    expect(result.allowed).toBe(true);
  });

  it('returns the snapshot-derived revision and a frozen payload copy (HIGH-5)', async () => {
    const { McpProtocolWiring } = await loadProtocolWiringModule();
    const wiring = new McpProtocolWiring({
      maximumRequestBytes: MAXIMUM_REQUEST_BYTES,
      admission: await governedAdmission(),
    });
    const payload = { jsonrpc: '2.0', id: 7, method: 'ping' };
    const admission = wiring.inspect({
      protocolRevision: MCP_PROTOCOL_BASELINE_REVISION,
      contentType: 'application/json',
      method: 'POST',
      messageBytes: 32,
      payload,
    });
    expect(admission.allowed).toBe(true);
    if (admission.allowed) {
      expect(admission.protocolRevision).toBe(MCP_PROTOCOL_BASELINE_REVISION);
      expect(admission.request).toEqual(payload);
      expect(admission.request).not.toBe(payload);
      expect(Object.isFrozen(admission.request)).toBe(true);
    }
  });
});
