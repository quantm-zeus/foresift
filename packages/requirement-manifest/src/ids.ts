/** Global normative-ID integrity and immutable supersession rules. @requirement FR-TRACE-002 */

type ManifestLike = {
  requirements?: { id: string; line?: number }[];
  acceptanceCriteria?: { id: string; line?: number }[];
  invariants?: { id: string; line?: number }[];
  adrs?: { id: string; line?: number }[];
};

const GRAMMARS = {
  requirement: /^FR-[A-Z0-9]+-[0-9]{3,}$/,
  acceptanceCriterion: /^AC-[0-9]{3,}$/,
  invariant: /^INV-[0-9]{3,}$/,
  adr: /^ADR-[0-9]{4}$/,
} as const;

export function validateIdGrammar(id: string): {
  valid: boolean;
  namespace?: keyof typeof GRAMMARS;
  error?: string;
} {
  for (const [namespace, grammar] of Object.entries(GRAMMARS)) {
    if (grammar.test(id)) return { valid: true, namespace: namespace as keyof typeof GRAMMARS };
  }
  return { valid: false, error: `ID_GRAMMAR_INVALID: ${id}` };
}

function unionIds(manifest: ManifestLike): string[] {
  return [
    ...(manifest.requirements ?? []),
    ...(manifest.acceptanceCriteria ?? []),
    ...(manifest.invariants ?? []),
    ...(manifest.adrs ?? []),
  ].map((item) => item.id);
}

export function checkGlobalIdUniqueness(manifest: ManifestLike): {
  isUnique: boolean;
  duplicates: string[];
  totalIds: number;
} {
  const ids = unionIds(manifest);
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

/** Document order is immutable: each namespace must retain monotonically increasing anchors. */
export function checkStableOrdering(manifest: ManifestLike): {
  isStable: boolean;
  unstableNamespaces: string[];
} {
  const unstableNamespaces: string[] = [];
  for (const [namespace, items] of Object.entries({
    requirements: manifest.requirements ?? [],
    acceptanceCriteria: manifest.acceptanceCriteria ?? [],
    invariants: manifest.invariants ?? [],
    adrs: manifest.adrs ?? [],
  })) {
    const lines = items
      .map((item) => item.line)
      .filter((line): line is number => line !== undefined);
    if (lines.some((line, index) => index > 0 && line <= lines[index - 1])) {
      unstableNamespaces.push(namespace);
    }
  }
  return { isStable: unstableNamespaces.length === 0, unstableNamespaces };
}

type Supersession = { replacedId: string; supersededById: string };

export function validateSupersessionContract(options: {
  replacedIds?: readonly string[];
  supersessionLedger?: readonly Supersession[];
  newItems?: readonly { id: string; text?: string }[];
  historicalReleasedIds?: ReadonlySet<string>;
}): { valid: true } {
  const linked = new Set((options.supersessionLedger ?? []).map((entry) => entry.replacedId));
  const missing = (options.replacedIds ?? []).filter((id) => !linked.has(id));
  if (missing.length) {
    throw new Error(`SUPERSESSION_LINK_REQUIRED: ${missing.join(', ')}`);
  }
  const reused = (options.newItems ?? []).filter((item) =>
    options.historicalReleasedIds?.has(item.id),
  );
  if (reused.length)
    throw new Error(`ID_REUSE_FORBIDDEN: ${reused.map((item) => item.id).join(', ')}`);
  return { valid: true };
}
