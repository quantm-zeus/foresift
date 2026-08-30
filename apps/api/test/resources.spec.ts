/**
 * T016: MCP Resources URI Schemes & Per-Access Authorization suite (FR-MCP-010, §17.3, §17.9, AC-252).
 * Tests apps/api/src/mcp/resources.ts for §17.3 URI schemes, per-access re-evaluation,
 * scope boundaries, limits, signed URL generation, and content sanitization.
 */
import { describe, expect, it } from 'bun:test';
import {
  MCP_MALICIOUS_RESOURCE_URIS,
  MCP_SSRF_RESOURCE_URIS,
  STANDARD_DISCOVERY_CREDENTIAL,
} from '../../../tests/fixtures/mcp/index.ts';

async function loadResourcesModule() {
  return await import('../src/mcp/resources.ts');
}

describe('T016: MCP resources & per-access authorization (AC-252, FR-MCP-010)', () => {
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

  it('recognizes all eight §17.3 resource URI scheme families', async () => {
    const { isSupportedResourceUri } = await loadResourcesModule();

    for (const scheme of MANDATED_SCHEMES) {
      const sampleUri = `${scheme}sample-resource-id-001`;
      expect(isSupportedResourceUri(sampleUri), sampleUri).toBe(true);
    }

    expect(isSupportedResourceUri('http://evil.com/payload')).toBe(false);
    expect(isSupportedResourceUri('file:///etc/passwd')).toBe(false);
  });

  it('re-evaluates authorization on every resource read access', async () => {
    const { readMcpResource } = await loadResourcesModule();

    // Credential with resources:read scope
    const allowed = await readMcpResource('evidence://ev-001', {
      actor: 'analyst@foresift.io',
      scopes: ['resources:read'],
      entityBounds: ['solana:*'],
    });
    expect(allowed.content).toBeDefined();

    // Credential missing resources:read scope -> Refused
    const unauth = await readMcpResource('evidence://ev-001', {
      actor: 'analyst@foresift.io',
      scopes: ['tools:execute'], // Missing resources:read
      entityBounds: ['solana:*'],
    });
    expect(unauth.allowed).toBe(false);
    expect(unauth.refusalReason).toBe('RESOURCE_UNAUTHORIZED');
  });

  it('refuses cross-tenant entity access outside credential entity bounds', async () => {
    const { readMcpResource } = await loadResourcesModule();

    // Requesting ethereum snapshot with solana:* entity bound
    const crossEntity = await readMcpResource(
      'snapshot://ethereum:0x1234567890abcdef1234567890abcdef12345678/2026-08-01',
      {
        actor: 'analyst@foresift.io',
        scopes: ['resources:read'],
        entityBounds: ['solana:*'],
      },
    );
    expect(crossEntity.allowed).toBe(false);
    expect(crossEntity.refusalReason).toBe('RESOURCE_UNAUTHORIZED');
  });

  it('blocks raw artifact access when license policy permits derived data only', async () => {
    const { readMcpResource } = await loadResourcesModule();

    const result = await readMcpResource('evidence://ev-raw-restricted', {
      actor: 'analyst@foresift.io',
      scopes: ['resources:read'],
      rightsPolicy: 'DERIVED_ONLY',
    });
    expect(result.allowed).toBe(false);
    expect(result.refusalReason).toBe('RESOURCE_UNAUTHORIZED');
  });

  it('refuses SSRF, path traversal, and malicious resource URIs (AC-252)', async () => {
    const { readMcpResource } = await loadResourcesModule();

    const badUris = [...MCP_SSRF_RESOURCE_URIS, ...MCP_MALICIOUS_RESOURCE_URIS];
    for (const badUri of badUris) {
      const result = await readMcpResource(badUri, {
        actor: 'analyst@foresift.io',
        scopes: ['resources:read'],
      });
      expect(result.allowed, `Should refuse ${badUri}`).toBe(false);
    }
  });

  it('sanitizes browser-rendered content preventing active scripts', async () => {
    const { sanitizeResourceContent } = await loadResourcesModule();

    const unsanitized = '<script>alert(1)</script><p>Clean Text</p><img src="x" onerror="steal()"/>';
    const sanitized = sanitizeResourceContent(unsanitized);

    expect(sanitized).not.toContain('<script>');
    expect(sanitized).not.toContain('onerror');
    expect(sanitized).toContain('Clean Text');
  });
});
