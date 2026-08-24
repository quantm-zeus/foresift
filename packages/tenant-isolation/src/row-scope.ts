/**
 * Fail-closed row scoping (FR-SEC-009; T130, AC-275). Every query against a
 * tenant-scoped table MUST carry the tenant predicate. Unscoped queries are
 * refused whenever isolation mode is active (anything but PUBLIC), and even
 * PUBLIC mode requires the caller to opt out EXPLICITLY — never silently.
 */
import type { TenantContext } from '@foresift/shared-schemas';
import { SecErrorCode, TenantIsolationError } from '@foresift/security';
import { isolationActive } from './tenant-context.ts';

export interface TenantPredicate {
  /** SQL fragment referencing the bound tenant parameter. */
  readonly sql: string;
  /** Append `$n` parameters for this predicate onto an existing array. */
  bind(params: unknown[]): unknown[];
  /** The parameter index this predicate's value occupies. */
  readonly paramIndex: number;
}

export interface RowScopeOptions {
  /** SQL identifier quoting style override (defaults to double quotes). */
  readonly column?: string;
}

/**
 * Per-context row scoping helper. One instance per request context;
 * every scoped query composes its WHERE clause through `tenantPredicate`.
 */
export class RowScope {
  private readonly context: TenantContext;
  private readonly column: string;

  constructor(context: TenantContext, options: RowScopeOptions = {}) {
    this.context = context;
    this.column = options.column ?? 'tenant_id';
  }

  /**
   * Compose `"<column> = $n"`. `paramIndex` is 1-based to match PostgreSQL
   * placeholder numbering; callers pass their current parameter count.
   */
  tenantPredicate(existingParamCount = 0): TenantPredicate {
    const paramIndex = existingParamCount + 1;
    const quoted = `"${this.column.replaceAll('"', '')}"`;
    return {
      sql: `${quoted} = $${paramIndex}`,
      paramIndex,
      bind: (params) => {
        params.push(this.context.tenantId);
        return params;
      },
    };
  }

  /**
   * Build a SELECT against a tenant-scoped table. Refuses UNLESS the
   * predicate is present; `allowUnscoped: true` is honored ONLY when
   * isolation mode is not active (PUBLIC) and still records the choice in
   * the returned descriptor so call sites stay auditable.
   */
  scopedSelect(
    table: string,
    where: readonly string[] = [],
    options: { allowUnscoped?: boolean | undefined; existingParamCount?: number | undefined } = {},
  ): { sql: string; scoped: boolean } {
    const allowUnscoped = options.allowUnscoped === true;
    if (allowUnscoped && isolationActive(this.context)) {
      throw new TenantIsolationError(
        'unscoped query refused: isolation mode is active',
        { mode: this.context.mode },
        SecErrorCode.SEC_TENANT_QUERY_UNSCOPED_REFUSED,
      );
    }
    if (!isolationActive(this.context) && allowUnscoped) {
      const sql = `SELECT * FROM ${table}${
        where.length > 0 ? ` WHERE ${where.map((clause) => `(${clause})`).join(' AND ')}` : ''
      }`;
      return { sql, scoped: false };
    }
    const predicate = this.tenantPredicate(options.existingParamCount ?? 0);
    // Each caller clause is parenthesized before the AND join (L8): a clause
    // containing a top-level OR must never flip precedence past the tenant
    // predicate.
    const clauses = [predicate.sql, ...where.map((clause) => `(${clause})`)];
    return {
      sql: `SELECT * FROM ${table} WHERE ${clauses.join(' AND ')}`,
      scoped: true,
    };
  }

  /**
   * Row/artifact ownership assertion: the fetched row must exist AND belong
   * to this tenant. NULL/undefined owner columns refuse (fail-closed).
   */
  assertRowOwnership(
    row: { readonly tenantId?: string | null | undefined } | undefined | null,
  ): void {
    if (row === undefined || row === null) {
      throw new TenantIsolationError(
        'row not found within tenant scope',
        {},
        SecErrorCode.SEC_TENANT_ROW_OWNERSHIP_REFUSED,
      );
    }
    if (
      typeof row.tenantId !== 'string' ||
      row.tenantId === '' ||
      row.tenantId !== this.context.tenantId
    ) {
      throw new TenantIsolationError(
        'cross-tenant row access refused',
        {},
        SecErrorCode.SEC_TENANT_ROW_OWNERSHIP_REFUSED,
      );
    }
  }
}
