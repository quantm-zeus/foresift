/** @requirement FR-TRACE-002 @acceptance AC-265 AC-266 */
export type IdNamespace = 'requirement' | 'acceptance' | 'invariant' | 'adr';

const GRAMMARS: readonly [IdNamespace, RegExp][] = [
  ['requirement', /^FR-[A-Z][A-Z0-9]*-\d{3}$/],
  ['acceptance', /^AC-\d{3}$/],
  ['invariant', /^INV-\d{3}$/],
  ['adr', /^ADR-\d{3,4}$/],
];

export function validateIdGrammar(id: unknown): { valid: boolean; namespace?: IdNamespace; error?: string } {
  if (typeof id !== 'string') return { valid: false, error: 'ID must be a string' };
  const match = GRAMMARS.find(([, grammar]) => grammar.test(id));
  return match ? { valid: true, namespace: match[0] } : { valid: false, error: `ID_SHAPE_INVALID: ${id}` };
}

function normativeCollections(manifest: any): any[][] {
  return [manifest?.requirements ?? [], manifest?.acceptanceCriteria ?? [], manifest?.invariants ?? [], manifest?.adrs ?? []];
}

export function checkGlobalIdUniqueness(manifest: any): {
  isUnique: boolean; duplicates: string[]; invalidIds: string[]; totalIds: number;
} {
  const ids = normativeCollections(manifest).flat().map((item) => item?.id);
  const seen = new Set<string>();
  const duplicates = new Set<string>();
  const invalidIds = new Set<string>();
  for (const id of ids) {
    if (!validateIdGrammar(id).valid) invalidIds.add(String(id));
    if (seen.has(id)) duplicates.add(id); else seen.add(id);
  }
  return {
    isUnique: duplicates.size === 0 && invalidIds.size === 0,
    duplicates: [...duplicates].sort(), invalidIds: [...invalidIds].sort(), totalIds: ids.length,
  };
}

export function checkStableOrdering(manifest: any): {
  isStable: boolean; unstableNamespaces: string[];
} {
  const names = ['requirements', 'acceptanceCriteria', 'invariants', 'adrs'];
  const unstableNamespaces = names.filter((name) => {
    const items = manifest?.[name] ?? [];
    // The authoritative document line is the primary order. Synthetic inputs without anchors
    // use lexical IDs, which makes the rule independently testable.
    const anchored = items.every((item: any) => Number.isInteger(item?.line));
    const keys = items.map((item: any) => anchored ? item.line : item.id);
    return keys.some((key: number | string, index: number) => index > 0 && key < keys[index - 1]);
  });
  return { isStable: unstableNamespaces.length === 0, unstableNamespaces };
}

export interface SupersessionLink {
  readonly replacedId: string;
  readonly supersededById: string;
  readonly namespace: string;
  readonly recordedAt: string;
  readonly reason: string;
}

export function validateSupersessionContract(options: {
  readonly replacedIds?: readonly string[];
  readonly supersessionLedger?: readonly SupersessionLink[];
  readonly newItems?: readonly { id: string; text?: string }[];
  readonly historicalReleasedIds?: ReadonlySet<string>;
}): { valid: true } {
  const links = new Map((options.supersessionLedger ?? []).map((link) => [link.replacedId, link]));
  for (const replacedId of options.replacedIds ?? []) {
    const link = links.get(replacedId);
    if (!link || !link.supersededById || !link.reason?.trim()) {
      throw new Error(`SUPERSESSION_LINK_REQUIRED: ${replacedId}`);
    }
    if (link.supersededById === replacedId) throw new Error(`SUPERSESSION_LINK_INVALID: ${replacedId} cannot supersede itself`);
  }
  for (const item of options.newItems ?? []) if (options.historicalReleasedIds?.has(item.id)) {
    throw new Error(`ID_REUSE_FORBIDDEN: re-use of released ID ${item.id}`);
  }
  return { valid: true };
}
