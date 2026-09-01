import { ManifestErrorCode, RequirementManifestError } from './errors.ts';

const ID_PATTERNS = {
  requirement: /^FR-[A-Z0-9]+-[0-9]{3,}$/,
  acceptance: /^AC-[0-9]{3,}$/,
  invariant: /^INV-[0-9]{3,}$/,
  // The v6.0 artifact uses ADR-001…058; four-digit ADR refs are also reserved.
  adr: /^ADR-[0-9]{3,4}$/,
} as const;

export function validateIdGrammar(id: unknown): {
  readonly valid: boolean;
  readonly namespace?: keyof typeof ID_PATTERNS;
} {
  if (typeof id !== 'string') return { valid: false };
  for (const [namespace, pattern] of Object.entries(ID_PATTERNS)) {
    if (pattern.test(id)) return { valid: true, namespace: namespace as keyof typeof ID_PATTERNS };
  }
  return { valid: false };
}

interface IdItem {
  readonly id: string;
}

export interface ManifestIdInventory {
  readonly requirements?: readonly IdItem[];
  readonly acceptanceCriteria?: readonly IdItem[];
  readonly invariants?: readonly IdItem[];
  readonly adrs?: readonly IdItem[];
}

export function checkGlobalIdUniqueness(manifest: ManifestIdInventory): {
  readonly isUnique: boolean;
  readonly duplicates: readonly string[];
  readonly totalIds: number;
} {
  const seen = new Set<string>();
  const duplicates = new Set<string>();
  for (const item of [
    ...(manifest.requirements ?? []),
    ...(manifest.acceptanceCriteria ?? []),
    ...(manifest.invariants ?? []),
    ...(manifest.adrs ?? []),
  ]) {
    if (seen.has(item.id)) duplicates.add(item.id);
    seen.add(item.id);
  }
  return {
    isUnique: duplicates.size === 0,
    duplicates: [...duplicates].sort(),
    totalIds: seen.size,
  };
}

export function validateSupersessionContract(input: {
  readonly replacedIds?: readonly string[];
  readonly supersessionLedger?: readonly {
    readonly replacedId?: string;
    readonly supersededId?: string;
    readonly supersededById?: string;
    readonly replacementId?: string;
  }[];
  readonly newItems?: readonly { readonly id: string; readonly text?: string }[];
  readonly historicalReleasedIds?: ReadonlySet<string>;
}): { readonly valid: true } {
  for (const item of input.newItems ?? []) {
    if (input.historicalReleasedIds?.has(item.id)) {
      throw new RequirementManifestError(
        ManifestErrorCode.ID_REUSE_FORBIDDEN,
        `re-use of released ID ${item.id} is forbidden`,
        { id: item.id },
      );
    }
  }
  for (const id of input.replacedIds ?? []) {
    const links = (input.supersessionLedger ?? []).filter(
      (link) => (link.replacedId ?? link.supersededId) === id,
    );
    if (links.length !== 1 || !(links[0]?.supersededById ?? links[0]?.replacementId)) {
      throw new RequirementManifestError(
        ManifestErrorCode.SUPERSESSION_LINK_REQUIRED,
        `replaced ID ${id} requires exactly one explicit supersession link`,
        { id },
      );
    }
  }
  return { valid: true };
}

/** Released inventories remain in source-document order (their line anchors never regress). */
export function checkStableOrdering(manifest: {
  readonly requirements?: readonly { readonly line: number }[];
  readonly acceptanceCriteria?: readonly { readonly line: number }[];
  readonly invariants?: readonly { readonly line: number }[];
  readonly adrs?: readonly { readonly line: number }[];
}): { readonly isStable: boolean; readonly unstableNamespaces: readonly string[] } {
  const inventories = {
    requirements: manifest.requirements,
    acceptanceCriteria: manifest.acceptanceCriteria,
    invariants: manifest.invariants,
    adrs: manifest.adrs,
  };
  const unstableNamespaces = Object.entries(inventories)
    .filter(([, items]) =>
      items?.some((item: { readonly line: number }, index: number) =>
        index > 0 ? item.line <= items[index - 1]!.line : false,
      ),
    )
    .map(([name]) => name);
  return { isStable: unstableNamespaces.length === 0, unstableNamespaces };
}
