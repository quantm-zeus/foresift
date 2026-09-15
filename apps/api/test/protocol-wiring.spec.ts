/**
 * T008: MCP Protocol Wiring & Streamable HTTP Transport suite (FR-MCP-009, §17.3, AC-144, AC-251).
 * Tests apps/api/src/mcp/protocol-wiring.ts for protocol guard composition, streamable HTTP endpoint,
 * request correlation, and draft revision opt-in constraints.
 */
import { describe, expect, it } from 'bun:test';
import { MCP_PROTOCOL_BASELINE_REVISION } from '../../../packages/shared-schemas/src/index.ts';
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

/** A resolver-shaped governed admission (the type `McpCompatibilityResolution`). */
function governedAdmission(usable: readonly string[], optIn: readonly string[] = []) {
  return {
    defaultRevision: MCP_PROTOCOL_BASELINE_REVISION,
    usableRevisions: usable,
    optInRevisions: optIn,
  };
}

describe('T008: MCP protocol wiring & Streamable HTTP transport (AC-144, AC-251)', () => {
  it('admits standard baseline revision 2025-11-25 and supported content types', async () => {
    const { createMcpProtocolMiddleware } = await loadProtocolWiringModule();
    const middleware = createMcpProtocolMiddleware({
      maxMessageBytes: MAXIMUM_REQUEST_BYTES,
      admission: governedAdmission([MCP_PROTOCOL_BASELINE_REVISION]),
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
      admission: governedAdmission([MCP_PROTOCOL_BASELINE_REVISION]),
    });
    const defaultResult = defaultMiddleware.inspectRequest({
      protocolRevision: '2026-draft-v2',
      contentType: 'application/json',
      method: 'POST',
      messageBytes: 1024,
    });
    expect(defaultResult.allowed).toBe(false);
    expect(defaultResult.reason).toBe('REVISION_UNSUPPORTED');

    // Opt-in config: draft revision admitted (the resolver puts it in usableRevisions)
    const optInMiddleware = createMcpProtocolMiddleware({
      maxMessageBytes: MAXIMUM_REQUEST_BYTES,
      admission: governedAdmission(
        [MCP_PROTOCOL_BASELINE_REVISION, '2026-draft-v2'],
        ['2026-draft-v2'],
      ),
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
      admission: governedAdmission([MCP_PROTOCOL_BASELINE_REVISION]),
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
      admission: governedAdmission([MCP_PROTOCOL_BASELINE_REVISION]),
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
      admission: governedAdmission([MCP_PROTOCOL_BASELINE_REVISION]),
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
      admission: governedAdmission([MCP_PROTOCOL_BASELINE_REVISION]),
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
    expect(() =>
      new McpProtocolWiring({
        maximumRequestBytes: MAXIMUM_REQUEST_BYTES,
        mutuallyTestedRevisions: ['TOTALLY-UNREGISTERED-EVIL'],
      } as never),
    ).toThrow(/admission/);

    // A hand-assembled admission naming an unregistered revision is refused by
    // the syntactic-revision law before any guard is built.
    expect(() =>
      new McpProtocolWiring({
        maximumRequestBytes: MAXIMUM_REQUEST_BYTES,
        admission: {
          defaultRevision: MCP_PROTOCOL_BASELINE_REVISION,
          usableRevisions: [MCP_PROTOCOL_BASELINE_REVISION, 'TOTALLY-UNREGISTERED-EVIL'],
          optInRevisions: [],
        },
      } as never),
    ).toThrow(/syntactically valid protocol revision/);

    // CONTROL: a governed baseline admission still admits the baseline.
    const middleware = createMcpProtocolMiddleware({
      maxMessageBytes: MAXIMUM_REQUEST_BYTES,
      admission: governedAdmission([MCP_PROTOCOL_BASELINE_REVISION]),
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
      admission: governedAdmission([MCP_PROTOCOL_BASELINE_REVISION], ['2026-draft-v2']),
    });
    const optedIn = middleware.inspectRequest({
      protocolRevision: '2026-draft-v2',
      contentType: 'application/json',
      method: 'POST',
      messageBytes: 64,
    });
    expect(optedIn.allowed).toBe(true);
  });

  it('fails closed on every malformed governed admission (typed TypeError)', async () => {
    const { createMcpProtocolMiddleware } = await loadProtocolWiringModule();
    const base = { maxMessageBytes: MAXIMUM_REQUEST_BYTES };
    const cases: readonly unknown[] = [
      { ...base, admission: undefined },
      { ...base, admission: null },
      { ...base, admission: 'baseline' },
      // optInRevisions is not an array
      {
        ...base,
        admission: {
          defaultRevision: MCP_PROTOCOL_BASELINE_REVISION,
          usableRevisions: [MCP_PROTOCOL_BASELINE_REVISION],
          optInRevisions: '2026-draft-v2',
        },
      },
      // opt-in entry that is not a syntactically valid protocol revision
      {
        ...base,
        admission: governedAdmission([MCP_PROTOCOL_BASELINE_REVISION], ['TOTALLY-UNREGISTERED-EVIL']),
      },
      // duplicate opt-in entry
      {
        ...base,
        admission: governedAdmission(
          [MCP_PROTOCOL_BASELINE_REVISION],
          ['2026-draft-v2', '2026-draft-v2'],
        ),
      },
      // non-baseline default
      {
        ...base,
        admission: {
          defaultRevision: '2026-draft-v2',
          usableRevisions: ['2026-draft-v2'],
          optInRevisions: [],
        },
      },
      // duplicate usable entry
      {
        ...base,
        admission: governedAdmission([
          MCP_PROTOCOL_BASELINE_REVISION,
          MCP_PROTOCOL_BASELINE_REVISION,
        ]),
      },
      // defaultRevision missing from usableRevisions ∪ optInRevisions
      {
        ...base,
        admission: {
          defaultRevision: MCP_PROTOCOL_BASELINE_REVISION,
          usableRevisions: ['2026-01-01'],
          optInRevisions: [],
        },
      },
      // empty usableRevisions
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
});
