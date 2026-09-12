/**
 * AC-143 negative / failure-path.
 * Traces: FR-ALERT-001, FR-ALERT-002, FR-SOC-001, FR-SOC-002, FR-SOC-003,
 * FR-SOC-004, AC-143.
 * AC text (manifest §39.13): "Unauthorized scraping/private endpoint adapters
 * cannot be enabled by configuration or model request."
 *
 * Failure paths that must stay fail-closed:
 * - a malformed or empty capability reference is refused at the request schema;
 * - an authorized-looking prefix cannot launder a prohibited marker;
 * - an unknown extra field cannot smuggle an adapter into the request;
 * - a PERSISTED policy configuration naming a prohibited adapter resolves to a
 *   policy with no adapter surface, and a config that names a capability as its
 *   template is refused (`ALERT_POLICY_UNKNOWN`).
 */
import { describe, expect, it } from 'bun:test';
import { ErrorCode } from '@foresift/domain';
import type { AlertClassPolicyRow } from '@foresift/shared-schemas';
import {
  buildAlertPolicyRegistry,
  classifyAlert,
  loadAlertPolicies,
  prohibitedCapabilityModeFor,
} from '@foresift/alerts';
import type { DatabaseEngine } from '@foresift/persistence';
import * as fx from '../fixtures/alerts/index.ts';
import { expectAlertCodeSync } from '../acceptance/alerts-helpers.ts';
import { closeTestDatabase, expectForesiftError, makeTestDatabase } from '../acceptance/helpers.ts';

const INSERT_POLICY = `
    INSERT INTO alert.alert_policies
        (policy_id, alert_class, version, config_hash, config, ttl_seconds,
         cooldown_seconds, high_conviction_allowed, confirmed_denominator,
         thresholds, superseded_by, created_at)
    VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7, $8, $9, $10::jsonb, NULL, $11)`;

function policyParams(row: AlertClassPolicyRow): readonly unknown[] {
  return [
    row.policyId,
    row.alertClass,
    row.version,
    row.configHash,
    JSON.stringify(row.config),
    row.ttlSeconds,
    row.cooldownSeconds,
    row.highConvictionAllowed,
    row.confirmedDenominatorMember,
    JSON.stringify(row.thresholds),
    row.createdAt,
  ];
}

/** Run `work` against a throwaway migrated database (per-test isolation). */
async function withFreshEngine<T>(work: (engine: DatabaseEngine) => Promise<T>): Promise<T> {
  const fresh = await makeTestDatabase();
  try {
    return await work(fresh.engine);
  } finally {
    await closeTestDatabase(fresh);
  }
}

describe('AC-143 negative: prohibited adapters cannot be enabled by request or configuration', () => {
  it('refuses malformed capability references and every canonical prohibited mode', () => {
    // Defensive detector: empty/non-string input names no prohibited mode...
    expect(prohibitedCapabilityModeFor('')).toBeNull();
    expect(prohibitedCapabilityModeFor(undefined as never)).toBeNull();
    // ...but the request schema still refuses an empty reference outright.
    expect(() =>
      classifyAlert(fx.authorizedCapabilityRequest({ requestedCapabilityRefs: [''] })),
    ).toThrow();

    for (const ref of fx.PROHIBITED_CAPABILITY_REFS) {
      expectAlertCodeSync(
        () => classifyAlert(fx.authorizedCapabilityRequest({ requestedCapabilityRefs: [ref] })),
        ErrorCode.CONTRACT_INVARIANT_VIOLATED,
      );
    }
    for (const ref of fx.OBFUSCATED_PROHIBITED_CAPABILITY_REFS) {
      expectAlertCodeSync(
        () => classifyAlert(fx.authorizedCapabilityRequest({ requestedCapabilityRefs: [ref] })),
        ErrorCode.CONTRACT_INVARIANT_VIOLATED,
      );
    }
  });

  it('does not let an authorized-looking prefix or an unknown field launder the capability', () => {
    for (const ref of [
      'official-scraping-api',
      'provider-authorized-py-private-endpoint',
      'public-channel-reverse-engineering',
      'user-curated-undocumented-api',
    ]) {
      expectAlertCodeSync(
        () => classifyAlert(fx.authorizedCapabilityRequest({ requestedCapabilityRefs: [ref] })),
        ErrorCode.CONTRACT_INVARIANT_VIOLATED,
      );
    }

    // The request schema is strict: an unknown adapter field cannot smuggle a
    // capability past the declared shape.
    expect(() =>
      classifyAlert({
        ...fx.authorizedCapabilityRequest(),
        requestedAdapters: [...fx.PROHIBITED_CAPABILITY_REFS],
      }),
    ).toThrow();
    expect(() =>
      classifyAlert({
        ...fx.authorizedCapabilityRequest(),
        capabilityMode: 'SCRAPING',
      }),
    ).toThrow();
  });

  it('resolves a persisted prohibited-adapter config to an inert policy with no adapter surface', async () => {
    await withFreshEngine(async (engine) => {
      const row = fx.policyRowFixture({ config: { ...fx.PROHIBITED_POLICY_CONFIG } });
      await engine.query(INSERT_POLICY, [...policyParams(row)]);
      const registry = await loadAlertPolicies(engine);
      const policy = registry.policyFor('EARLY_WATCH');
      expect(policy.content.template).toBe('EARLY_WATCH');
      expect(Object.keys(policy).sort()).toEqual([...fx.ALERT_POLICY_KEY_SURFACE].sort());
      const serialized = JSON.stringify(policy).toLowerCase();
      for (const marker of ['scraping', 'private-endpoint', 'private-api', 'undocumented']) {
        expect(serialized).not.toContain(marker);
      }
    });
  }, 120_000);

  it('refuses a persisted config that names a capability as its content template', async () => {
    await withFreshEngine(async (engine) => {
      const row = fx.policyRowFixture({
        config: { contentPolicyVersion: 1, template: 'PRIVATE_ENDPOINT' },
      });
      await engine.query(INSERT_POLICY, [...policyParams(row)]);
      await expectForesiftError(loadAlertPolicies(engine), ErrorCode.ALERT_POLICY_UNKNOWN);
    });

    // The same refusal holds for the in-code registry path.
    expectAlertCodeSync(
      () =>
        buildAlertPolicyRegistry([
          fx.policyRowFixture({ config: { contentPolicyVersion: 1, template: 'SCRAPING' } }),
        ]),
      ErrorCode.ALERT_POLICY_UNKNOWN,
    );
  }, 120_000);
});
