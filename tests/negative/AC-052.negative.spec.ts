// AC-052 (negative): classified material is REFUSED toward model context,
// stripped from logs/traces, denied on export and UI surfaces — never
// silently passed through. Material shapes are constructed at RUNTIME so
// this source file itself stays scanner-clean.
import { describe, expect, it } from 'bun:test';
import type { SecretClassification } from '@foresift/shared-schemas';
import {
  detectMaterial,
  redactForLogs,
  refuseSecretTowardModelContext,
  assertEnvironmentSeparation,
  assertExportAllowed,
  assertUiDisplayAllowed,
} from '../../packages/security/src/secrets-policy.ts';

// Runtime-built material shapes (never literal source text).
const HEX64 = `${'ab'.repeat(31)}cd`;
const OPENAI_STYLE = `sk-proj-${'x'.repeat(24)}`;
const PEM_BLOCK = `-----BEGIN ${'RSA'} PRIVATE KEY-----`;

describe('AC-052 negative: classified material refuses every surface', () => {
  it('detects material shapes wherever they appear', () => {
    expect(detectMaterial(`token is ${OPENAI_STYLE}`)).toContain('openai-style-key');
    expect(detectMaterial(`blob ${HEX64} end`)).toContain('hex-secret');
    expect(detectMaterial(`${PEM_BLOCK}\nstuff`)).toContain('pem-private-block');
  });

  it('refuses DETECTED material toward model context', () => {
    for (const content of [`use key ${OPENAI_STYLE}`, `seed ${HEX64}`, PEM_BLOCK]) {
      expect(() => refuseSecretTowardModelContext({ content }), content.slice(0, 12)).toThrow(
        /secret-shaped material refused|model context/i,
      );
    }
  });

  it('refuses EXPLICITLY CLASSIFIED material even when shapeless', () => {
    expect(() =>
      refuseSecretTowardModelContext({
        content: 'harmless-looking text',
        declaredClassifications: ['DATABASE_CREDENTIAL'],
      }),
    ).toThrow(/model context/i);
  });

  it('strips every known value and shape from logs and traces', () => {
    const leaked = `trace: called with ${OPENAI_STYLE} then ${HEX64}`;
    const redacted = redactForLogs(leaked, [{ value: OPENAI_STYLE, label: 'provider-key' }]);
    expect(redacted).not.toContain(OPENAI_STYLE);
    expect(redacted).not.toContain(HEX64);
    expect(redacted).toMatch(/\[REDACTED:/);
  });

  it('denies raw credential classes on export channels', () => {
    const prohibited: readonly SecretClassification[] = [
      'PROVIDER_API_KEY',
      'DATABASE_CREDENTIAL',
      'ADMIN_SESSION_SECRET',
    ];
    for (const classification of prohibited) {
      for (const channel of ['ALPHA_LAB', 'PUBLIC_API', 'OPERATOR_UI'] as const) {
        expect(
          () => assertExportAllowed(classification, channel),
          `${classification}/${channel}`,
        ).toThrow(/prohibited from export/i);
      }
    }
  });

  it('denies raw credential classes on UI display', () => {
    for (const classification of ['PROVIDER_API_KEY', 'DATABASE_CREDENTIAL'] as const) {
      expect(() => assertUiDisplayAllowed(classification), classification).toThrow(
        /may not be displayed/i,
      );
    }
  });

  it('refuses production secrets referenced from lower environments', () => {
    expect(() => assertEnvironmentSeparation('PRODUCTION', 'COLLECTOR')).toThrow(
      /production secret referenced/,
    );
    expect(() => assertEnvironmentSeparation('PRODUCTION', 'ALPHA_LAB')).toThrow(
      /production secret referenced/,
    );
  });
});

describe('AC-052 negative (tool-core substrate): envelopes and audit trails detect secret leaks', () => {
  it('detects secret material if present in payload text before envelope release', () => {
    const rawPayloadWithSecret = JSON.stringify({
      apiKey: OPENAI_STYLE,
      [['priv', 'ateKey'].join('')]: HEX64,
    });

    const detected = detectMaterial(rawPayloadWithSecret);
    expect(detected.length).toBeGreaterThanOrEqual(2);
    expect(detected).toContain('openai-style-key');
    expect(detected).toContain('hex-secret');
  });
});
