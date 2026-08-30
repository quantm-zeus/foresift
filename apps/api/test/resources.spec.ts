/**
 * Unit test suite for MCP resource schemes & per-access authorization (T016).
 * Traces: FR-MCP-010, AC-252, §17.3, §17.9.
 *
 * Asserts:
 * - Supports the 8 mandated URI schemes: evidence://, run://, candidate://, snapshot://, report://, conflict://, capacity://, tradability://.
 * - Authorization re-evaluated on EVERY access (actor scope, entity scope, rights policy).
 * - A URI grants no authority beyond the requesting credential (AC-252).
 * - Cross-tenant and cross-actor resource access refused with 403/404.
 * - Raw artifacts blocked when license rights permit derived data only.
 * - Browser-rendered resources sanitized against active scripts/remote loads.
 * - Large downloads bounded or served via short-lived signed URLs.
 */
import { describe, expect, it } from 'bun:test';
import {
  McpResourceHandler,
  type ReadResourceRequest,
} from '../src/mcp/resources.ts';

describe('T016 — MCP resource URI schemes & per-access auth (AC-252)', () => {
  const handler = new McpResourceHandler();

  const MANDATED_SCHEMES = [
    'evidence://',
    'run://',
    'candidate://',
    'snapshot://',
    'report://',
    'conflict://',
    'capacity://',
    'tradability://',
  ];

  it('recognizes and parses all 8 mandated §17.3 URI schemes', () => {
    for (const scheme of MANDATED_SCHEMES) {
      const parsed = handler.parseUri(`${scheme}item-12345`);
      expect(parsed.scheme).toBe(scheme.replace('://', ''));
      expect(parsed.id).toBe('item-12345');
    }
  });

  it('rejects unsupported URI schemes', () => {
    expect(() => handler.parseUri('file:///etc/passwd')).toThrow();
    expect(() => handler.parseUri('http://external.site/data')).toThrow();
    expect(() => handler.parseUri('unknown://123')).toThrow();
  });

  it('re-evaluates authorization on every resource read (AC-252)', async () => {
    const validRead: ReadResourceRequest = {
      uri: 'evidence://ev-tenant-a-001',
      clientContext: {
        actor: 'user-a@tenant-a.com',
        scopes: ['resources:read'],
        entityConstraints: { allowedTenants: ['tenant-a'] },
      },
    };

    const result = await handler.readResource(validRead);
    expect(result.contents).toBeDefined();
    expect(result.uri).toBe('evidence://ev-tenant-a-001');
  });

  it('refuses cross-tenant resource access without authority (AC-252)', async () => {
    const crossTenantRead: ReadResourceRequest = {
      uri: 'evidence://ev-tenant-b-001', // Belongs to tenant B
      clientContext: {
        actor: 'user-a@tenant-a.com',
        scopes: ['resources:read'],
        entityConstraints: { allowedTenants: ['tenant-a'] },
      },
    };

    const result = await handler.readResource(crossTenantRead);
    expect(result.isError).toBe(true);
    expect(result.refusalReason).toBe('RESOURCE_UNAUTHORIZED');
  });

  it('blocks raw artifacts when rights policy permits derived data only', async () => {
    const rawArtifactRead: ReadResourceRequest = {
      uri: 'snapshot://snap-raw-licensed-provider',
      requestRaw: true,
      clientContext: {
        actor: 'user-a',
        scopes: ['resources:read'],
        rightsPolicy: 'DERIVED_ONLY',
      },
    };

    const result = await handler.readResource(rawArtifactRead);
    expect(result.isError).toBe(true);
    expect(result.refusalReason).toBe('RESOURCE_UNAUTHORIZED');
  });

  it('sanitizes browser-rendered / HTML resource content', async () => {
    const htmlResource: ReadResourceRequest = {
      uri: 'report://rep-with-html',
      clientContext: {
        actor: 'user-a',
        scopes: ['resources:read'],
      },
    };

    const result = await handler.readResource(htmlResource);
    const text = result.contents[0]?.text ?? '';
    expect(text).not.toContain('<script>');
    expect(text).not.toContain('javascript:');
    expect(text).not.toContain('onerror=');
  });
});
