// Untrusted content (T119): seven-source labeling, protected-role refusal,
// structured extraction envelopes, render-safety validators, memory
// isolation keys. (AC-051, AC-052, AC-258)
import { describe, expect, it } from 'bun:test';
import {
  deriveMemoryIsolationKey,
  envelopeContent,
  parseStructuredExtractionFence,
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
      expect(() => refuseProtectedRoleInsertion(role, env())).toThrow(
        role === 'system' ? /system/ : /developer/,
      );
    }
    // User-facing roles may carry labeled data.
    expect(() => refuseProtectedRoleInsertion('user', env())).not.toThrow();
    expect(() => refuseProtectedRoleInsertion('tool', env())).not.toThrow();
  });

  it('wraps content in a fenced DATA-ONLY extraction envelope', () => {
    const wrapped = structuredExtractionEnvelope(env());
    expect(wrapped).toContain('[BEGIN UNTRUSTED:SOCIAL_TEXT');
    expect(wrapped).toContain('UNTRUSTED DATA');
    // Nonce-matched fences (M4/M5): the ONLY sanctioned consumption path is
    // the parser, which demands the END marker carry the BEGIN nonce and
    // round-trips the payload byte-for-byte.
    const parsed = parseStructuredExtractionFence(wrapped);
    expect(parsed.source).toBe('SOCIAL_TEXT');
    expect(parsed.content).toBe('some post text');
    expect(parsed.provenanceRef).toBe('obj://social/123');
  });

  it('parser REFUSES nonce-mismatched, preamble-stripped, or malformed fences (M4)', () => {
    const wrapped = structuredExtractionEnvelope(env());
    // END marker stripped of its nonce no longer pairs with BEGIN.
    const strippedEnd = wrapped.replace(
      /\[END UNTRUSTED:SOCIAL_TEXT nonce="[0-9a-f-]+"\]/,
      '[END UNTRUSTED:SOCIAL_TEXT]',
    );
    expect(strippedEnd).not.toBe(wrapped);
    expect(() => parseStructuredExtractionFence(strippedEnd)).toThrow(/nonce-matched END marker/);
    // Removing the data-only preamble breaks the fence contract.
    const lines = wrapped.split('\n');
    const noPreamble = [lines[0], ...lines.slice(2)].join('\n');
    expect(() => parseStructuredExtractionFence(noPreamble)).toThrow(/preamble/);
    // A legacy nonce-less BEGIN marker is not a well-formed fence opener.
    const legacyBegin = wrapped.replace(lines[0]!, '[BEGIN UNTRUSTED:SOCIAL_TEXT]');
    expect(() => parseStructuredExtractionFence(legacyBegin)).toThrow(/well-formed BEGIN/);
  });

  it('REFUSES a fence whose end marker occurs twice (post-emission tampering)', () => {
    const wrapped = structuredExtractionEnvelope(env());
    // Duplicating the final line (a relay bug or tamper attempt) makes the
    // payload boundary ambiguous — refuse rather than guess.
    const lastLine = wrapped.split('\n').pop()!;
    const duplicated = `${wrapped}\n${lastLine}`;
    expect(() => parseStructuredExtractionFence(duplicated)).toThrow(/occurs more than once/);
  });

  it('wraps identical content with FRESH nonces every emission (anti-forgery)', () => {
    // A predictable fence could be pre-planted inside untrusted content;
    // per-emission random nonces make collision unpredictable in advance.
    expect(structuredExtractionEnvelope(env())).not.toBe(structuredExtractionEnvelope(env()));
  });

  it('round-trips LARGE multi-line payloads byte-for-byte through the parser', () => {
    const big = Array.from({ length: 20_000 }, (_, i) => `line-${i}: <b>${i}</b>`).join('\n');
    const parsed = parseStructuredExtractionFence(
      structuredExtractionEnvelope(env({ content: big })),
    );
    expect(parsed.content).toBe(big);
  });
});

describe('render-safety validation (AC-258)', () => {
  it('tag scanning stays LINEAR-TIME on quote-heavy adversarial markup (M5)', () => {
    // Classic quadratic-backtracking bait: thousands of unterminated
    // attribute openers followed by a long tail. The quote-aware linear
    // scanner finishes immediately; a backtracking regex takes minutes.
    const adversarial = `${'<a href="'.repeat(20_000)}${'x'.repeat(100_000)}"`;
    const started = Date.now();
    const report = validateRenderable(adversarial);
    const elapsedMs = Date.now() - started;
    expect(report.violations.length).toBeGreaterThanOrEqual(0);
    // Generous CI-safe ceiling: quadratic behavior blows far past this.
    expect(elapsedMs).toBeLessThan(5_000);
  });

  it('flags script tags, event handlers, and dangerous URL schemes', () => {
    const report = validateRenderable(
      '<div onclick="steal()">x</div><script>1</script><a href="javascript:alert(1)">y</a>',
    );
    const kinds = new Set(report.violations.map((v) => v.kind));
    expect(kinds.has('SCRIPT_TAG')).toBe(true);
    expect(kinds.has('EVENT_HANDLER_ATTRIBUTE')).toBe(true);
    expect(kinds.has('DANGEROUS_URL_SCHEME')).toBe(true);
    expect(report.safe).toBe(false);
  });

  it('refuses raw HTML unless the policy explicitly allows sanitized HTML', () => {
    expect(validateRenderable('<p>hello</p>').safe).toBe(false);
    expect(
      validateRenderable('<p>hello</p>', { allowRawHtml: true }).violations.filter(
        (v) => v.kind === 'RAW_HTML_REFUSED',
      ),
    ).toHaveLength(0);
  });

  it('enforces the remote-image policy against trusted hosts only', () => {
    const policy = { trustedImageHosts: ['cdn.example.com'] };
    expect(validateRenderable('<img src="https://cdn.example.com/a.png">', policy).safe).toBe(true);
    const flagged = validateRenderable('<img src="https://evil.example.net/p.png">', policy);
    expect(flagged.violations.some((v) => v.kind === 'REMOTE_IMAGE_UNTRUSTED')).toBe(true);
    // No remote images at all by default.
    expect(validateRenderable('<img src="https://cdn.example.com/a.png">').safe).toBe(false);
  });

  it('requires rel=noopener noreferrer on target=_blank links and flags exfil-shaped queries', () => {
    const bad = validateRenderable('<a href="https://x.com/a" target="_blank">link</a>');
    expect(bad.violations.some((v) => v.kind === 'LINK_MISSING_NOOPENER')).toBe(true);

    const good = validateRenderable(
      '<a href="https://x.com/a" target="_blank" rel="noopener noreferrer">link</a>',
    );
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
    const safe = validateRenderable(
      '# Title\n\nJust **markdown** text with [a link](https://example.com).',
    );
    expect(safe.safe).toBe(true);
    expect(safe.warnings).toEqual([]);
  });

  it('catches the historical bypasses: slash-separated handlers, tabbed schemes, multi-candidate srcset', () => {
    // (1) '/' between tag name and attribute is valid to HTML parsers.
    const slashHandler = validateRenderable('<img/onerror=alert(1) src="x">', {
      trustedImageHosts: ['cdn.example.com'],
      allowRawHtml: true,
    });
    expect(slashHandler.violations.some((v) => v.kind === 'EVENT_HANDLER_ATTRIBUTE')).toBe(true);

    // (2) Browsers strip tab/CR/LF inside URL schemes; entities decode too.
    for (const scheme of [
      'java\tscript:alert(1)',
      'java&#09;script:alert(1)',
      '&#106;avascript:alert(1)',
    ]) {
      const report = validateRenderable(`<a href="${scheme}">y</a>`, { allowRawHtml: true });
      expect(
        report.violations.some((v) => v.kind === 'DANGEROUS_URL_SCHEME'),
        scheme,
      ).toBe(true);
    }

    // (3) EVERY srcset candidate is a real fetch target — not just the first.
    const srcset = validateRenderable(
      '<img srcset="https://trusted.example/a.jpg 1x, https://evil.example/b.jpg 2x">',
      { trustedImageHosts: ['trusted.example'] },
    );
    expect(srcset.violations.some((v) => v.kind === 'REMOTE_IMAGE_UNTRUSTED')).toBe(true);
    expect(srcset.violations.some((v) => v.detail.includes('evil.example'))).toBe(true);
  });
});

describe('memory isolation keys (AC-052 cooperation)', () => {
  it('derives distinct keys per actor/session/workspace', () => {
    const base = { actorId: 'a1', sessionId: 's1', workspaceId: 'w1' };
    expect(deriveMemoryIsolationKey(base)).toMatch(/^iso:[0-9a-f]{64}$/);
    expect(deriveMemoryIsolationKey(base)).toBe(deriveMemoryIsolationKey(base));
    expect(deriveMemoryIsolationKey(base)).not.toBe(
      deriveMemoryIsolationKey({ ...base, sessionId: 's2' }),
    );
    expect(deriveMemoryIsolationKey(base)).not.toBe(
      deriveMemoryIsolationKey({ ...base, actorId: 'a2' }),
    );
    expect(deriveMemoryIsolationKey(base)).not.toBe(
      deriveMemoryIsolationKey({ ...base, workspaceId: 'w2' }),
    );
  });
});
