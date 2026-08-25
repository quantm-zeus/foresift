// AC-258 (negative): injection-containment mutations ATTEMPTED and REFUSED.
// Payloads try to become instructions (role insertion), render as active
// content (raw HTML), or hide their destinations (disguised links) — every
// attempt is refused deterministically.
import { describe, expect, it } from 'vitest';
import {
  envelopeContent,
  refuseProtectedRoleInsertion,
  validateRenderable,
} from '../../packages/security/src/untrusted-content.ts';
import {
  LINK_DISGUISE_VECTORS,
  PROMPT_INJECTION_PAYLOADS,
  RAW_HTML_VECTORS,
} from '../fixtures/sec/injection/injection-corpus.ts';

const at = (s: string) => s as import('@foresift/domain').UtcTimestamp;

/** Fixture arrays are static; this guard satisfies noUncheckedIndexedAccess. */
function firstOf(items: readonly string[]): string {
  const first = items[0];
  if (first === undefined) throw new Error('fixture corpus must not be empty');
  return first;
}

function envelopeFor(content: string, source: 'SOCIAL_TEXT' | 'MODEL_OUTPUT' | 'WEBSITE') {
  return envelopeContent({
    source,
    content,
    provenanceRef: `obj://injection/${source.toLowerCase()}`,
    acquiredAt: at('2026-08-24T00:00:00Z'),
  });
}

describe('AC-258 negative: containment mutations are attempted and refused', () => {
  it('no injection payload can enter system or developer instruction roles', () => {
    for (const role of ['system', 'developer'] as const) {
      for (const payload of PROMPT_INJECTION_PAYLOADS) {
        expect(
          () => refuseProtectedRoleInsertion(role, envelopeFor(payload, 'MODEL_OUTPUT')),
          `${role}: ${payload}`,
        ).toThrow();
      }
    }
    // The only roles ever available to untrusted content are data roles.
    expect(() =>
      refuseProtectedRoleInsertion(
        'user',
        envelopeFor(firstOf(PROMPT_INJECTION_PAYLOADS), 'SOCIAL_TEXT'),
      ),
    ).not.toThrow();
    expect(() =>
      refuseProtectedRoleInsertion(
        'tool',
        envelopeFor(firstOf(PROMPT_INJECTION_PAYLOADS), 'SOCIAL_TEXT'),
      ),
    ).not.toThrow();
  });

  it('every raw-HTML vector is refused with a structural violation kind', () => {
    for (const vector of RAW_HTML_VECTORS) {
      const report = validateRenderable(vector);
      expect(report.safe, vector).toBe(false);
    }
  });

  it('script tags and event handlers get their specific violation kinds', () => {
    const report = validateRenderable(firstOf(RAW_HTML_VECTORS));
    expect(report.violations.map((v) => v.kind)).toContain('SCRIPT_TAG');
    const handlers = validateRenderable('<img src=x onerror=alert(1)>');
    expect(handlers.violations.map((v) => v.kind)).toContain('EVENT_HANDLER_ATTRIBUTE');
    const schemes = validateRenderable('<a href="javascript:alert(1)">stub</a>');
    expect(schemes.violations.map((v) => v.kind)).toContain('DANGEROUS_URL_SCHEME');
  });

  it('disguised links refuse rather than rendering with hidden destinations', () => {
    for (const vector of LINK_DISGUISE_VECTORS) {
      const url = /\[[^\]]*\]\(([^)]+)\)/.exec(vector)?.[1] ?? '';
      expect(url, vector).not.toBe('');
      const report = validateRenderable(`<a href="${url}">label</a>`, {
        allowedLinkHosts: ['cdn.example.com'],
      });
      expect(report.safe, vector).toBe(false);
      expect(report.violations.map((v) => v.kind)).toContain('LINK_EXFIL_RISK');
    }
  });

  it('rendered output cannot smuggle confusable addresses silently', () => {
    const report = validateRenderable('pay at рaypal.com or xn--80ak6aa92e.tld now');
    const flagged =
      !report.safe ||
      report.warnings.length > 0 ||
      report.violations.some((v) => v.kind === 'CONFUSABLE_ADDRESS');
    expect(flagged).toBe(true);
  });
});
