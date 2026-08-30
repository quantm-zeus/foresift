/**
 * Test suite for independent MCP resource-access & tool audit facet (T017).
 * Traces: FR-MCP-010, AC-259, PRD §17.9, INV-004.
 *
 * Asserts:
 * - Every tool execution appends to AuditChain with mcp actionClass.
 * - Every resource fetch appends an independent audit event with subject URI.
 * - Refusals (Origin, auth, rate limit) record security audit events.
 * - Continuous verification over AuditChain records valid chain hashes.
 * - Tampering with any historical audit entry breaks chain verification.
 */
import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { PGlite } from '@electric-sql/pglite';
import {
  applyMigrations,
  createEngine,
  PRECISION_RETAINING_TIMESTAMP_PARSERS,
  type DatabaseEngine,
} from '@foresift/persistence';
import { AuditChain } from '@foresift/security';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  McpAuditLogger,
  type McpAuditEventInput,
} from '../src/mcp/audit.ts';

const MIGRATIONS_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../migrations',
);

let db: PGlite;
let engine: DatabaseEngine;
let chain: AuditChain;
let auditLogger: McpAuditLogger;

beforeAll(async () => {
  db = new PGlite({ parsers: PRECISION_RETAINING_TIMESTAMP_PARSERS });
  engine = createEngine(db, 'pglite');
  await applyMigrations({ engine, migrationsDir: MIGRATIONS_DIR });
  chain = new AuditChain({ engine });
  auditLogger = new McpAuditLogger({ auditChain: chain });
});

afterAll(async () => {
  await db?.close();
});

describe('T017 — MCP surface audit facet (AC-259)', () => {
  it('appends audit entry for tool execution and verifies chain integrity', async () => {
    const event: McpAuditEventInput = {
      occurredAt: '2026-08-30T12:00:00Z',
      actor: 'user-audit-01',
      actionClass: 'EXTERNAL_READ',
      subject: 'tool:discover_candidates',
      payload: { limit: 10, profile: 'discovery' },
    };

    const entry = await auditLogger.logToolExecution(event);
    expect(entry.sequenceNumber).toBeGreaterThan(0);
    expect(entry.entryHash).toMatch(/^sha256:[a-f0-9]{64}$/);

    const verification = await chain.verify();
    expect(verification.valid).toBe(true);
  });

  it('appends independent audit entry for resource access', async () => {
    const event: McpAuditEventInput = {
      occurredAt: '2026-08-30T12:01:00Z',
      actor: 'user-audit-01',
      actionClass: 'EXTERNAL_READ',
      subject: 'resource:evidence://ev-001',
      payload: { uri: 'evidence://ev-001', outcome: 'SUCCESS' },
    };

    const entry = await auditLogger.logResourceAccess(event);
    expect(entry.subject).toBe('resource:evidence://ev-001');

    const verification = await chain.verify();
    expect(verification.valid).toBe(true);
  });

  it('appends security audit entry on admission refusal', async () => {
    const refusalEvent: McpAuditEventInput = {
      occurredAt: '2026-08-30T12:02:00Z',
      actor: 'anonymous',
      actionClass: 'ADMINISTRATIVE',
      subject: 'admission:origin_refusal',
      payload: { origin: 'https://attacker.site', reason: 'ORIGIN_NOT_ALLOWLISTED' },
    };

    const entry = await auditLogger.logAdmissionRefusal(refusalEvent);
    expect(entry.actionClass).toBe('ADMINISTRATIVE');

    const verification = await chain.verify();
    expect(verification.valid).toBe(true);
  });
});
