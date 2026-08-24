/**
 * Secrets policy (FR-SEC-007, AC-052; T126) and claims policy + public
 * output boundary (FR-SEC-010/012, AC-276/277; T128). Pure-policy suites:
 * classification guards, redaction, environment separation, lifecycle
 * records; prohibited-claim classes and the §35.12 distribution envelope.
 */
import { describe, expect, it } from 'vitest';
import { strict as assert } from 'node:assert';
import type { PublicRedactionResult } from '@foresift/shared-schemas';
import {
  SECRET_CLASSIFICATIONS,
  SecretLifecycleLedger,
  assertEnvironmentSeparation,
  assertExportAllowed,
  assertUiDisplayAllowed,
  detectMaterial,
  refuseSecretTowardModelContext,
  redactForLogs,
  validateSecretClassConfiguration,
} from '../src/secrets-policy.ts';
import {
  assertClaimsCompliant,
  evaluateClaims,
  validatePublicOutput,
} from '../src/claims-policy.ts';

function redactionsAppliedOf(redaction: PublicRedactionResult): number {
  return redaction.verdict === 'COMPLIANT' ? redaction.redactionsApplied : 0;
}

describe('secrets policy: context / log / export / UI boundaries (AC-052)', () => {
  it('refuses classified material toward model context by declaration', () => {
    expect(() =>
      refuseSecretTowardModelContext({
        content: 'harmless text',
        declaredClassifications: ['PROVIDER_API_KEY'],
      }),
    ).toThrow(/refused toward model context/);
  });

  it('detects secret-SHAPED material even when undeclared', () => {
    expect(detectMaterial('key is sk-proj-abcdefghijklmnopqrstuvwx')).toContain('openai-style-key');
    expect(detectMaterial('token ghp_abcdefghijklmnopqrstuvwxyz123456')).toContain('github-token');
    expect(detectMaterial('AKIAIOSFODNN7EXAMPLE in logs')).toContain('aws-access-key');
    expect(detectMaterial('-----BEGIN RSA PRIVATE KEY-----')).toContain('pem-private-block');
    // Built at runtime so this source file itself never carries hex material
    // (the repo-root scanner must stay clean).
    const hex64 = 'ab'.repeat(32);
    expect(() => refuseSecretTowardModelContext({ content: `credential: ${hex64}` })).toThrow(
      /secret-shaped/,
    );
  });

  it('admits genuinely inert content', () => {
    expect(() =>
      refuseSecretTowardModelContext({ content: 'whale wallet moved 1.2M USDC' }),
    ).not.toThrow();
    expect(detectMaterial('no secrets here')).toEqual([]);
  });

  it('redacts known reference values and material shapes from logs', () => {
    const redacted = redactForLogs(
      'provider key sk-proj-abcdefghijklmnopqrstuvwx used for ref mcp-cred-7',
      [{ value: 'mcp-cred-7', label: 'MCP_CRED_REF' }],
    );
    expect(redacted).toBe(
      'provider key [REDACTED:openai-style-key] used for ref [REDACTED:MCP_CRED_REF]',
    );
    // Redaction is idempotent — re-running changes nothing.
    expect(redactForLogs(redacted)).toBe(redacted);
  });

  it('denies raw credential classes at export channels while keyed references pass', () => {
    expect(() => assertExportAllowed('PROVIDER_API_KEY', 'ALPHA_LAB')).toThrow(
      /prohibited from export channel/,
    );
    expect(() => assertExportAllowed('DATABASE_CREDENTIAL', 'PUBLIC_API')).toThrow(
      /prohibited from export channel/,
    );
    expect(() => assertExportAllowed('ADMIN_SESSION_SECRET', 'OPERATOR_UI')).toThrow(/prohibited/);
    expect(() => assertExportAllowed('MCP_CREDENTIAL_HASH', 'ALPHA_LAB')).not.toThrow();
  });

  it('allows only keyed REFERENCES to render in UI', () => {
    for (const cls of [
      'MCP_CREDENTIAL_HASH',
      'ENCRYPTION_KEY_REFERENCE',
      'PRODUCER_SIGNING_KEY_REFERENCE',
    ] as const) {
      expect(() => assertUiDisplayAllowed(cls)).not.toThrow();
    }
    expect(() => assertUiDisplayAllowed('PROVIDER_API_KEY')).toThrow(/may not be displayed/);
  });

  it('enforces environment separation: production secrets never referenced downward', () => {
    expect(() => assertEnvironmentSeparation('PRODUCTION', 'ALPHA_LAB')).toThrow(
      /production secret referenced/,
    );
    expect(() => assertEnvironmentSeparation('PRODUCTION', 'PRODUCTION')).not.toThrow();
    expect(() => assertEnvironmentSeparation('ALPHA_LAB', 'PRODUCTION')).not.toThrow();
  });
});

describe('secret lifecycle ledger', () => {
  const ledger = new SecretLifecycleLedger();

  it('records rotation events with strictly ordered overlap windows', () => {
    const event = ledger.recordRotation({
      secretRef: 'ref/db-primary',
      classification: 'DATABASE_CREDENTIAL',
      at: '2026-08-24T00:00:00.000Z',
      overlapUntil: '2026-08-25T00:00:00.000Z',
      environment: 'PRODUCTION',
    });
    expect(event.event).toBe('ROTATED');
    expect(event.overlapUntil).toBe('2026-08-25T00:00:00.000Z');

    // Overlap ending AT or BEFORE the rotation instant is refused.
    expect(() =>
      ledger.recordRotation({
        secretRef: 'ref/bad-overlap',
        classification: 'DATABASE_CREDENTIAL',
        at: '2026-08-24T00:00:00.000Z',
        overlapUntil: '2026-08-24T00:00:00.000Z',
        environment: 'PRODUCTION',
      }),
    ).toThrow(/overlap window must extend beyond/);
  });

  it('couples incident invalidation to REVOKED lifecycle records', () => {
    const events = ledger.invalidateForIncident({
      secretRefs: ['ref/a', 'ref/b'],
      classification: 'ENCRYPTION_KEY_REFERENCE',
      incidentId: 'INC-42',
      at: '2026-08-24T01:00:00.000Z',
      environment: 'PRODUCTION',
    });
    expect(events).toHaveLength(2);
    for (const event of events) {
      expect(event.event).toBe('REVOKED');
      expect(event.invalidatedByIncidentId).toBe('INC-42');
    }
    expect(ledger.all()).toHaveLength(3);
  });

  it('validates configured classes against the registry', () => {
    expect(() => validateSecretClassConfiguration(SECRET_CLASSIFICATIONS)).not.toThrow();
    expect(() => validateSecretClassConfiguration(['WALLET_PRIVATE_KEY'])).toThrow(
      /outside the registry/,
    );
  });
});

describe('claims policy: prohibited claim classes (AC-276)', () => {
  it('flags every prohibited class on its channel', () => {
    const cases: readonly [string, string][] = [
      ['guaranteed profit with our signals', 'GUARANTEED_PROFIT'],
      ['this strategy is completely risk-free', 'RISK_FREE'],
      ['our detector always catches rug pulls', 'UNIVERSAL_RECALL'],
      ['93% accurate entry predictions', 'UNCALIBRATED_PROBABILITY'],
      ['the best performing bot on the market', 'UNSUPPORTED_PERFORMANCE'],
    ];
    for (const [text, expected] of cases) {
      const result = evaluateClaims(text, 'MARKETING');
      expect(result.verdict, text).toBe('REFUSED');
      assert(result.verdict === 'REFUSED', text);
      expect(result.claimClasses).toContain(expected);
    }
  });

  it('admits compliant copy and refuses assertion-raising variants', () => {
    const result = evaluateClaims('portfolio snapshots refreshed hourly', 'UI');
    expect(result.verdict).toBe('COMPLIANT');
    expect(() => assertClaimsCompliant("you can't lose with this", 'MARKETING')).toThrow(
      /prohibited claims/,
    );
  });

  it('screens per channel without cross-channel drift', () => {
    for (const channel of ['MARKETING', 'UI', 'API', 'EXPORT'] as const) {
      expect(evaluateClaims('100% recall guaranteed', channel).verdict).toBe('REFUSED');
    }
  });
});

describe('public-output boundary (§35.12, AC-277)', () => {
  const envelope = {
    evidenceRefs: ['evidence://run/abc'],
    timestamps: ['2026-08-24T00:00:00.000Z'],
    executionAssumptions: ['prices as of snapshot time'],
    limitations: ['detection heuristics are probabilistic'],
    disclaimer: 'Not financial advice.',
  };

  it('ships a compliant body after stripping thresholds and entities', () => {
    const { redaction, redactedBody } = validatePublicOutput({
      ...envelope,
      body: 'Detector fired at threshold: 0.82 for whale 7xKQ…; portfolio snapshot follows.',
      sensitiveEntityValues: ['7xKQ…'],
    });
    expect(redaction.verdict).toBe('COMPLIANT');
    expect(redactionsAppliedOf(redaction)).toBeGreaterThan(0);
    expect(redactedBody).toContain('[REDACTED_THRESHOLD]');
    expect(redactedBody).toContain('[REDACTED_ENTITY]');
    expect(redactedBody).not.toContain('threshold: 0.82');
    expect(redactedBody).not.toContain('7xKQ…');
  });

  it('redacts EVERY threshold occurrence — partial redaction would still ship tuning values', () => {
    const body =
      'detector_score is 0.9 here and detector_threshold equals 0.75 too plus detector_score 0.9 again';
    const { redaction, redactedBody } = validatePublicOutput({ ...envelope, body });
    expect(redaction.verdict).toBe('COMPLIANT');
    // No numeric tuning value survives anywhere in the published body.
    for (const leaked of ['0.9', '0.75', 'detector_score is', 'detector_threshold equals']) {
      expect(redactedBody).not.toContain(leaked);
    }
    expect((redactedBody.match(/\[REDACTED_THRESHOLD\]/g) ?? []).length).toBeGreaterThanOrEqual(2);
    expect(redactionsAppliedOf(redaction)).toBeGreaterThanOrEqual(2);
  });

  it('refuses envelopes missing any required duty', () => {
    for (const missing of ['evidenceRefs', 'limitations', 'disclaimer'] as const) {
      const candidate = { ...envelope, body: 'clean body', [missing]: undefined };
      const { redaction, redactedBody } = validatePublicOutput(candidate as never);
      expect(redaction.verdict, missing).toBe('REFUSED');
      assert(redaction.verdict === 'REFUSED');
      expect(redaction.reason).toBe('REQUIRED_FIELD_MISSING');
      expect(redactedBody).toBe('');
    }
  });

  it('refuses publication when the body carries prohibited claims', () => {
    const { redaction } = validatePublicOutput({
      ...envelope,
      body: 'our engine delivers guaranteed profit',
    });
    expect(redaction.verdict).toBe('REFUSED');
    assert(redaction.verdict === 'REFUSED');
    expect(redaction.reason).toBe('SENSITIVE_DETAIL_PRESENT');
  });
});
