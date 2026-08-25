/**
 * Reference adapter pair for the seam-stability proof (T503; milestone
 * objective): BOTH extension-point interfaces implemented entirely outside
 * packages/tool-core/src/**, driving the reservation lifecycle and license
 * verdicts with deterministic test semantics and ZERO edits to tool-core
 * sources. Inert fixture module — imported by contract tests only.
 */
import type {
  QuotaAdmissionDecision,
  QuotaEstimate,
  QuotaEstimateRequest,
  QuotaReservationAdapter,
  ReservationRequest,
} from '../../../packages/tool-core/src/quota-contract.ts';
import {
  commitReservation,
  insertPendingReservation,
  releaseReservation,
  reserveReservation,
} from '../../../packages/tool-core/src/quota-contract.ts';
import type {
  LicensePolicySource,
  LicenseQuery,
} from '../../../packages/tool-core/src/license-contract.ts';

/**
 * Deterministic STRICT_FREE-shaped semantics for tests: a fixed catalog of
 * known operations costs exactly one unit; anything else is unknown cost and
 * refuses admission. No pricing tables — that vocabulary stays out of scope.
 */
const KNOWN_OPERATIONS = new Set(['token_security', 'token_profile']);

export class ReferenceQuotaAdapter implements QuotaReservationAdapter {
  constructor(private readonly engine: unknown) {}

  async estimate(request: QuotaEstimateRequest): Promise<QuotaEstimate> {
    if (!KNOWN_OPERATIONS.has(request.operation)) {
      throw new Error(`UNKNOWN_COST: ${request.operation}`);
    }
    return { quotaModel: 'REQUESTS_PER_PERIOD', estimatedUnits: 1 };
  }

  async admit(
    request: QuotaEstimateRequest & { readonly estimate: QuotaEstimate },
  ): Promise<QuotaAdmissionDecision> {
    if (!KNOWN_OPERATIONS.has(request.operation)) {
      return { allowed: false, reason: `UNKNOWN_COST: ${request.operation}` };
    }
    return { allowed: true, reason: 'known operation within strict-free budget' };
  }

  async reserve(request: ReservationRequest): Promise<string> {
    const reservationId = `rsv-${request.pipelineRunId}-${request.stage}`;
    await insertPendingReservation(this.engine as Parameters<typeof insertPendingReservation>[0], {
      reservationId,
      pipelineRunId: request.pipelineRunId,
      stage: request.stage,
      actorId: request.actorId,
      provider: request.provider,
      operation: request.operation,
      workloadClass: request.workloadClass,
      estimatedUnits: request.estimate.estimatedUnits,
    });
    await reserveReservation(this.engine as Parameters<typeof reserveReservation>[0], {
      reservationId,
    });
    return reservationId;
  }

  async commit(request: { reservationId: string; actualUnits: number }): Promise<void> {
    await commitReservation(this.engine as Parameters<typeof commitReservation>[0], request);
  }

  async release(request: { reservationId: string }): Promise<void> {
    await releaseReservation(this.engine as Parameters<typeof releaseReservation>[0], request);
  }
}

/** Version-pinned allow source: rights-1 admits; anything else refuses. */
export class ReferenceLicenseSource implements LicensePolicySource {
  async verdict(query: LicenseQuery) {
    const version = 'rights-1';
    const allowed =
      query.licensePolicyId === 'rights-verified-only' && query.requestedVersion === version;
    return {
      allowed,
      policyVersion: query.requestedVersion ?? version,
      reason: allowed ? 'policy version pinned and verified' : 'unverifiable or unpinned rights',
    };
  }
}
