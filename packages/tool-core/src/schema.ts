/**
 * Structural schema binding (ADR-0013 context): tool-core CONSUMES validated
 * input/output schemas but does not depend on any specific schema library.
 * A bound schema is anything with Zod's `safeParse` shape — real Zod schemas
 * (from packages that declare the dependency) satisfy it structurally, and
 * test doubles implement it directly. Stages 3 and 15 refuse calls when no
 * schema is bound, so the loose contract never loosens validation itself.
 */
export interface SchemaIssue {
  readonly path: readonly PropertyKey[];
  readonly message: string;
}

export interface BoundSchemaParsedOk<T> {
  readonly success: true;
  readonly data: T;
}

export interface BoundSchemaParsedFail {
  readonly success: false;
  readonly error: { readonly issues: readonly SchemaIssue[] };
}

export type BoundSchemaParseResult<T> = BoundSchemaParsedOk<T> | BoundSchemaParsedFail;

export interface BoundSchema<T = unknown> {
  safeParse(data: unknown): BoundSchemaParseResult<T>;
}
