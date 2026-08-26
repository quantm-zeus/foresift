/**
 * THE shipped default QuotaReservationAdapter — an explicitly DENY-CLOSED
 * test double (FR-CORE-007). It lives here in tests/fixtures/core/, outside
 * packages/tool-core/src/**, because tool-core must ship NO production cost
 * semantics: until g0-cost-capacity injects a real adapter, every estimate
 * refuses as unknown-cost and nothing can reserve.
 *
 * Inert fixture module: imported by contract tests only.
 */
import type {
  QuotaAdmissionDecision,
  QuotaEstimate,
  QuotaEstimateRequest,
  QuotaReservationAdapter,
  ReservationRequest,
} from '../../../packages/tool-core/src/quota-contract.ts';
import { UnverifiableRightsRefusedSource } from '../../../packages/tool-core/src/license-contract.ts';

export class DenyClosedQuotaAdapter implements QuotaReservationAdapter {
  async estimate(_request: QuotaEstimateRequest): Promise<QuotaEstimate> {
    throw new Error('UNKNOWN_COST: no quota adapter is composed; refusing fail-closed');
  }

  async admit(
    _request: QuotaEstimateRequest & { readonly estimate: QuotaEstimate },
  ): Promise<QuotaAdmissionDecision> {
    return { allowed: false, reason: 'UNKNOWN_COST: deny-closed default adapter' };
  }

  async reserve(_request: ReservationRequest): Promise<string> {
    throw new Error('UNKNOWN_COST: deny-closed default adapter refuses reservation');
  }

  async commit(_request: { reservationId: string; actualUnits: number }): Promise<void> {
    throw new Error('UNKNOWN_COST: deny-closed default adapter refuses commit');
  }

  async release(_request: { reservationId: string }): Promise<void> {
    // Releasing a reservation that was never admitted converges silently:
    // cleanup paths must never fail closed on a refusal that already happened.
  }
}

/** The license seam ships equally closed by default. */
export const defaultLicenseSource = new UnverifiableRightsRefusedSource();
