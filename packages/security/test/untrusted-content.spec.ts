// Untrusted content (T119): seven-source labeling, protected-role refusal,
// structured extraction envelopes, render-safety validators, memory
// isolation keys. (AC-051, AC-052, AC-258)
import { describe, expect, it } from 'vitest';
import {
  deriveMemoryIsolationKey,
  envelopeContent,
  refuseProtectedRoleInsertion,
  structuredExtractionEnvelope,
  validateRenderable,
} from '../src/untrusted-content.ts';

const at = (s: string) => s as import('@foresift/domain').UtcTimestamp;

function env(overrides: Record<string, unknown> = {}) {
  return envelopeContent({
    source: 'SOCIAL_TEXT',
    content: 'some post text',
    provenanceRef: 'obj://social/123',
    acquiredAt: at('2026-08-01T00:00:00Z'),
    ...overrides,
  });
}

describe('content labeling and envelopes (AC-258)', () => {
  it('labels all SEVEN untrusted sources', () => {
    for (const source of [
      'TOKEN_METADATA',
      'SOCIAL_TEXT',
      'WEBSITE',
      'PROVIDER_TEXT',
      'NOTEBOOK',
      'MODEL_OUTPUT',
      'IMPORTED_ARTIFACT',
    ] as const) {
      expect(env({ source }).source).toBe(source);
    }
  });

  it('refuses unlabeled acquisition (no provenance)', () => {
    expect(() => env({ provenanceRef: '   ' })).toThrow(/provenance/i);
  });

  it('refuses insertion into system/developer instruction roles', () => {
    for (const role of ['system', 'developer']) {
      expect(() => refuseProtectedRoleInsertion(role, env())).toThrow(role === 'system' ? /system/ : /developer/);
    }
    // User-facing roles may carry labeled data.
    expect(() => refuseProtectedRoleInsertion('user', env())).not.toThrow();
    expect(() => refuseProtectedRoleInsertion('tool', env())).not.toThrow();
  });

  it('wraps content in a fenced DATA-ONLY extraction envelope', () => {
    const wrapped = structuredExtractionEnvelope(env());
    expect(wrapped).toContain('[BEGIN UNTRUSTED:SOCIAL_TEXT');
    expect(wrapped).toContain('[END UNTRUSTED:SOCIAL_TEXT]');
    expect(wrapped).toContain('UNTRUSTED DATA');
  });
});

describe('render-safety validation (AC-258)', () => {
  it('flags script tags, event handlers, and dangerous URL schemes', () => {
    const report = validateRenderable('<div onclick="steal()">x</div><script>1</script><a href="javascript:alert(1)">y</a>');
    const kinds = new Set(report.violations.map((v) => v.kind));
    expect(kinds.has('SCRIPT_TAG')).toBe(true);
    expect(kinds.has('EVENT_HANDLER_ATTRIBUTE')).toBe(true);
    expect(kinds.has('DANGEROUS_URL_SCHEME')).toBe(true);
    expect(report.safe).toBe(false);
  });

  it('refuses raw HTML unless the policy explicitly allows sanitized HTML', () => {
    expect(validateRenderable('<p>hello</p>').safe).toBe(false);
    expect(
      validateRenderable('<p>hello</p>', { allowRawHtml: true }).violations.filter((v) => v.kind === 'RAW_HTML_REFUSED'),
    ).toHaveLength(0);
  });

  it('enforces the remote-image policy against trusted hosts only', () => {
    const policy = { trustedImageHosts: ['cdn.example.com'] };
    expect(
      validateRenderable('<img src="https://cdn.example.com/a.png">', policy).safe,
    ).toBe(true);
    const flagged = validateRenderable('<img src="https://evil.example.net/p.png">', policy);
    expect(flagged.violations.some((v) => v.kind === 'REMOTE_IMAGE_UNTRUSTED')).toBe(true);
    // No remote images at all by default.
    expect(validateRenderable('<img src="https://cdn.example.com/a.png">').safe).toBe(false);
  });

  it('requires rel=noopener noreferrer on target=_blank links and flags exfil-shaped queries', () => {
    const bad = validateRenderable('<a href="https://x.com/a" target="_blank">link</a>');
    expect(bad.violations.some((v) => v.kind === 'LINK_MISSING_NOOPENER')).toBe(true);

    const good = validateRenderable('<a href="https://x.com/a" target="_blank" rel="noopener noreferrer">link</a>');
    expect(good.violations.some((v) => v.kind === 'LINK_MISSING_NOOPENER')).toBe(false);

    const exfil = validateRenderable(
      '<a href="https://telemetry.example.net/?session=abc123&token=xyz" target="_blank" rel="noopener noreferrer">link</a>',
    );
    expect(exfil.violations.some((v) => v.kind === 'LINK_EXFIL_RISK')).toBe(true);

    const hostPolicy = validateRenderable('<a href="https://stranger.org/x">plain</a>', {
      allowedLinkHosts: ['example.com'],
    });
    expect(hostPolicy.violations.some((v) => v.kind === 'LINK_EXFIL_RISK')).toBe(true);
  });

  it('surfaces confusable-address warnings as non-blocking hooks', () => {
    const report = validateRenderable('send funds to xn--80ak6aa92e.tld or рaypal.com now');
    expect(report.warnings.length).toBeGreaterThan(0);
    expect(report.warnings.join('\n')).toMatch(/punycode|homograph|mixed/i);
  });

  it('passes plain markdown untouched-safe content', () => {
    const safe = validateRenderable('# Title\n\nJust **markdown** text with [a link](https://example.com).');
    expect(safe.safe).toBe(true);
    expect(safe.warnings).toEqual([]);
  });
});

describe('memory isolation keys (AC-052 cooperation)', () => {
  it('derives distinct keys per actor/session/workspace', () => {
    const base = { actorId: 'a1', sessionId: 's1', workspaceId: 'w1' };
    expect(deriveMemoryIsolationKey(base)).toMatch(/^iso:[0-9a-f]{64}$/);
    expect(deriveMemoryIsolationKey(base)).toBe(deriveMemoryIsolationKey(base));
    expect(deriveMemoryIsolationKey(base)).not.toBe(deriveMemoryIsolationKey({ ...base, sessionId: 's2' }));
    expect(deriveMemoryIsolationKey(base)).not.toBe(deriveMemoryIsolationKey({ ...base, actorId: 'a2' }));
    expect(deriveMemoryIsolationKey(base)).not.toBe(deriveMemoryIsolationKey({ ...base, workspaceId: 'w2' }));
  });
});
