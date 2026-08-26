/**
 * Pipeline stage 23 (FR-CORE-002, FR-CORE-005; PRD §16.2): write audit AND
 * trace for success AND every failure/blocked exit through THE injected
 * AuditChain — the sole sink (tool-core never builds its own chain).
 *
 * The event payload carries actor, tool name/version, action class, outcome,
 * and a machine-readable reason; secret material has no field to live in.
 * Tamper-evident chain verification stays owned by the security suites — this
 * module only appends through it (and the composition root asserts chain
 * verification green in its own composition tests).
 */
import type { AuditChain } from '@foresift/security';
import type { ToolCallContext } from '../run-context.ts';

/** Outcome vocabulary carried in every audit payload. */
export type PipelineAuditOutcome = 'SUCCESS' | 'BLOCKED' | 'ERROR';

export interface AuditStageDeps {
  readonly chain: AuditChain;
}

const SECRET_FIELD_PATTERN = /(token|password|secret|privatekey|private_key|apikey|api_key|bearer|cookie)/i;

/**
 * Stage 23 — append exactly one audit entry per run: success, every blocked
 * exit, and unexpected internal errors alike. The append is the LAST write of
 * the pipeline besides the return itself, so its payload reflects final
 * settlement state.
 */
export async function writeAuditAndTrace(ctx: ToolCallContext, deps: AuditStageDeps): Promise<void> {
  const blockedExit = ctx.exit;
  const outcome: PipelineAuditOutcome =
    blockedExit === null ? 'SUCCESS' : blockedExit.auditOutcome;

  const payload: Record<string, unknown> = {
    pipelineRunId: ctx.runId,
    actor: ctx.actor?.actorId ?? 'unauthenticated',
    toolName: ctx.entry?.metadata.name ?? ctx.request.toolName,
    toolVersion: ctx.entry?.metadata.version ?? ctx.request.toolVersion ?? 'unknown',
    actionClass: ctx.actionClass ?? 'UNKNOWN',
    profileId: ctx.request.profileId,
    holderMode: ctx.request.holderMode,
    workloadClass: ctx.request.workloadClass,
    outcome,
    machineReason:
      blockedExit?.payload.machineReason ??
      (outcome === 'SUCCESS' ? 'OK' : 'UNEXPECTED_ERROR'),
    acquisitionPersistedAs: ctx.acquisitionPersistedAs,
    acquisitionCompleted: ctx.retrievalCompleted,
    cacheOutcome: ctx.cacheOutcome,
    storedInCache: ctx.storedInCache,
    backpressure: ctx.backpressure ?? null,
    reservationSettledAs: ctx.reservationSettledAs,
    actualUnits: ctx.actualUnits,
    evidenceIds: [...ctx.evidenceIds],
    sourceFingerprint: ctx.sourceFingerprint,
    fenceRefused: ctx.fenceRefused,
    degradedMarkers: [...ctx.degradedMarkers],
    trace: [...ctx.completedTrace],
    decisionId: ctx.decisionId,
  };
  if (blockedExit !== null) {
    payload.acquisitionState = blockedExit.payload.acquisitionState;
  }

  // Defense in depth against secret material entering the chain: sweep the
  // assembled payload BEFORE appending and refuse the run loudly if any key
  // smells like credential material. Values are data-shaped by construction;
  // this guards future edits that might rename a field into danger.
  for (const key of Object.keys(payload)) {
    if (SECRET_FIELD_PATTERN.test(key)) {
      throw new Error(`audit payload carries forbidden field name: ${key}`);
    }
  }
  if (blockedExit !== null && SECRET_FIELD_PATTERN.test(blockedExit.payload.machineReason)) {
    throw new Error('audit machineReason carries forbidden material marker');
  }

  const record = await deps.chain.append({
    occurredAt: ctx.now(),
    actor: typeof payload.actor === 'string' ? payload.actor : 'unauthenticated',
    actionClass:
      outcome === 'BLOCKED'
        ? 'BLOCKED_OPERATION'
        : outcome === 'ERROR'
          ? 'TOOL_RESOURCE_ACCESS'
          : ctx.rawResponse !== undefined
            ? 'PROVIDER_COLLECTOR_ACCESS'
            : 'TOOL_RESOURCE_ACCESS',
    subject: `tool:${String(payload.toolName)}@${String(payload.toolVersion)}`,
    payload,
  });
  ctx.auditSeq = record.seq;
}
