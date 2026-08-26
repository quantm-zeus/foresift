/**
 * Adapter registration (FR-PROV-004; T115).
 *
 * Only audited read-only operation adapters are permitted. Registration:
 *   * REFUSES prohibited capability classes (trading/signing/custody/
 *     transaction-building) outright — an adapter cannot smuggle them in;
 *   * refuses capability classes outside the vocabulary entirely;
 *   * refuses wholesale multi-operation bundle exposure — one descriptor
 *     standing in for many undeclared operations is exactly the "install the
 *     whole SDK bundle" shape FR-PROV-004 prohibits; every operation is
 *     individually declared with its own exact allowlist descriptor;
 *   * refuses catalog entries that lack a descriptor at all
 *     (allowlist-required);
 *   * attaches negativeCapabilities metadata to EVERY registered operation so
 *     scan surfaces report what the operation must never do.
 */
import { z } from 'zod';
import type { EgressAllowlistEntry } from '@foresift/shared-schemas';
import { EgressGuard } from '@foresift/security';
import {
  ALLOWED_CAPABILITY_CLASSES,
  isProhibitedCapabilityClass,
  REQUIRED_NEGATIVE_CAPABILITIES,
} from '@foresift/provider-lifecycle';
import type { OperationDefinition, OperationRegistry } from '@foresift/provider-lifecycle';
import { AllowlistDescriptorSchema, type AllowlistDescriptor } from './adapter-contract.ts';
import { ProviderAdapterError, ProvAdapterErrorCode } from './errors.ts';

/** Raw registration input — descriptor deliberately optional so the
 * allowlist-required refusal is enforceable HERE rather than by types. */
export interface AdapterCatalogEntryInput {
  readonly operation: OperationDefinition;
  readonly descriptor?: AllowlistDescriptor | null;
  /**
   * Present ONLY when an entry tries to expose several operations behind one
   * descriptor — always refused as wholesale bundle exposure.
   */
  readonly bundleOperationIds?: readonly string[] | undefined;
  /** Runtime response contract bound to the operation. */
  readonly responseSchemaId: string;
  /** The Zod schema responses must satisfy (paired with responseSchemaId). */
  readonly responseSchema: z.ZodType<unknown>;
}

export interface AdapterManifestInput {
  readonly adapterId: string;
  readonly providerId: string;
  readonly plane: EgressAllowlistEntry['plane'];
  readonly operations: readonly AdapterCatalogEntryInput[];
}

export interface AdapterRegistrationResult {
  readonly adapterId: string;
  readonly registeredOperationIds: readonly string[];
  readonly allowlistEntries: readonly EgressAllowlistEntry[];
}

/** The negative-capability metadata attached to every registered operation. */
export function requiredNegativeCapabilities(): readonly string[] {
  return REQUIRED_NEGATIVE_CAPABILITIES;
}

export class AdapterRegistrar {
  private readonly registry: OperationRegistry;

  constructor(deps: { registry: OperationRegistry }) {
    this.registry = deps.registry;
  }

  async register(manifest: AdapterManifestInput): Promise<AdapterRegistrationResult> {
    if (manifest.adapterId.trim().length === 0 || manifest.operations.length === 0) {
      throw new ProviderAdapterError(
        'an adapter manifest requires an id and at least one declared operation',
        { adapterId: manifest.adapterId },
        ProvAdapterErrorCode.PROV_ADAPTER_ALLOWLIST_REQUIRED,
      );
    }
    const registeredOperationIds: string[] = [];
    const allowlistEntries: EgressAllowlistEntry[] = [];
    for (const entry of manifest.operations) {
      // Wholesale bundle exposure: one descriptor for MANY operations.
      if (entry.bundleOperationIds !== undefined && entry.bundleOperationIds.length > 1) {
        throw new ProviderAdapterError(
          `entry for ${entry.operation.operationId} exposes ${String(entry.bundleOperationIds.length)} operations behind one descriptor — wholesale bundle exposure is refused`,
          { bundleOperationIds: [...entry.bundleOperationIds] },
          ProvAdapterErrorCode.PROV_ADAPTER_BUNDLE_EXPOSURE_REFUSED,
        );
      }
      // Exact per-operation allowlist descriptor is MANDATORY.
      if (entry.descriptor === undefined || entry.descriptor === null) {
        throw new ProviderAdapterError(
          `operation ${entry.operation.operationId} has no allowlist descriptor; adapters without exact egress contracts are refused`,
          { operationId: entry.operation.operationId },
          ProvAdapterErrorCode.PROV_ADAPTER_ALLOWLIST_REQUIRED,
        );
      }
      const descriptor = AllowlistDescriptorSchema.parse(entry.descriptor);
      if (descriptor.operationId !== entry.operation.operationId) {
        throw new ProviderAdapterError(
          `descriptor names operation '${descriptor.operationId}' but is attached to '${entry.operation.operationId}'`,
          { operationId: entry.operation.operationId },
          ProvAdapterErrorCode.PROV_ADAPTER_ALLOWLIST_REQUIRED,
        );
      }
      // Capability-class gates (the registry remains the SQL-side backstop).
      const capability = String(entry.operation.capabilityClass);
      if (!ALLOWED_CAPABILITY_CLASSES.includes(capability as never)) {
        if (isProhibitedCapabilityClass(capability)) {
          throw new ProviderAdapterError(
            `capability class ${capability} is prohibited (read-only product boundary)`,
            { operationId: entry.operation.operationId, capabilityClass: capability },
            ProvAdapterErrorCode.PROV_ADAPTER_CAPABILITY_PROHIBITED,
          );
        }
        throw new ProviderAdapterError(
          `capability class ${capability} is not in the allowed vocabulary`,
          { operationId: entry.operation.operationId, capabilityClass: capability },
          ProvAdapterErrorCode.PROV_ADAPTER_CAPABILITY_UNKNOWN,
        );
      }

      await this.registry.registerOperation(entry.operation);
      registeredOperationIds.push(entry.operation.operationId);
      allowlistEntries.push({
        host: descriptor.host,
        port: descriptor.port,
        scheme: 'https',
        plane: manifest.plane,
      });
    }
    return {
      adapterId: manifest.adapterId,
      registeredOperationIds,
      allowlistEntries,
    };
  }
}

/** Convenience: build an EgressGuard over registered descriptors' entries. */
export function egressGuardFor(
  allowlist: readonly EgressAllowlistEntry[],
  resolver: ConstructorParameters<typeof EgressGuard>[0]['resolver'],
): EgressGuard {
  return new EgressGuard({ allowlist: [...allowlist], resolver });
}

/** Zod passthrough used by catalogs to type recorded query responses. */
export const recordedQueryResponse = <T extends z.ZodRawShape>(shape: T): z.ZodType<z.infer<z.ZodObject<T>>> =>
  z.object(shape).passthrough() as unknown as z.ZodType<z.infer<z.ZodObject<T>>>;
