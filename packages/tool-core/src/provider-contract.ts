/**
 * Provider operation dispatch contracts (FR-CORE-002; PRD §16.2 stage 14).
 * Adapters are INJECTED read-only operation collectors bound by the security
 * perimeter; tool-core never imports a vendor SDK (plan constitution IX).
 *
 * Validation runs through `SchemaLike` — the structural shape every
 * authoritative Zod schema (ADR-0013) satisfies — so composition roots pass
 * shared-schemas objects without this package depending on the validator.
 */
import type { FreshnessFieldFamily } from '@foresift/domain';
import type { EgressPlane } from '@foresift/security';

/** Minimal authoritative-validator shape; `z.ZodType` satisfies it. */
export interface SchemaLike {
  parse(input: unknown): unknown;
}

/** One allowlisted read-only call into a provider collector adapter. */
export interface ProviderCallRequest {
  readonly provider: string;
  readonly operation: string;
  readonly operationVersion: string;
  /** Stage-3 canonicalized tool arguments. */
  readonly canonicalInput: unknown;
  /** Egress-pinned addresses the caller MUST connect to (perimeter control). */
  readonly pinnedAddresses: readonly string[];
  readonly deadlineMs: number;
  readonly byteLimit: number;
}

/** Raw adapter response BEFORE any trust is extended to its contents. */
export interface ProviderRawResponse {
  /** Declared content type, validated against the route admission list. */
  readonly contentType: string;
  /** Decoded body text (JSON expected); size-capped by the byte limit. */
  readonly bodyText: string;
}

/**
 * An injected read-only operation adapter. Implementations live OUTSIDE
 * packages/tool-core/** (collector/provider packages); the engine wraps every
 * call with egress authorization, deadline, and byte-limit enforcement.
 */
export interface ReadOnlyOperationAdapter {
  readonly provider: string;
  readonly operations: readonly string[];
  call(request: ProviderCallRequest): Promise<ProviderRawResponse>;
}

/** Normalized observation produced at stage 16 (identity/units/times/quality). */
export interface NormalizedObservation {
  readonly evidenceId: string;
  readonly provider: string;
  readonly observedAt: string;
  readonly availableAt: string;
  readonly fetchedAt: string;
  /** Field path → normalized value (units canonicalized by the normalizer). */
  readonly fields: Readonly<Record<string, unknown>>;
  readonly qualityCodes: readonly string[];
  /** Source lineage reference carried through to envelope provenance. */
  readonly lineageRef?: string | undefined;
}

/** Stage-16/17 output validated before persistence begins. */
export interface NormalizedResult {
  readonly observations: readonly NormalizedObservation[];
  /** Provider disagreements preserved verbatim — never silently replaced. */
  readonly conflicts: readonly ProviderConflictCandidate[];
  readonly partial: boolean;
  /** Capabilities the response explicitly marks missing (degradation truth). */
  readonly missingCapabilities: readonly string[];
  readonly nextCursor?: string | undefined;
  readonly resourceUris?: readonly string[] | undefined;
}

/** A disagreement detected between two sources over one field path. */
export interface ProviderConflictCandidate {
  readonly providers: readonly [string, string] | readonly string[];
  readonly fieldPath: string;
  readonly values: readonly unknown[];
}

/** How raw payloads become normalized observations (stage 16). */
export type PayloadNormalizer = (
  raw: unknown,
  context: { readonly provider: string; readonly fetchedAt: string; readonly runId: string },
) => NormalizedResult;

/** Composition-time routing of one registered tool to one provider operation. */
export interface OperationRoute {
  readonly provider: string;
  readonly operation: string;
  readonly operationVersion: string;
  readonly chain: string;
  readonly freshnessFamily: FreshnessFieldFamily;
  /** When false, stage 20 never writes this tool's results to the cache. */
  readonly cachingPermitted: boolean;
  readonly fieldProjection: readonly string[];
  /** Narrower projection used when backpressure downgrades depth. */
  readonly downgradedFieldProjection?: readonly string[] | undefined;
  /** Egress target authorized immediately before the adapter call. */
  readonly endpointUrl: string;
  readonly egressPlane: EgressPlane;
  readonly deadlineMs: number;
  readonly byteLimit: number;
  /** Authoritative input schema (stage 3); defaults to the definition's JSON shape. */
  readonly inputSchema?: SchemaLike | undefined;
  /** Raw payload schema (stage 15), when the operation declares one. */
  readonly rawSchema?: SchemaLike | undefined;
  /** Custom normalizer; defaults to the §16.2 generic normalizer. */
  readonly normalizer?: PayloadNormalizer | undefined;
  readonly adapter: ReadOnlyOperationAdapter;
}
