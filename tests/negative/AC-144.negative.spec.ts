/**
 * AC-144 negative / failure-path — MCP Protocol & Client Compatibility Refusals.
 * Traces: FR-MCP-001, FR-MCP-009, PRD §17.1, §17.8, §17.12, §29.4.
 *
 * Asserts:
 * - Draft revisions are REFUSED when the server has not opted into them.
 * - Unsupported, missing, or future protocol versions fail closed with REVISION_UNSUPPORTED.
 * - Non-POST HTTP methods fail closed with METHOD_INVALID.
 * - Non-JSON content types fail closed with CONTENT_TYPE_INVALID.
 * - Messages exceeding the 256 KiB cap fail closed with MESSAGE_OVERSIZE before execution.
 * - Unauthorized resumable cursors fail closed with CURSOR_UNAUTHORIZED.
 * - Session binding claim mismatches fail closed with SESSION_BINDING_INVALID.
 */
import { describe, expect, it } from 'bun:test';
import { MCP_PROTOCOL_BASELINE_REVISION } from '@foresift/shared-schemas';
import { McpProtocolGuard } from '../../packages/security/src/mcp-protocol-guard.ts';
import {
  CREDENTIAL_DISCOVERY_CLIENT,
  CURSOR_UNAUTHORIZED_FOREIGN,
  MCP_LIMITS,
  SESSION_DISCOVERY_STATELESS,
} from '../fixtures/mcp/index.ts';

const STANDARD_GUARD = new McpProtocolGuard({
  maxMessageBytes: MCP_LIMITS.REQUEST_BODY_MAX_BYTES, // 256 KiB
  allowedRevisions: [MCP_PROTOCOL_BASELINE_REVISION],
});

const defaultRequest = {
  protocolRevision: MCP_PROTOCOL_BASELINE_REVISION,
  contentType: 'application/json',
  method: 'POST',
  messageBytes: 1024,
};

describe('AC-144 negative: draft revisions refused unless explicitly opted in (§17.1)', () => {
  it('refuses un-opted-in draft revision under standard baseline configuration', () => {
    const draftRevisions = [
      '2026-01-01-draft',
      '2026-03-01-draft',
      '2025-11-26-preview',
      'draft-v2',
    ];

    for (const draftRev of draftRevisions) {
      const verdict = STANDARD_GUARD.inspect({
        ...defaultRequest,
        protocolRevision: draftRev,
      });

      expect(verdict.decision).toBe('REFUSE');
      expect(verdict).toMatchObject({ reason: 'REVISION_UNSUPPORTED' });
    }
  });

  it('requireAllowed throws typed exception on draft revision refusal', () => {
    expect(() =>
      STANDARD_GUARD.requireAllowed({
        ...defaultRequest,
        protocolRevision: '2026-01-01-draft',
      }),
    ).toThrow(/protocol inspection refused \(REVISION_UNSUPPORTED\)/);
  });
});

describe('AC-144 negative: unsupported protocol versions', () => {
  it('refuses legacy, future, or malformed protocol version strings', () => {
    const unsupportedVersions = [
      '2024-01-01',
      '2024-11-05',
      '2025-01-01',
      '2099-12-31',
      'v1.0.0',
      '',
      undefined,
    ];

    for (const version of unsupportedVersions) {
      const verdict = STANDARD_GUARD.inspect({
        ...defaultRequest,
        protocolRevision: version,
      });

      expect(verdict.decision).toBe('REFUSE');
      expect(verdict).toMatchObject({ reason: 'REVISION_UNSUPPORTED' });
    }
  });
});

describe('AC-144 negative: transport method and content type violations (§17.1)', () => {
  it('refuses non-POST HTTP methods fail-closed', () => {
    const forbiddenMethods = ['GET', 'PUT', 'DELETE', 'PATCH', 'OPTIONS', 'HEAD', 'CONNECT'];
    for (const method of forbiddenMethods) {
      const verdict = STANDARD_GUARD.inspect({
        ...defaultRequest,
        method,
      });

      expect(verdict.decision).toBe('REFUSE');
      expect(verdict).toMatchObject({ reason: 'METHOD_INVALID' });
    }
  });

  it('refuses missing method parameter', () => {
    const verdict = STANDARD_GUARD.inspect({
      ...defaultRequest,
      method: undefined,
    });
    expect(verdict.decision).toBe('REFUSE');
    expect(verdict).toMatchObject({ reason: 'METHOD_INVALID' });
  });

  it('refuses non-JSON content types', () => {
    const invalidContentTypes = [
      'text/plain',
      'text/html',
      'application/xml',
      'application/x-www-form-urlencoded',
      'multipart/form-data',
      'application/octet-stream',
      '',
      undefined,
    ];

    for (const contentType of invalidContentTypes) {
      const verdict = STANDARD_GUARD.inspect({
        ...defaultRequest,
        contentType,
      });

      expect(verdict.decision).toBe('REFUSE');
      expect(verdict).toMatchObject({ reason: 'CONTENT_TYPE_INVALID' });
    }
  });
});

describe('AC-144 negative: message size cap enforcement (§29.4)', () => {
  it('refuses messages exceeding the 256 KiB request body cap before dispatch', () => {
    const verdict = STANDARD_GUARD.inspect({
      ...defaultRequest,
      messageBytes: MCP_LIMITS.REQUEST_BODY_MAX_BYTES + 1, // 262145 bytes
    });

    expect(verdict.decision).toBe('REFUSE');
    expect(verdict).toMatchObject({ reason: 'MESSAGE_OVERSIZE' });
  });

  it('refuses negative or undefined message byte counts', () => {
    expect(
      STANDARD_GUARD.inspect({
        ...defaultRequest,
        messageBytes: -1,
      }),
    ).toMatchObject({ decision: 'REFUSE', reason: 'MESSAGE_OVERSIZE' });

    expect(
      STANDARD_GUARD.inspect({
        ...defaultRequest,
        messageBytes: undefined,
      }),
    ).toMatchObject({ decision: 'REFUSE', reason: 'MESSAGE_OVERSIZE' });
  });
});

describe('AC-144 negative: cursor and session authorization refusals', () => {
  it('refuses unauthorized resumable cursor replay', () => {
    const verdict = STANDARD_GUARD.inspect({
      ...defaultRequest,
      resumableCursor: {
        cursor: CURSOR_UNAUTHORIZED_FOREIGN.cursor,
        authorized: false,
      },
    });

    expect(verdict.decision).toBe('REFUSE');
    expect(verdict).toMatchObject({ reason: 'CURSOR_UNAUTHORIZED' });
  });

  it('refuses request claims presented without established session', () => {
    const verdict = STANDARD_GUARD.inspect({
      ...defaultRequest,
      requestClaims: {
        actor: CREDENTIAL_DISCOVERY_CLIENT.actor,
      },
      session: undefined,
    });

    expect(verdict.decision).toBe('REFUSE');
    expect(verdict).toMatchObject({ reason: 'SESSION_BINDING_INVALID' });
  });

  it('refuses mismatched actor or origin session binding claims', () => {
    const mismatchedClaims = [
      { actor: 'imposter@evil.com' },
      { profileId: 'admin-diagnostic' },
      { origin: 'https://evil.example.com' },
      { protocolRevision: '2024-01-01' },
    ];

    for (const claims of mismatchedClaims) {
      const verdict = STANDARD_GUARD.inspect({
        ...defaultRequest,
        session: {
          actor: SESSION_DISCOVERY_STATELESS.actor,
          profileId: SESSION_DISCOVERY_STATELESS.profileId,
          origin: SESSION_DISCOVERY_STATELESS.origin,
          protocolRevision: SESSION_DISCOVERY_STATELESS.protocolRevision,
        },
        requestClaims: claims,
      });

      expect(verdict.decision).toBe('REFUSE');
      expect(verdict).toMatchObject({ reason: 'SESSION_BINDING_INVALID' });
    }
  });
});
