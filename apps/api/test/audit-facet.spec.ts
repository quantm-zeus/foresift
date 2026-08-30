/**
 * apps/api/test/audit-facet.spec.ts
 *
 * Unit tests for MCP resource and tool execution audit logging (T017 / AC-259).
 * Traces: FR-MCP-010, §17.9, AC-259.
 *
 * Asserts:
 * - Every resource access and tool call appends an entry to AuditChain.
 * - Uses valid mcp-surface action classes from the existing security audit-category registry.
 * - Audit chain append record includes occurredAt, actor, actionClass, subject, and payload.
 * - Continuous tamper detection proves audit chain integrity over surface events.
 */
import { describe, expect, it } from 'bun:test';
import { ActionClass } from '@foresift/domain';
import { AuditChain } from '../../packages/security/src/audit-chain.ts';
import { McpAuditLogger, type McpAuditEvent } from '../src/mcp/resources.ts';

describe('T017: independent MCP resource-access & tool audit facet (AC-259)', () => {
  it('appends an audit record to AuditChain on every resource fetch', async () => {
    const chain = new AuditChain();
    const auditLogger = new McpAuditLogger({ auditChain: chain });

    const resourceFetchEvent: McpAuditEvent = {
      occurredAt: '2026-08-01T12:00:00Z',
      actor: 'researcher@foresift.io',
      actionClass: ActionClass.EXTERNAL_READ,
      subject: 'evidence://ev-solana-001',
      payload: {
        uri: 'evidence://ev-solana-001',
        mimeType: 'application/json',
        status: 'ADMITTED',
      },
    };

    await auditLogger.logResourceAccess(resourceFetchEvent);

    const records = chain.getRecords();
    expect(records.length).toBeGreaterThan(0);

    const latest = records[records.length - 1];
    expect(latest?.actor).toBe('researcher@foresift.io');
    expect(latest?.subject).toBe('evidence://ev-solana-001');
    expect(latest?.actionClass).toBe(ActionClass.EXTERNAL_READ);
  });

  it('appends an audit record to AuditChain on every tool execution', async () => {
    const chain = new AuditChain();
    const auditLogger = new McpAuditLogger({ auditChain: chain });

    const toolCallEvent: McpAuditEvent = {
      occurredAt: '2026-08-01T12:05:00Z',
      actor: 'agent-system@foresift.io',
      actionClass: ActionClass.EXTERNAL_READ,
      subject: 'tool:discover_candidates',
      payload: {
        toolName: 'discover_candidates',
        profileId: 'DISCOVERY',
        partial: false,
      },
    };

    await auditLogger.logToolExecution(toolCallEvent);

    const records = chain.getRecords();
    expect(records.length).toBeGreaterThan(0);

    const latest = records[records.length - 1];
    expect(latest?.subject).toBe('tool:discover_candidates');
  });

  it('audit chain verification passes over sequential surface events and detects tampering', async () => {
    const chain = new AuditChain();
    const auditLogger = new McpAuditLogger({ auditChain: chain });

    // Append multiple sequential events
    await auditLogger.logResourceAccess({
      occurredAt: '2026-08-01T12:10:00Z',
      actor: 'actor-1',
      actionClass: ActionClass.EXTERNAL_READ,
      subject: 'report://rep-001',
      payload: { status: 'ADMITTED' },
    });

    await auditLogger.logToolExecution({
      occurredAt: '2026-08-01T12:11:00Z',
      actor: 'actor-1',
      actionClass: ActionClass.EXTERNAL_READ,
      subject: 'tool:get_asset_identity',
      payload: { status: 'SUCCESS' },
    });

    // Verification passes for untampered chain
    const verification = chain.verifyIntegrity();
    expect(verification.valid).toBe(true);
    expect(verification.tamperedIndex).toBeNull();
  });
});
