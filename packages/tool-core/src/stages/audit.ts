/**
 * Pipeline stage 23 (FR-CORE-002, FR-CORE-005; PRD §16.2): append the audit
 * entry + trace for SUCCESS and for EVERY failure/blocked exit through the
 * injected AuditChain — the sole audit sink. Payloads carry actor, tool
 * name/version, action class, outcome, machine-readable reason, cache and
 * quota summaries; never secret material (arguments are hashed, not inlined).
 *
 * Tamper-evident chain verification is owned by the security suite; this
 * module only appends and exposes the resulting chain position.
 */
import type { AuditChain } from '@foresift/security';
import type { UtcTimestamp } from '@foresift/domain';
import type { ToolRunContext } from '../run-context.ts';

export interface AuditStageDeps {
  readonly auditChain: AuditChain;
  readonly now: () => UtcTimestamp;
}

/** The §35.9 audit classes the pipeline emits. */
export type PipelineAuditClass =
  'TOOL_RESOURCE_ACCESS' | 'PROVIDER_COLLECTOR_ACCESS' | 'BLOCKED_OPERATION';

export interface AuditOutcome {
  readonly seq: number;
  readonly entryHash: string;
  readonly auditClass: PipelineAuditClass;
}

export function auditClassFor(ctx: ToolRunContext): PipelineAuditClass {
  if (ctx.blocked !== undefined) return 'BLOCKED_OPERATION';
  if (ctx.servedFromCache) return 'TOOL_RESOURCE_ACCESS';
  if (ctx.route !== undefined) return 'PROVIDER_COLLECTOR_ACCESS';
  return 'TOOL_RESOURCE_ACCESS';
}

/** Stage 23 — WRITE_AUDIT_AND_TRACE_FOR_SUCCESS_OR_EVERY_FAILURE_BLOCKED_EXIT. */
export function makeAuditStage(deps: AuditStageDeps) {
  return async (ctx: ToolRunContext): Promise<void> => {
    if (ctx.audited) return; // idempotent under retry — one exit, one entry
    const machineReason =
      ctx.blocked?.machineReason ??
      (ctx.servedFromCache
        ? `CACHE_${ctx.cacheOutcome ?? 'HIT_FRESH'}`
        : ctx.outcomeState === 'RETURNED'
          ? 'RETURNED'
          : 'PROCESSED');
    const payload = {
      event: 'tool.pipeline.exit',
      pipelineRunId: ctx.runId,
      actor: ctx.actor?.actorId ?? 'anonymous',
      actorProfile: ctx.actor?.profileId ?? null,
      toolName: ctx.request.toolName,
      toolVersion: ctx.registryEntryVersion ?? ctx.request.toolVersion ?? '*',
      actionClass: ctx.actionClass ?? null,
      workloadClass: ctx.request.workloadClass,
      holderMode: ctx.request.holderMode,
      outcome: ctx.blocked ? 'BLOCKED' : 'SUCCESS',
      acquisitionState: ctx.blocked?.state ?? ctx.outcomeState ?? null,
      machineReason,
      exitedAtStage: ctx.blocked?.atStage ?? 'RETURN_STRUCTURED_RESULT',
      backpressure: ctx.blocked?.backpressure ?? null,
      cacheOutcome: ctx.cacheOutcome ?? null,
      quotaState: ctx.quotaState ?? null,
      evidenceCount: ctx.evidenceIds.length,
      sourceFingerprint: ctx.sourceFingerprint ?? null,
      executedStages: ctx.journal.map((entry) => entry.stage),
      at: deps.now(),
    };
    const record = await deps.auditChain.append({
      occurredAt: deps.now(),
      actor: ctx.actor?.actorId ?? 'tool-core-pipeline',
      actionClass: auditClassFor(ctx),
      subject: `${ctx.request.toolName}@${payload.toolVersion}:${ctx.runId}`,
      payload,
    });
    ctx.audited = true;
    ctx.auditRecord = {
      seq: record.seq,
      entryHash: record.entryHash,
      auditClass: auditClassFor(ctx),
    };
  };
}
