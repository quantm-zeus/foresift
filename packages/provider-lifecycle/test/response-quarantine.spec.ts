// Response quarantine (FR-PROV-008; AC-271): all five malicious-response
// classes are detected, rejected responses persist METADATA ONLY (no payload
// column exists anywhere in the storage path), every rejection is audited,
// model-context exclusion is attested, and transaction-building fields are
// stripped before any persistence.
//
// NOTE: the malicious fixtures below are INERT synthetic objects — marker
// strings and shapes only, no real key material, no executable bytes.
import { describe, expect, it } from 'vitest';
import {
  scanProviderResponse,
  stripTransactionBuildingFields,
  TRANSACTION_BUILDING_FIELD_NAMES,
} from '../src/response-quarantine.ts';
import { makeProvStack, closeProvStack, seedOperation, T0 } from './helpers.ts';

const CLEAN_RESPONSE = {
  price: 123.45,
  symbol: 'SOL',
  confidence: 0.98,
  sources: ['chain-data'],
};

describe('five-class scanner', () => {
  it('passes clean responses', () => {
    expect(scanProviderResponse(CLEAN_RESPONSE)).toEqual({ clean: true, findings: [] });
  });

  it('detects serialized transaction payloads (named builder fields)', () => {
    const outcome = scanProviderResponse({
      data: { swapTransaction: 'AAEAQgEAAAA=', meta: {} },
    });
    expect(outcome.clean).toBe(false);
    expect(outcome.findings.map((f) => f.detectedClass)).toEqual(['TRANSACTION_PAYLOAD']);
    expect(outcome.findings[0]?.fieldPaths).toContain('data.swapTransaction');
  });

  it('detects Solana-shaped transaction structures without named builder keys', () => {
    const outcome = scanProviderResponse({
      result: {
        instructions: [{ programId: 'Prog', data: { programData: 'inert' }, accounts: null }],
        recentBlockhash: '4Nd1mBQtrMJVYVfKf2PJy9NZUZdTAsp7D4xWLs4gDB4T',
        feePayer: 'FeePayer111111111111111111111111111111111',
        signatures: [],
      },
    });
    expect(outcome.clean).toBe(false);
    expect(outcome.findings.map((f) => f.detectedClass)).toEqual(['TRANSACTION_PAYLOAD']);
  });

  it('detects signing requests by verb or typed object', () => {
    expect(scanProviderResponse({ signTxn: true }).findings[0]?.detectedClass).toBe('SIGNING_REQUEST');
    expect(
      scanProviderResponse({ request: { type: 'signing_request' } }).findings[0]?.detectedClass,
    ).toBe('SIGNING_REQUEST');
  });

  it('detects executable instruction encodings (program+accounts+data triple)', () => {
    const outcome = scanProviderResponse({
      ix: { programId: 'Program1111', accounts: ['a', 'b'], instructionData: 'base64==' },
    });
    expect(outcome.clean).toBe(false);
    expect(outcome.findings.map((f) => f.detectedClass)).toEqual(['EXECUTABLE_INSTRUCTION']);
  });

  it('detects private-key field names and marker material anywhere in the tree', () => {
    const outcome = scanProviderResponse({
      nested: { private_key: 'not-a-real-just-shape-marker' },
      deep: [{ value: 'FAKE_PRIVATE_KEY: inert test marker' }],
    });
    expect(outcome.clean).toBe(false);
    expect(outcome.findings.map((f) => f.detectedClass)).toEqual(['PRIVATE_KEY_FIELD']);
  });

  it('detects advertised write capabilities on a read-only surface', () => {
    const outcome = scanProviderResponse({
      endpoint: 'https://inert.example/api',
      allowedMethods: ['POST'],
    });
    expect(outcome.clean).toBe(false);
    expect(outcome.findings.map((f) => f.detectedClass)).toEqual(['WRITE_CAPABILITY']);
  });
});

describe('transaction-building field stripping', () => {
  it('removes builder fields recursively and reports their paths', () => {
    const input = {
      keep: 1,
      nested: { rawTransaction: 'inert', deeper: [{ unsignedTransaction: 'x' }] },
      transactions: [{ id: 1 }],
    };
    const { cleaned, removedPaths } = stripTransactionBuildingFields(input);
    expect(cleaned).toEqual({ keep: 1, nested: { deeper: [{}] } });
    expect([...removedPaths].sort()).toEqual([
      'nested.deeper[0].unsignedTransaction',
      'nested.rawTransaction',
      'transactions',
    ]);
    for (const name of TRANSACTION_BUILDING_FIELD_NAMES) {
      expect(JSON.stringify(cleaned)).not.toContain(name);
    }
  });
});

describe('quarantine routing + metadata-only persistence', () => {
  it('routes clean responses through and rejects malicious ones with typed refusal', async () => {
    const stack = await makeProvStack();
    try {
      const op = await seedOperation(stack);
      await expect(
        stack.quarantine.inspectAndRoute({
          ref: op,
          response: CLEAN_RESPONSE,
          detectedAt: T0,
          actor: 'ingest',
          idempotencyKey: 'clean-1',
        }),
      ).resolves.toEqual({ disposition: 'ACCEPTED' });

      await expect(
        stack.quarantine.requireClean({
          ref: op,
          response: { swapTransaction: 'inert-marker' },
          detectedAt: T0,
          actor: 'ingest',
          idempotencyKey: 'evil-1',
        }),
      ).rejects.toMatchObject({ code: 'PROV_RESPONSE_QUARANTINED' });
    } finally {
      await closeProvStack(stack);
    }
  });

  it('persists classes/paths/hash/size ONLY — no payload column exists at all', async () => {
    const stack = await makeProvStack();
    try {
      const op = await seedOperation(stack);
      const routed = await stack.quarantine.inspectAndRoute({
        ref: op,
        response: { private_key: 'inert', price: 1 },
        detectedAt: T0,
        actor: 'ingest',
        idempotencyKey: 'q-1',
      });
      if (routed.disposition !== 'REJECTED') throw new Error('expected rejection');
      expect(routed.record.detectedClasses).toEqual(['PRIVATE_KEY_FIELD']);
      expect(routed.record.payloadSha256).toMatch(/^sha256:[0-9a-f]{64}$/);
      expect(routed.record.disposition).toBe('REJECTED');

      // Structural proof: the table physically has NO payload-bearing column.
      await stack.quarantine.assertNoPayloadMaterialStored();
      const columns = await stack.engine.query<{ column_name: string }>(
        `SELECT column_name FROM information_schema.columns
         WHERE table_schema = 'prov' AND table_name = 'prov_response_quarantine' ORDER BY ordinal_position`,
      );
      const names = columns.rows.map((r) => r.column_name);
      expect(names).not.toContain('payload');
      expect(names).toContain('payload_sha256');
      expect(names).toContain('model_context_exclusion');

      // The stored row carries metadata only.
      const row = await stack.engine.query<Record<string, unknown>>(
        'SELECT * FROM prov.prov_response_quarantine WHERE quarantine_id = $1',
        [routed.record.quarantineId],
      );
      const serialized = JSON.stringify(row.rows[0]);
      expect(serialized).not.toContain('inert');
      expect(row.rows[0]?.disposition).toBe('REJECTED');
      expect(row.rows[0]?.model_context_exclusion).toBe('ENFORCED');
    } finally {
      await closeProvStack(stack);
    }
  });

  it('audits every rejection as a BLOCKED_OPERATION chain entry and dedupes retries', async () => {
    const stack = await makeProvStack();
    try {
      const op = await seedOperation(stack);
      const first = await stack.quarantine.inspectAndRoute({
        ref: op,
        response: { signMessage: 'inert' },
        detectedAt: T0,
        actor: 'ingest',
        idempotencyKey: 'q-dup',
      });
      const retry = await stack.quarantine.inspectAndRoute({
        ref: op,
        response: { signMessage: 'inert' },
        detectedAt: T0,
        actor: 'ingest',
        idempotencyKey: 'q-dup',
      });
      expect(retry).toEqual(first);
      const quarantineRows = await stack.engine.query(
        'SELECT * FROM prov.prov_response_quarantine',
      );
      expect(quarantineRows.rows).toHaveLength(1);

      const chain = await stack.engine.query<{ action_class: string; payload_canonical: string }>(
        "SELECT action_class, payload_canonical FROM sec.sec_audit_events WHERE action_class = 'BLOCKED_OPERATION'",
      );
      expect(chain.rows).toHaveLength(1);
      expect(chain.rows[0]?.payload_canonical).toContain('PROVIDER_RESPONSE_QUARANTINE');
      expect(chain.rows[0]?.payload_canonical).toContain('"modelContextExclusion":"ENFORCED"');
    } finally {
      await closeProvStack(stack);
    }
  });

  it('attests model-context exclusion for quarantined ids and refuses unknown ones', async () => {
    const stack = await makeProvStack();
    try {
      const op = await seedOperation(stack);
      const routed = await stack.quarantine.inspectAndRoute({
        ref: op,
        response: { writeEnabled: true },
        detectedAt: T0,
        actor: 'ingest',
        idempotencyKey: 'q-excl',
      });
      if (routed.disposition !== 'REJECTED') throw new Error('expected rejection');
      await expect(
        stack.quarantine.modelContextExclusionProof(routed.record.quarantineId),
      ).resolves.toEqual({ quarantineId: routed.record.quarantineId, modelContextExclusion: 'ENFORCED' });
      await expect(stack.quarantine.modelContextExclusionProof('q-never-seen')).rejects.toMatchObject({
        code: 'PROV_QUARANTINE_PAYLOAD_PERSISTENCE_REFUSED',
      });
    } finally {
      await closeProvStack(stack);
    }
  });

  it('multi-class responses record every detected class in one row', async () => {
    const stack = await makeProvStack();
    try {
      const op = await seedOperation(stack);
      const routed = await stack.quarantine.inspectAndRoute({
        ref: op,
        response: {
          swapTransaction: 'inert',
          secretKeyField: 'shape-only',
          allowedMethods: ['DELETE'],
        },
        detectedAt: T0,
        actor: 'ingest',
        idempotencyKey: 'q-multi',
      });
      if (routed.disposition !== 'REJECTED') throw new Error('expected rejection');
      expect([...routed.record.detectedClasses].sort()).toEqual([
        'PRIVATE_KEY_FIELD',
        'TRANSACTION_PAYLOAD',
        'WRITE_CAPABILITY',
      ]);
    } finally {
      await closeProvStack(stack);
    }
  });
});
