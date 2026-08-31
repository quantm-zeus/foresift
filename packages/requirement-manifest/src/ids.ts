import { RequirementManifestError, RequirementManifestErrorCode } from './errors.ts';
import type { RequirementManifest } from './types.ts';

const ID_PATTERNS: readonly [string, RegExp][] = [
  ['FR', /^FR-[A-Z0-9]+-\d{3,}$/],
  ['AC', /^AC-\d{3,}$/],
  ['INV', /^INV-\d{3,}$/],
  ['ADR', /^ADR-\d{4}$/],
];
export function validateIdGrammar(id: string): { valid: boolean; namespace?: string } {
  const found = ID_PATTERNS.find(([, pattern]) => pattern.test(id));
  return found ? { valid: true, namespace: found[0] } : { valid: false };
}
export function checkGlobalIdUniqueness(
  manifest: Pick<
    RequirementManifest,
    'requirements' | 'acceptanceCriteria' | 'invariants' | 'adrs'
  >,
) {
  const ids = [
    ...manifest.requirements,
    ...manifest.acceptanceCriteria,
    ...manifest.invariants,
    ...manifest.adrs,
  ].map((item) => item.id);
  const seen = new Set<string>();
  const duplicates = new Set<string>();
  for (const id of ids) {
    if (seen.has(id)) duplicates.add(id);
    seen.add(id);
  }
  return {
    isUnique: duplicates.size === 0,
    duplicates: [...duplicates].sort(),
    totalIds: ids.length,
  };
}
export function checkStableOrdering(
  manifest: Pick<
    RequirementManifest,
    'requirements' | 'acceptanceCriteria' | 'invariants' | 'adrs'
  >,
) {
  const unstableNamespaces: string[] = [];
  for (const key of ['requirements', 'acceptanceCriteria', 'invariants', 'adrs'] as const) {
    const lines = manifest[key].map((item) => item.line ?? 0);
    if (lines.some((line, index) => index > 0 && line <= lines[index - 1]!))
      unstableNamespaces.push(key);
  }
  return { isStable: unstableNamespaces.length === 0, unstableNamespaces };
}
export function validateSupersessionContract(input: {
  replacedIds?: readonly string[];
  supersessionLedger?: readonly {
    readonly replacedId?: string;
    readonly replaced_id?: string;
  }[];
  newItems?: readonly { id: string; text?: string }[];
  historicalReleasedIds?: ReadonlySet<string>;
}) {
  const ledgerIds = new Set(
    (input.supersessionLedger ?? []).map((row) => row.replacedId ?? row.replaced_id),
  );
  for (const id of input.replacedIds ?? [])
    if (!ledgerIds.has(id))
      throw new RequirementManifestError(
        RequirementManifestErrorCode.SUPERSESSION_LINK_REQUIRED,
        `supersession link required for ${id}`,
        { id },
      );
  for (const item of input.newItems ?? [])
    if (input.historicalReleasedIds?.has(item.id))
      throw new RequirementManifestError(
        RequirementManifestErrorCode.ID_REUSE_FORBIDDEN,
        `re-use of released id ${item.id} is forbidden`,
        { id: item.id },
      );
  return { valid: true };
}
