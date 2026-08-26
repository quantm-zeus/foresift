// AC-271 (negative): the quarantine boundary cannot be talked past —
// requireClean throws on hazardous content, trading-shaped GMGN responses
// are quarantined despite the query-only adapter family, transaction-builder
// fields are stripped before persistence, exclusion proofs refuse unknown
// ids, and multi-class fixtures land as ONE record covering every class.
import { describe, expect, it } from 'vitest';
import {
  closeProvAcceptanceStack,
  makeProvAcceptanceStack,
  readProvFixture,
  seedAcOperation,
  T0,
} from '../helpers/prov.ts';
import {
  ProvErrorCode,
  scanProviderResponse,
  stripTransactionBuildingFields,
} from '../../packages/provider-lifecycle/src/index.ts';

describe('AC-271 negative: quarantine refuses every bypass attempt', () => {
  it('requireClean throws a typed QuarantineError naming the detected classes', async () => {
    const stack = await makeProvAcceptanceStack();
    try {
      const op = await seedAcOperation(stack);
      await expect(
        stack.quarantine.requireClean({
          ref: op,
          response: readProvFixture('quarantine/write-capability.json'),
          detectedAt: T0,
          actor: 'ac',
          idempotencyKey: 'neg271-require-clean',
        }),
      ).rejects.toMatchObject({
        name: 'QuarantineError',
        code: ProvErrorCode.PROV_RESPONSE_QUARANTINED,
      });
    } finally {
      await closeProvAcceptanceStack(stack);
    }
  });

  it('trading-shaped GMGN variants are quarantined even though the adapter is query-only', async () => {
    const stack = await makeProvAcceptanceStack();
    try {
      const op = await seedAcOperation(stack, {
        ref: { providerId: 'gmgn', operationId: 'get-token-price', version: '1.0.0' },
      });
      for (const [index, fixture] of [
        'trading-shaped/gmgn-swap-shaped-response.json',
        'trading-shaped/gmgn-route-quote-response.json',
      ].entries()) {
        const outcome = scanProviderResponse(readProvFixture(fixture));
        expect(outcome.clean, fixture).toBe(false);
        await expect(
          stack.quarantine.requireClean({
            ref: op,
            response: readProvFixture(fixture),
            detectedAt: T0,
            actor: 'ac',
            idempotencyKey: `neg271-gmgn-${String(index)}`,
          }),
        ).rejects.toMatchObject({
          detail: { detectedClasses: 'TRANSACTION_PAYLOAD' },
        });
      }
    } finally {
      await closeProvAcceptanceStack(stack);
    }
  });

  it('transaction-builder fields are stripped recursively with their exact paths', () => {
    const dirty = {
      price: 1,
      nested: { serializedTransaction: 'FAKE_BASE64', keep: 'yes' },
      list: [{ unsignedTransaction: 'FAKE_BASE64_2' }],
    };
    const stripped = stripTransactionBuildingFields(dirty);
    expect(stripped.removedPaths).toEqual([
      'nested.serializedTransaction',
      'list[0].unsignedTransaction',
    ]);
    expect(stripped.cleaned).toEqual({
      price: 1,
      nested: { keep: 'yes' },
      list: [{}],
    });
  });

  it('exclusion proofs refuse quarantine ids that were never recorded', async () => {
    const stack = await makeProvAcceptanceStack();
    try {
      await expect(
        stack.quarantine.modelContextExclusionProof('q-never-recorded'),
      ).rejects.toMatchObject({ code: ProvErrorCode.PROV_QUARANTINE_PAYLOAD_PERSISTENCE_REFUSED });
    } finally {
      await closeProvAcceptanceStack(stack);
    }
  });

  it('a multi-class response lands as ONE quarantine record listing every class', async () => {
    const stack = await makeProvAcceptanceStack();
    try {
      const op = await seedAcOperation(stack);
      const multiClass = readProvFixture('quarantine/signing-request.json') as {
        providerResponse: Record<string, unknown>;
      };
      // Augment into multiple classes at once (still inert fake markers).
      const combined = {
        providerResponse: {
          ...multiClass.providerResponse,
          privateKey: 'FAKE_PRIVATE_KEY_NOT_A_REAL_SECRET_deadbeef',
          endpoints: [{ path: '/v1/publish', httpMethods: ['DELETE'] }],
        },
      };
      const routed = await stack.quarantine.inspectAndRoute({
        ref: op,
        response: combined,
        detectedAt: T0,
        actor: 'ac',
        idempotencyKey: 'neg271-multiclass',
      });
      if (routed.disposition !== 'REJECTED') throw new Error('must be rejected');
      expect([...routed.record.detectedClasses].sort()).toEqual([
        'PRIVATE_KEY_FIELD',
        'SIGNING_REQUEST',
        'WRITE_CAPABILITY',
      ]);
      const rows = await stack.engine.query('SELECT * FROM prov.prov_response_quarantine');
      expect(rows.rows).toHaveLength(1);
    } finally {
      await closeProvAcceptanceStack(stack);
    }
  });
});
