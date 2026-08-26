// Lifecycle machine (FR-PROV-001, §12.11; plan material decision 4): guarded
// edges, mandatory reason classes, idempotent fenced appends over the
// immutable ledger, audit-chain bridging, and expiry exits that never mutate
// historical evidence.
import { describe, expect, it } from 'vitest';
import type { UtcTimestamp } from '@foresift/domain';
import { makeProvStack, closeProvStack, seedOperation, T0 } from './helpers.ts';

const LATER = '2026-08-01T01:00:00Z' as UtcTimestamp;

describe('lifecycle machine', () => {
  it('takes a legal edge: appends one ledger event and projects current_state', async () => {
    const stack = await makeProvStack();
    try {
      const op = await seedOperation(stack);
      const { seq } = await stack.machine.transition({
        ref: op,
        to: 'VERIFIED',
        reasonClass: 'REGISTRATION_VERIFIED',
        actor: 'test',
        occurredAt: T0,
        effectiveAt: T0,
        idempotencyKey: 'k1',
      });
      expect(seq).toBeGreaterThan(0);
      expect(await stack.machine.currentState(op)).toBe('VERIFIED');
      const history = await stack.machine.history(op);
      expect(history).toHaveLength(1);
      expect(history[0]?.fromState).toBe('DISCOVERED');
      expect(history[0]?.toState).toBe('VERIFIED');
    } finally {
      await closeProvStack(stack);
    }
  });

  it('refuses illegal edges, unknown states, and empty/foreign reason classes', async () => {
    const stack = await makeProvStack();
    try {
      const op = await seedOperation(stack);
      // DISCOVERED → DEGRADED is not an edge.
      await expect(
        stack.machine.transition({
          ref: op,
          to: 'DEGRADED',
          reasonClass: 'HEALTH_EXCURSION',
          actor: 'test',
          occurredAt: T0,
          effectiveAt: T0,
          idempotencyKey: 'k-bad-edge',
        }),
      ).rejects.toMatchObject({ code: 'PROV_LIFECYCLE_TRANSITION_ILLEGAL' });
      await expect(
        stack.machine.transition({
          ref: op,
          to: 'ACTIVE',
          reasonClass: 'WHIM' as never,
          actor: 'test',
          occurredAt: T0,
          effectiveAt: T0,
          idempotencyKey: 'k-bad-reason',
        }),
      ).rejects.toMatchObject({ code: 'PROV_LIFECYCLE_REASON_REQUIRED' });
      await expect(
        stack.machine.transition({
          ref: op,
          to: 'ACTIVE',
          reasonClass: '   ' as never,
          actor: 'test',
          occurredAt: T0,
          effectiveAt: T0,
          idempotencyKey: 'k-blank',
        }),
      ).rejects.toMatchObject({ code: 'PROV_LIFECYCLE_REASON_REQUIRED' });
    } finally {
      await closeProvStack(stack);
    }
  });

  it('retries with the same key + tuple return the SAME seq without double-append', async () => {
    const stack = await makeProvStack();
    try {
      const op = await seedOperation(stack);
      const first = await stack.machine.transition({
        ref: op,
        to: 'VERIFIED',
        reasonClass: 'REGISTRATION_VERIFIED',
        actor: 'test',
        occurredAt: T0,
        effectiveAt: T0,
        idempotencyKey: 'retry-same',
      });
      const second = await stack.machine.transition({
        ref: op,
        to: 'VERIFIED',
        reasonClass: 'REGISTRATION_VERIFIED',
        actor: 'different-actor-ok',
        occurredAt: LATER as never,
        effectiveAt: T0,
        idempotencyKey: 'retry-same',
      });
      expect(second.seq).toBe(first.seq);
      expect((await stack.engine.query('SELECT * FROM prov.prov_lifecycle_events')).rows).toHaveLength(1);
    } finally {
      await closeProvStack(stack);
    }
  });

  it('a retry reusing a key for a DIFFERENT transition is a loud conflict', async () => {
    const stack = await makeProvStack();
    try {
      const op = await seedOperation(stack);
      await stack.machine.transition({
        ref: op,
        to: 'VERIFIED',
        reasonClass: 'REGISTRATION_VERIFIED',
        actor: 'test',
        occurredAt: T0,
        effectiveAt: T0,
        idempotencyKey: 'conflict-key',
      });
      await expect(
        stack.machine.transition({
          ref: op,
          to: 'BLOCKED',
          reasonClass: 'OPERATOR_BLOCK',
          actor: 'test',
          occurredAt: T0,
          effectiveAt: T0,
          idempotencyKey: 'conflict-key',
        }),
      ).rejects.toMatchObject({ code: 'PROV_LIFECYCLE_IDEMPOTENCY_CONFLICT' });
    } finally {
      await closeProvStack(stack);
    }
  });

  it('the SQL layer refuses ledger mutation even if code tried (PROV_IMMUTABLE)', async () => {
    const stack = await makeProvStack();
    try {
      const op = await seedOperation(stack);
      await stack.machine.transition({
        ref: op,
        to: 'VERIFIED',
        reasonClass: 'REGISTRATION_VERIFIED',
        actor: 'test',
        occurredAt: T0,
        effectiveAt: T0,
        idempotencyKey: 'immutable-check',
      });
      await expect(
        stack.engine.query("UPDATE prov.prov_lifecycle_events SET reason_class = 'TAMPERED'"),
      ).rejects.toThrowError(/PROV_IMMUTABLE/);
      await expect(
        stack.engine.query('DELETE FROM prov.prov_lifecycle_events'),
      ).rejects.toThrowError(/PROV_IMMUTABLE/);
      await expect(
        stack.engine.query('TRUNCATE prov.prov_lifecycle_events'),
      ).rejects.toThrowError(/PROV_IMMUTABLE/);
    } finally {
      await closeProvStack(stack);
    }
  });

  it('bridges critical transitions onto the security chain with the right action class', async () => {
    const stack = await makeProvStack();
    try {
      const op = await seedOperation(stack);
      await stack.machine.transition({
        ref: op,
        to: 'VERIFIED',
        reasonClass: 'REGISTRATION_VERIFIED',
        actor: 'test',
        occurredAt: T0,
        effectiveAt: T0,
        idempotencyKey: 'audit-1',
      });
      // VERIFIED → BLOCKED must land as BLOCKED_OPERATION on the chain.
      await stack.machine.transition({
        ref: op,
        to: 'BLOCKED',
        reasonClass: 'OPERATOR_BLOCK',
        actor: 'operator',
        occurredAt: LATER,
        effectiveAt: LATER,
        idempotencyKey: 'audit-2',
      });
      const events = await stack.engine.query<{ audit_entry_seq: string | null }>(
        'SELECT audit_entry_seq FROM prov.prov_lifecycle_events ORDER BY seq',
      );
      // The BLOCKED event carries a live chain back-reference.
      const blockedAuditSeq = events.rows[1]?.audit_entry_seq;
      expect(blockedAuditSeq).not.toBeNull();
      const chainRows = await stack.engine.query<{
        seq: string | number;
        action_class: string;
        subject: string;
        payload_canonical: string;
      }>('SELECT seq, action_class, subject, payload_canonical FROM sec.sec_audit_events ORDER BY seq');
      expect(chainRows.rows.length).toBe(2);
      expect(Number(blockedAuditSeq)).toBe(Number(chainRows.rows[1]?.seq));
      expect(chainRows.rows[0]?.action_class).toBe('PROVIDER_COLLECTOR_ACCESS');
      expect(chainRows.rows[1]?.action_class).toBe('BLOCKED_OPERATION');
      expect(chainRows.rows[1]?.subject).toContain('provider-operation:');
      expect(chainRows.rows[1]?.payload_canonical).toContain('PROVIDER_LIFECYCLE_TRANSITION');
    } finally {
      await closeProvStack(stack);
    }
  });

  it('expiry exits append events and project state WITHOUT touching historical evidence', async () => {
    const stack = await makeProvStack();
    try {
      const op = await seedOperation(stack);
      await stack.machine.transition({
        ref: op,
        to: 'VERIFIED',
        reasonClass: 'REGISTRATION_VERIFIED',
        actor: 'test',
        occurredAt: T0,
        effectiveAt: T0,
        idempotencyKey: 'e1',
      });
      await stack.machine.transition({
        ref: op,
        to: 'ACTIVE',
        reasonClass: 'OPERATION_ACTIVATED',
        actor: 'test',
        occurredAt: T0,
        effectiveAt: T0,
        idempotencyKey: 'e2',
      });
      const before = await stack.machine.history(op);
      await stack.machine.transition({
        ref: op,
        to: 'DEGRADED',
        reasonClass: 'VERIFICATION_EXPIRED_PRICING_PLAN',
        actor: 'ttl-sweep',
        occurredAt: LATER,
        effectiveAt: LATER,
        evidenceRefs: ['sweep:sweep-run-1'],
        idempotencyKey: 'sweep-run-1:prov-test:get-token-price:1.0.0',
        projectHealthStatus: 'PLAN_UNVERIFIED',
      });
      expect(await stack.machine.currentHealthStatus(op)).toBe('PLAN_UNVERIFIED');
      // The historical rows are unchanged after the sweep; only an append happened.
      const after = await stack.machine.history(op);
      expect(after.slice(0, before.length)).toEqual(before);
    } finally {
      await closeProvStack(stack);
    }
  });
});
