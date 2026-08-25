/**
 * Adapter registration (FR-PROV-004; §15.2, §41.1, AC-254).
 *
 * Capability arrives ONLY as individually registered, audited read-only
 * operation adapters. Registration refuses:
 *   * WHOLESALE BUNDLE exposure — a package/SDK/MCP surface presented as
 *     one unit is never registered, whatever its contents;
 *   * PROHIBITED_* capability classes — unrepresentable in the registry and
 *     never enableable by configuration;
 *   * catalog entries lacking an exact allowlist descriptor — an operation
 *     without its eleven-dimension declaration has no runtime admission;
 *   * entries whose descriptor does not name the same operation.
 *
 * Every registered operation leaves registration carrying
 * `negativeCapabilities` metadata (the floor is enforced, not decorative)
 * so the tree-level scan surfaces see the real exposure of each operation.
 */
import {
  ADMISSIBLE_CAPABILITY_CLASSES,
  OperationRegistry,
  ProvErrorCode,
  RegistryError,
  type OperationDefinition,
} from '@foresift/provider-lifecycle';
import { AdapterRegistrationError } from '@foresift/provider-lifecycle';
import type { DatabaseEngine } from '@foresift/persistence';
import type { ProviderCatalogEntry } from './catalog-support.ts';

/** Metadata floor attached to EVERY registered operation (AC-254). */
export const READ_ONLY_NEGATIVE_CAPABILITIES: readonly string[] = [
  'no-trading',
  'no-custody',
  'no-signing',
  'no-private-key-handling',
  'no-transaction-submission',
];

export interface RegisteredAdapterOperation {
  readonly definition: OperationDefinition;
  readonly allowlist: ProviderCatalogEntry['allowlist'];
}

export interface RegisteredAdapter {
  readonly providerId: string;
  readonly displayName: string;
  readonly operations: readonly RegisteredAdapterOperation[];
}

export interface AdapterRegistrationInput {
  readonly providerId: string;
  readonly displayName: string;
  readonly providerGroup?: string;
  /**
   * Exposure kind: individually enumerated operations only. A wholesale
   * bundle submission refuses outright BEFORE any entry is inspected.
   */
  readonly exposure:
    | { readonly kind: 'INDIVIDUAL_OPERATIONS' }
    | { readonly kind: 'WHOLESALE_BUNDLE'; readonly ref: string };
  readonly operations: readonly ProviderCatalogEntry[];
}

export class AdapterRegistrar {
  private readonly registry: OperationRegistry;

  constructor(options: { readonly engine: DatabaseEngine }) {
    this.registry = new OperationRegistry({ engine: options.engine });
  }

  /** Register one adapter's audited operations. Idempotent per definition. */
  async registerAdapter(input: AdapterRegistrationInput): Promise<RegisteredAdapter> {
    if (input.exposure.kind === 'WHOLESALE_BUNDLE') {
      throw new AdapterRegistrationError(
        `wholesale bundle exposure '${input.exposure.ref}' refused — capability arrives only as individually registered audited operations`,
        { ref: input.exposure.ref },
        ProvErrorCode.PROV_ADAPTER_WHOLESALE_BUNDLE_REFUSED,
      );
    }
    if (input.operations.length === 0) {
      throw new AdapterRegistrationError(
        'adapter declares no operations',
        { providerId: input.providerId },
        ProvErrorCode.PROV_ADAPTER_CATALOG_INVALID,
      );
    }

    const seen = new Set<string>();
    for (const entry of input.operations) {
      // Runtime presence check (TS callers get it statically; JS callers do
      // not — the refusal must hold for both).
      if (
        typeof entry !== 'object' ||
        entry === null ||
        (entry as Partial<ProviderCatalogEntry>).allowlist === undefined ||
        (entry as Partial<ProviderCatalogEntry>).definition === undefined
      ) {
        throw new AdapterRegistrationError(
          `catalog entry lacks an allowlist descriptor — no operation registers without its exact eleven-dimension declaration`,
          { providerId: input.providerId },
          ProvErrorCode.PROV_ADAPTER_ALLOWLIST_DESCRIPTOR_MISSING,
        );
      }
      const { definition, allowlist } = entry as ProviderCatalogEntry;
      if (allowlist.operationId !== definition.operationId) {
        throw new AdapterRegistrationError(
          `allowlist descriptor names '${allowlist.operationId}' but the entry defines '${definition.operationId}'`,
          { descriptorOperationId: allowlist.operationId, definitionOperationId: definition.operationId },
          ProvErrorCode.PROV_ADAPTER_CATALOG_INVALID,
        );
      }
      if (seen.has(definition.operationId)) {
        throw new AdapterRegistrationError(
          `duplicate operation '${definition.operationId}' in one adapter registration`,
          { operationId: definition.operationId },
          ProvErrorCode.PROV_ADAPTER_CATALOG_INVALID,
        );
      }
      seen.add(definition.operationId);

      const capabilityClass = definition.capabilityClass as string;
      if (capabilityClass.startsWith('PROHIBITED_')) {
        throw new AdapterRegistrationError(
          `prohibited capability class '${capabilityClass}' is never registrable or enableable by configuration`,
          { operationId: definition.operationId, capabilityClass },
          ProvErrorCode.PROV_CAPABILITY_CLASS_PROHIBITED,
        );
      }
      if (!ADMISSIBLE_CAPABILITY_CLASSES.includes(definition.capabilityClass)) {
        throw new RegistryError(
          `'${String(capabilityClass)}' is not in the capability-class vocabulary`,
          { operationId: definition.operationId, capabilityClass: String(capabilityClass) },
          ProvErrorCode.PROV_DEFINITION_INVALID,
        );
      }
    }

    await this.registry.registerProvider({
      providerId: input.providerId,
      providerGroup: input.providerGroup ?? 'external-provider',
      displayName: input.displayName,
    });

    const operations: RegisteredAdapterOperation[] = [];
    for (const entry of input.operations as readonly ProviderCatalogEntry[]) {
      const merged: OperationDefinition = {
        ...entry.definition,
        negativeCapabilities: [
          ...new Set([...READ_ONLY_NEGATIVE_CAPABILITIES, ...entry.definition.negativeCapabilities]),
        ],
      };
      await this.registry.registerOperation(merged);
      operations.push(Object.freeze({ definition: Object.freeze({ ...merged }), allowlist: entry.allowlist }));
    }
    return Object.freeze({
      providerId: input.providerId,
      displayName: input.displayName,
      operations: Object.freeze(operations),
    });
  }
}
