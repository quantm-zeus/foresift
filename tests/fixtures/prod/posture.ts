/**
 * Canonical posture fixtures (T033, FR-PROD-004, AC-153; PRD §69.6/§34.3).
 *
 * Inert typed critical-dependency, SLA-register, and best-effort-declaration
 * data: fully SLA-covered and degraded registers, plus compliant and weakening
 * declarations.
 */
import {
  ALL_DEPLOYMENT_RELAXABLE_DIMENSIONS,
  ALL_PROTECTED_DIMENSIONS,
  type DeploymentRelaxableDimension,
  type ProtectedDimension,
} from '@foresift/domain';
import type { PostureWeakeningDeclaration } from '@foresift/release-conformance';

export interface ProdCriticalDependencyFixture {
  readonly dependencyId: string;
  readonly kind: 'PROVIDER' | 'SCHEDULER' | 'OBJECT_STORE' | 'DATABASE' | 'MCP_CLIENT' | 'OTHER';
  readonly owner: string;
  readonly critical: boolean;
}

export interface ProdSlaRegisterFixture {
  readonly slaId: string;
  readonly dependencyId: string;
  readonly applicable: boolean;
  readonly slaRef: string | null;
  readonly verifiedAt: string;
  readonly expiresAt: string | null;
}

export const PROD_CRITICAL_DEPENDENCIES: readonly ProdCriticalDependencyFixture[] = [
  {
    dependencyId: 'dep-provider-primary',
    kind: 'PROVIDER',
    owner: 'data-platform',
    critical: true,
  },
  { dependencyId: 'dep-scheduler-primary', kind: 'SCHEDULER', owner: 'runtime', critical: true },
  { dependencyId: 'dep-object-store', kind: 'OBJECT_STORE', owner: 'platform', critical: true },
  { dependencyId: 'dep-database', kind: 'DATABASE', owner: 'platform', critical: true },
  { dependencyId: 'dep-mcp-client', kind: 'MCP_CLIENT', owner: 'integrations', critical: true },
];

const VERIFIED_AT = '2026-01-01T00:00:00Z';
const EXPIRES_AT = '2027-01-01T00:00:00Z';
const EXPIRED_AT = '2026-02-01T00:00:00Z';

/** Every critical dependency carries an applicable, unexpired SLA. */
export const PROD_SLA_REGISTER_COMPLIANT: readonly ProdSlaRegisterFixture[] =
  PROD_CRITICAL_DEPENDENCIES.map((dependency) => ({
    slaId: `sla-${dependency.dependencyId}`,
    dependencyId: dependency.dependencyId,
    applicable: true,
    slaRef: `sla://${dependency.dependencyId}/v1`,
    verifiedAt: VERIFIED_AT,
    expiresAt: EXPIRES_AT,
  }));

/** The MCP-client dependency has NO applicable SLA — best-effort posture. */
export const PROD_SLA_REGISTER_MISSING: readonly ProdSlaRegisterFixture[] =
  PROD_SLA_REGISTER_COMPLIANT.map((sla) =>
    sla.dependencyId === 'dep-mcp-client'
      ? { ...sla, applicable: false, slaRef: null, expiresAt: null }
      : sla,
  );

/** The MCP-client SLA was verified but has already expired. */
export const PROD_SLA_REGISTER_EXPIRED: readonly ProdSlaRegisterFixture[] =
  PROD_SLA_REGISTER_COMPLIANT.map((sla) =>
    sla.dependencyId === 'dep-mcp-client' ? { ...sla, expiresAt: EXPIRED_AT } : sla,
  );

const ALL_RELAXABLE: readonly DeploymentRelaxableDimension[] = ALL_DEPLOYMENT_RELAXABLE_DIMENSIONS;
const ALL_PROTECTED: readonly ProtectedDimension[] = ALL_PROTECTED_DIMENSIONS;

/** A compliant free-tier declaration: relaxes only §69.6 relaxable dimensions. */
export const PROD_BEST_EFFORT_COMPLIANT: PostureWeakeningDeclaration = {
  declarationId: 'decl-free-tier-compliant',
  posture: 'FREE_TIER_BEST_EFFORT',
  weakenedDimensions: ALL_RELAXABLE,
  protectedDimensions: ALL_PROTECTED,
};

/** An SLA-backed declaration that weakens nothing. */
export const PROD_SLA_BACKED_COMPLIANT: PostureWeakeningDeclaration = {
  declarationId: 'decl-sla-backed-compliant',
  posture: 'SLA_BACKED',
  weakenedDimensions: [],
  protectedDimensions: ALL_PROTECTED,
};

/** A declaration that weakens the protected audit dimension. */
export const PROD_BEST_EFFORT_WEAKENING: PostureWeakeningDeclaration = {
  declarationId: 'decl-free-tier-weakening',
  posture: 'FREE_TIER_BEST_EFFORT',
  weakenedDimensions: ['freshness', 'audit'],
  protectedDimensions: ALL_PROTECTED,
};

/** An SLA-backed posture that attempts to weaken freshness. */
export const PROD_SLA_BACKED_WEAKENING: PostureWeakeningDeclaration = {
  declarationId: 'decl-sla-backed-weakening',
  posture: 'SLA_BACKED',
  weakenedDimensions: ['freshness'],
  protectedDimensions: ALL_PROTECTED,
};

/** A declaration that omits the protected security dimension. */
export const PROD_BEST_EFFORT_OMITS_PROTECTED: PostureWeakeningDeclaration = {
  declarationId: 'decl-free-tier-omits-protected',
  posture: 'FREE_TIER_BEST_EFFORT',
  weakenedDimensions: ['freshness'],
  protectedDimensions: ALL_PROTECTED.filter((dimension) => dimension !== 'security'),
};

export const PROD_POSTURE_DECLARATIONS: readonly PostureWeakeningDeclaration[] = [
  PROD_BEST_EFFORT_COMPLIANT,
  PROD_SLA_BACKED_COMPLIANT,
  PROD_BEST_EFFORT_WEAKENING,
  PROD_SLA_BACKED_WEAKENING,
  PROD_BEST_EFFORT_OMITS_PROTECTED,
];

/** The protected set a compliant declaration must assert in full. */
export const PROD_PROTECTED_DIMENSIONS: readonly ProtectedDimension[] = ALL_PROTECTED;
export const PROD_RELAXABLE_DIMENSIONS: readonly DeploymentRelaxableDimension[] = ALL_RELAXABLE;
