/**
 * Adapter registration (T115): the only path from a declarative adapter
 * descriptor into the provider-lifecycle operation registry.
 *
 * Registration refuses, in order:
 *  - wholesale capability bundles (one operation claiming several classes);
 *  - prohibited §15.2 capability classes;
 *  - operations without an exact per-operation allowlist descriptor.
 *
 * Every registered operation carries explicit negativeCapabilities covering
 * all four prohibited classes — the negative surface is attached HERE, at the
 * boundary, not inferred later.
 */
import {
  PROHIBITED_CAPABILITY_CLASSES,
  ProviderLifecycleError,
  ProvErrorCode,
  type OperationRegistry,
  type ProviderOperationDefinitionInput,
  type OperationRef,
} from '@foresift/provider-lifecycle';
import { validateAdapterDescriptor, type ProviderAdapterDescriptor } from './adapter-contract.ts';

export interface AdapterRegistrationResult {
  readonly providerId: string;
  readonly registered: readonly OperationRef[];
}

function provFailure(
  code: string,
  message: string,
  detail: Record<string, string | number | boolean | null>,
): ProviderLifecycleError {
  return new ProviderLifecycleError(code, message, detail);
}

/** Register a provider adapter into the lifecycle registry. Idempotent for
 * identical descriptors is NOT promised — duplicate refs are loud refusals. */
export async function registerAdapter(
  lifecycle: Pick<OperationRegistry, 'registerProvider' | 'registerOperation'>,
  descriptor: ProviderAdapterDescriptor,
): Promise<AdapterRegistrationResult> {
  validateAdapterDescriptor(descriptor);

  await lifecycle.registerProvider({
    providerId: descriptor.providerId,
    displayName: descriptor.displayName,
    providerGroup: descriptor.providerGroup,
  });

  const registered: OperationRef[] = [];
  for (const operation of descriptor.operations) {
    if (operation.planGated === true && operation.allowedInStrictFree) {
      throw provFailure(
        ProvErrorCode.PROV_DEFINITION_INVALID,
        `plan-gated operation ${operation.operationId} cannot be allowed under STRICT_FREE`,
        { operationId: operation.operationId },
      );
    }
    const definition: ProviderOperationDefinitionInput = {
      ref: {
        providerId: descriptor.providerId,
        operationId: operation.operationId,
        version: operation.version,
      },
      displayName: operation.displayName,
      capabilityClass: operation.capabilityClass as ProviderOperationDefinitionInput['capabilityClass'],
      costClass: operation.costClass as ProviderOperationDefinitionInput['costClass'],
      supportedChains: [...operation.supportedChains],
      ...(operation.supportedPrograms === undefined
        ? {}
        : { supportedPrograms: operation.supportedPrograms }),
      inputSchemaId: operation.inputSchemaId,
      rawOutputSchemaId: operation.rawOutputSchemaId,
      normalizedOutputSchemaId: operation.normalizedOutputSchemaId,
      quotaModelId: operation.quotaModelId,
      cachePolicyId: operation.cachePolicyId,
      timeoutMs: operation.timeoutMs,
      retryPolicyId: operation.retryPolicyId,
      declaredIndependenceGroup: operation.declaredIndependenceGroup,
      upstreamLineage: [...operation.upstreamLineage],
      licensePolicyId: operation.licensePolicyId,
      estimatedQuotaUnits: operation.estimatedQuotaUnits,
      quotaResetPolicyId: operation.quotaResetPolicyId,
      protectedReserveEligible: operation.protectedReserveEligible,
      allowedInStrictFree: operation.allowedInStrictFree,
      paidFallbackAllowed: operation.paidFallbackAllowed,
      verificationExpiresAt: operation.verificationExpiresAt,
      forbiddenOutputFields: [...(operation.forbiddenOutputFields ?? [])],
      negativeCapabilities: [...PROHIBITED_CAPABILITY_CLASSES],
      ...(operation.deprecatedAt === undefined ? {} : { deprecatedAt: operation.deprecatedAt }),
      ...(operation.sunsetAt === undefined ? {} : { sunsetAt: operation.sunsetAt }),
      ...(operation.replacementOperationId === undefined
        ? {}
        : { replacementOperationId: operation.replacementOperationId }),
    };
    registered.push(await lifecycle.registerOperation(definition));
  }
  return { providerId: descriptor.providerId, registered };
}
