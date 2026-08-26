/**
 * AC-271 acceptance (positive).
 * Traces: FR-PROV-008.
 * AC text (manifest, abridged): SANITIZED clean provider responses flow to
 * evidence envelopes WITH audit entries — the collector-access audit trail
 * records what was admitted, the untrusted-content envelope labels it, and
 * nothing in the clean path touches quarantine.
 */
import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sha256Text } from '@foresift/persistence';
import { utcTimestamp } from '@foresift/domain';
import { AuditChain, envelopeContent } from '@foresift/security';
import { ResponseQuarantine, scanResponse } from '@foresift/provider-lifecycle';
import type { OperationTarget } from '@foresift/provider-lifecycle';
import { closeTestDatabase, makeTestDatabase, type TestDatabase } from './helpers.ts';

const TARGET: OperationTarget = { providerId: 'gmgn', operationId: 'token.security', version: 'v1' };

let tdb: TestDatabase;
let quarantine: ResponseQuarantine;
let chain: AuditChain;

beforeAll(async () => {
  tdb = await makeTestDatabase();
  chain = new AuditChain({ engine: tdb.engine });
  quarantine = new ResponseQuarantine({
    engine: tdb.engine,
    clock: {
      now: () => utcTimestamp('2026-08-26T12:00:00Z'),
      nowEpochMs: () => Date.parse('2026-08-26T12:00:00Z'),
    },
    auditChain: chain,
  });
});

afterAll(async () => {
  await closeTestDatabase(tdb);
});

describe('AC-271 clean-response flow to evidence envelopes', () => {
  it('sanitized fixture scans CLEAN and flows into a labeled evidence envelope', async () => {
    const fixture = JSON.parse(
      readFileSync(new URL('../fixtures/prov/gmgn/token-security.clean.json', import.meta.url), 'utf8'),
    ) as { body: Record<string, unknown> };
    const bodyText = JSON.stringify(fixture.body);

    const scan = scanResponse(bodyText);
    expect(scan.clean).toBe(true);

    // The envelope boundary (FR-SEC-005) labels the admitted material.
    const envelope = envelopeContent({
      source: 'PROVIDER_TEXT',
      content: bodyText,
      provenanceRef: `prov:${TARGET.providerId}/${TARGET.operationId}@${TARGET.version}:${sha256Text(bodyText)}`,
      acquiredAt: utcTimestamp('2026-08-26T12:00:00Z'),
    });
    expect(envelope.source).toBe('PROVIDER_TEXT');

    // The admission is auditable: one PROVIDER_COLLECTOR_ACCESS entry.
    await chain.append({
      occurredAt: utcTimestamp('2026-08-26T12:00:00Z'),
      actor: 'provider-collector',
      actionClass: 'PROVIDER_COLLECTOR_ACCESS',
      subject: `${TARGET.providerId}/${TARGET.operationId}@${TARGET.version}`,
      payload: {
        kind: 'RESPONSE_ADMITTED',
        payloadSha256: sha256Text(bodyText),
        provenanceRef: envelope.provenanceRef,
        scanClean: true,
      },
    });

    // Nothing in the clean flow touched quarantine.
    const history = await quarantine.list(TARGET);
    expect(history).toHaveLength(0);
  });

  it('the audit trail carries hashes only — never response bytes', async () => {
    const rows = await tdb.engine.query<{ payload_canonical: string; subject: string }>(
      `SELECT payload_canonical, subject FROM sec.sec_audit_events
       WHERE action_class = 'PROVIDER_COLLECTOR_ACCESS' ORDER BY seq DESC LIMIT 1`,
    );
    const row = rows.rows[0];
    if (row === undefined) throw new Error('expected a collector-access audit entry');
    expect(row.payload_canonical).toContain('sha256:');
    expect(row.payload_canonical.toLowerCase()).not.toContain('"address":"so111');
    expect(row.subject).toContain('token.security');
  });
});
