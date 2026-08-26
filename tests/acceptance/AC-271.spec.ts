// AC-271 (acceptance): every provider response passes the five-class
// quarantine scanner before any use. Clean fixture responses are ACCEPTED;
// each malicious-class fixture is detected, persisted METADATA-ONLY (no
// payload column exists anywhere in the storage path), audited through the
// security chain, and hard-excluded from model-context envelopes.
import { describe, expect, it } from 'vitest';
import {
  closeProvAcceptanceStack,
  makeProvAcceptanceStack,
  readProvFixture,
  seedAcOperation,
  T0,
} from '../helpers/prov.ts';
import { scanProviderResponse } from '../../packages/provider-lifecycle/src/index.ts';

const CLASS_FIXTURES: ReadonlyArray<[string, string]> = [
  ['TRANSACTION_PAYLOAD', 'quarantine/transaction-payload.json'],
  ['SIGNING_REQUEST', 'quarantine/signing-request.json'],
  ['EXECUTABLE_INSTRUCTION', 'quarantine/executable-instruction.json'],
  ['PRIVATE_KEY_FIELD', 'quarantine/private-key-field.json'],
  ['WRITE_CAPABILITY', 'quarantine/write-capability.json'],
];

const CLEAN_FIXTURES = [
  'clean/gmgn-token-price.json',
  'clean/gmgn-trending-pools.json',
  'clean/helius-raw-transaction.json',
  'clean/helius-address-balances.json',
  'enhanced-parser/helius-enhanced-summary.json',
] as const;

describe('AC-271: response quarantine across the sanitized corpus', () => {
  it('every clean fixture scans clean and routes to ACCEPTED end-to-end', async () => {
    const stack = await makeProvAcceptanceStack();
    try {
      const op = await seedAcOperation(stack);
      for (const [index, fixture] of CLEAN_FIXTURES.entries()) {
        const outcome = scanProviderResponse(readProvFixture(fixture));
        expect(outcome.clean, `${fixture} must be clean`).toBe(true);
        const routed = await stack.quarantine.inspectAndRoute({
          ref: op,
          response: readProvFixture(fixture),
          detectedAt: T0,
          actor: 'ac',
          idempotencyKey: `ac271-clean-${String(index)}`,
        });
        expect(routed.disposition).toBe('ACCEPTED');
      }
    } finally {
      await closeProvAcceptanceStack(stack);
    }
  });

  it('each malicious-class fixture is detected with its exact class and field paths', async () => {
    const stack = await makeProvAcceptanceStack();
    try {
      const op = await seedAcOperation(stack);
      let quarantineCount = 0;
      for (const [expectedClass, fixture] of CLASS_FIXTURES) {
        const routed = await stack.quarantine.inspectAndRoute({
          ref: op,
          response: readProvFixture(fixture),
          detectedAt: T0,
          actor: 'ac',
          idempotencyKey: `ac271-reject-${expectedClass}`,
        });
        if (routed.disposition !== 'REJECTED') {
          throw new Error(`${fixture} must be rejected as ${expectedClass}`);
        }
        expect(routed.record.detectedClasses).toContain(expectedClass);
        expect(routed.record.fieldPaths.length).toBeGreaterThan(0);
        expect(routed.record.payloadSha256).toMatch(/^sha256:[0-9a-f]{64}$/);
        quarantineCount += 1;
      }
      expect(quarantineCount).toBe(CLASS_FIXTURES.length);
    } finally {
      await closeProvAcceptanceStack(stack);
    }
  });

  it('rejected responses persist METADATA-ONLY: no payload-bearing column exists at all', async () => {
    const stack = await makeProvAcceptanceStack();
    try {
      const op = await seedAcOperation(stack);
      await stack.quarantine.inspectAndRoute({
        ref: op,
        response: readProvFixture('quarantine/private-key-field.json'),
        detectedAt: T0,
        actor: 'ac',
        idempotencyKey: 'ac271-meta-only',
      });
      // Structural proof over information_schema: no column that could carry
      // payload material exists on the quarantine table.
      await expect(stack.quarantine.assertNoPayloadMaterialStored()).resolves.toBeUndefined();
      const columns = await stack.engine.query<{ column_name: string }>(
        `SELECT column_name FROM information_schema.columns
         WHERE table_schema='prov' AND table_name='prov_response_quarantine' ORDER BY column_name`,
      );
      const names = columns.rows.map((row) => row.column_name);
      expect(names).not.toContain('payload');
      expect(names.join(',')).not.toMatch(/^(payload|response|body|raw|material|bytes)(_|$)/m);
      // The stored row carries only class metadata + hash + size.
      const rows = await stack.engine.query<Record<string, unknown>>(
        'SELECT * FROM prov.prov_response_quarantine',
      );
      expect(rows.rows).toHaveLength(1);
      expect(JSON.stringify(rows.rows[0])).not.toContain('FAKE_PRIVATE_KEY');
    } finally {
      await closeProvAcceptanceStack(stack);
    }
  });

  it('rejections bridge onto the security audit chain; retries dedupe without double rows', async () => {
    const stack = await makeProvAcceptanceStack();
    try {
      const op = await seedAcOperation(stack);
      const input = {
        ref: op,
        response: readProvFixture('quarantine/transaction-payload.json'),
        detectedAt: T0,
        actor: 'ac',
        idempotencyKey: 'ac271-audit-once',
      };
      const first = await stack.quarantine.inspectAndRoute(input);
      const second = await stack.quarantine.inspectAndRoute(input);
      if (first.disposition !== 'REJECTED' || second.disposition !== 'REJECTED') {
        throw new Error('fixture must be rejected');
      }
      expect(second.record.quarantineId).toBe(first.record.quarantineId);
      const rows = await stack.engine.query(
        'SELECT * FROM prov.prov_response_quarantine',
      );
      expect(rows.rows).toHaveLength(1);
      // One BLOCKED_OPERATION audit entry backs the rejection.
      const audit = await stack.engine.query<{ action_class: string }>(
        `SELECT action_class FROM sec.sec_audit_events WHERE action_class = 'BLOCKED_OPERATION'`,
      );
      expect(audit.rows.length).toBeGreaterThanOrEqual(1);
      // Exclusion proof is attested for the recorded id.
      await expect(
        stack.quarantine.modelContextExclusionProof(first.record.quarantineId),
      ).resolves.toMatchObject({ modelContextExclusion: 'ENFORCED' });
    } finally {
      await closeProvAcceptanceStack(stack);
    }
  });
});
