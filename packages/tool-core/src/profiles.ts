/**
 * Narrow actor/tool profiles (FR-CORE-004; PRD §16.9). The eight default
 * profiles each expose a STRICT SUBSET of the catalog — the headless agent
 * never receives the entire catalog — and provider-specific atomic tools are
 * visible only to adapter-test, admin-diagnostic, and explicitly scoped
 * expert MCP profiles. Domain tool names are the §16.9 examples, seeded as
 * fixture definitions for tests; `tests/fixtures/core/tool-catalog.json`
 * mirrors this table and a parity test keeps both honest.
 */
import { ForesiftError, type ToolProfileId } from '@foresift/domain';

/** Access classes beyond the eight standard profiles. */
export const PROFILE_CLASSES = [
  'STANDARD',
  'ADAPTER_TEST',
  'ADMIN_DIAGNOSTIC',
  'EXPERT_SCOPED',
] as const;
export type ProfileClass = (typeof PROFILE_CLASSES)[number];

/** Only these classes may bind atomic (provider-specific) tools. */
const ATOMIC_ADMITTING_CLASSES: readonly ProfileClass[] = [
  'ADAPTER_TEST',
  'ADMIN_DIAGNOSTIC',
  'EXPERT_SCOPED',
];

export function admitsAtomicTools(klass: ProfileClass): boolean {
  return ATOMIC_ADMITTING_CLASSES.includes(klass);
}

/**
 * The §16.9 domain tool catalog (verbatim example names). Fixture data in
 * `tests/fixtures/core/tool-catalog.json` mirrors this list; the registry
 * spec's parity test pins them equal.
 */
export const DOMAIN_TOOL_CATALOG: readonly string[] = [
  'discover_candidates',
  'get_asset_identity',
  'get_market_evidence_pack',
  'get_security_evidence_pack',
  'get_holder_distribution',
  'get_wallet_cluster_evidence',
  'get_tradability_assessment',
  'get_candidate_delta',
  'get_thesis_status',
  'compare_candidates',
];

/**
 * Provider-specific atomic operations — raw adapter probes and diagnostics.
 * Never bound to a STANDARD profile under any configuration.
 */
export const ATOMIC_TOOL_CATALOG: readonly string[] = [
  'provider_adapter_probe',
  'raw_ledger_diagnostic',
];

/** Per-profile admission of the domain catalog. Every entry is a strict subset. */
export const STANDARD_PROFILE_TOOL_SETS: Readonly<Record<ToolProfileId, readonly string[]>> = {
  discovery: [
    'discover_candidates',
    'get_asset_identity',
    'get_candidate_delta',
    'compare_candidates',
  ],
  'market-research': [
    'get_asset_identity',
    'get_market_evidence_pack',
    'get_tradability_assessment',
    'get_candidate_delta',
    'compare_candidates',
  ],
  'security-research': ['get_security_evidence_pack', 'get_asset_identity'],
  'holder-wallet': [
    'get_holder_distribution',
    'get_wallet_cluster_evidence',
    'get_tradability_assessment',
  ],
  'social-research': ['get_candidate_delta', 'get_thesis_status'],
  'macro-context': ['discover_candidates', 'get_market_evidence_pack'],
  'run-investigation': [
    // Headless investigation sees nine of ten — never the entire catalog.
    'discover_candidates',
    'get_asset_identity',
    'get_market_evidence_pack',
    'get_security_evidence_pack',
    'get_holder_distribution',
    'get_wallet_cluster_evidence',
    'get_tradability_assessment',
    'get_candidate_delta',
    'get_thesis_status',
  ],
  'admin-read': [
    'discover_candidates',
    'get_asset_identity',
    'get_market_evidence_pack',
    'get_security_evidence_pack',
    'get_holder_distribution',
    'get_wallet_cluster_evidence',
    'get_tradability_assessment',
    'get_candidate_delta',
    'get_thesis_status',
  ],
};

export interface ProfileBinding {
  readonly id: ToolProfileId;
  readonly klass: ProfileClass;
  /** Explicitly scoped expert profiles may name additional atomic tools. */
  readonly extraAtomicTools?: readonly string[];
}

/** The eight §16.9 default bindings — all STANDARD, none atomic-admitting. */
export const DEFAULT_PROFILE_BINDINGS: readonly ProfileBinding[] = (
  Object.keys(STANDARD_PROFILE_TOOL_SETS) as ToolProfileId[]
).map((id) => ({ id, klass: 'STANDARD' as const }));

/** Fail-closed class resolution for bindings built from untyped input. */
export function profileClass(value: string): ProfileClass {
  if ((PROFILE_CLASSES as readonly string[]).includes(value)) return value as ProfileClass;
  throw new ForesiftError('TOOL_PROFILE_UNKNOWN', `unknown profile class ${value}`, {
    value,
  });
}

/**
 * Tools visible to a binding: its standard set plus, ONLY for
 * atomic-admitting classes, the requested atomic tools. A STANDARD profile
 * asking for atomic access is an authorization refusal — never silently
 * dropped — so misconfiguration cannot masquerade as an empty toolset.
 */
export function visibleToolsFor(binding: ProfileBinding): readonly string[] {
  const base = STANDARD_PROFILE_TOOL_SETS[binding.id] ?? [];
  if (binding.extraAtomicTools === undefined || binding.extraAtomicTools.length === 0) {
    return [...base];
  }
  if (!admitsAtomicTools(binding.klass)) {
    throw new ForesiftError(
      'AUTHORIZATION_REFUSED',
      `profile ${binding.id} is ${binding.klass} and cannot bind provider-specific atomic tools`,
      { profileId: binding.id },
    );
  }
  return [...base, ...binding.extraAtomicTools];
}

/**
 * Exclusion rule over registered metadata: a STANDARD profile can never see
 * an atomic tool even when the tool lists that profile (defense in depth —
 * registration admits the metadata, visibility still refuses).
 */
export function isVisibleToProfile(
  tool: { readonly name: string; readonly atomic?: boolean },
  binding: ProfileBinding,
): boolean {
  if (tool.atomic === true) return admitsAtomicTools(binding.klass);
  return (STANDARD_PROFILE_TOOL_SETS[binding.id] ?? []).includes(tool.name);
}
