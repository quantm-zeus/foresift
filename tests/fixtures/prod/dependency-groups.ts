/**
 * Canonical dependency-group DAG fixtures (T033, FR-PROD-003, §40).
 *
 * Inert typed rows mirroring `prod.dependency_groups`: an acyclic G0→G7 chain
 * where every group depends only on earlier groups, and the pinned §40 law that
 * completion never activates opportunities.
 */
import type { DependencyGroupId } from '@foresift/domain';

export interface ProdDependencyGroupFixture {
  readonly groupId: DependencyGroupId;
  readonly dependsOn: readonly DependencyGroupId[];
  readonly status: 'OPEN' | 'IN_PROGRESS' | 'COMPLETE' | 'BLOCKED';
  readonly manifestRequirementCount: number;
  readonly activatesOpportunities: false;
}

/** The canonical §40 DAG: each group depends only on its immediate predecessor. */
export const PROD_DEPENDENCY_GROUP_DAG: readonly ProdDependencyGroupFixture[] = [
  {
    groupId: 'G0',
    dependsOn: [],
    status: 'COMPLETE',
    manifestRequirementCount: 12,
    activatesOpportunities: false,
  },
  {
    groupId: 'G1',
    dependsOn: ['G0'],
    status: 'COMPLETE',
    manifestRequirementCount: 12,
    activatesOpportunities: false,
  },
  {
    groupId: 'G2',
    dependsOn: ['G1'],
    status: 'IN_PROGRESS',
    manifestRequirementCount: 12,
    activatesOpportunities: false,
  },
  {
    groupId: 'G3',
    dependsOn: ['G2'],
    status: 'OPEN',
    manifestRequirementCount: 0,
    activatesOpportunities: false,
  },
  {
    groupId: 'G4',
    dependsOn: ['G3'],
    status: 'OPEN',
    manifestRequirementCount: 0,
    activatesOpportunities: false,
  },
  {
    groupId: 'G5',
    dependsOn: ['G4'],
    status: 'OPEN',
    manifestRequirementCount: 0,
    activatesOpportunities: false,
  },
  {
    groupId: 'G6',
    dependsOn: ['G5'],
    status: 'OPEN',
    manifestRequirementCount: 0,
    activatesOpportunities: false,
  },
  {
    groupId: 'G7',
    dependsOn: ['G6'],
    status: 'OPEN',
    manifestRequirementCount: 0,
    activatesOpportunities: false,
  },
];

/** An out-of-order edge (G1 depends on G4) the §40 law must refuse. */
export const PROD_OUT_OF_ORDER_DEPENDENCY_EDGE = {
  prerequisite: 'G4' as DependencyGroupId,
  dependent: 'G1' as DependencyGroupId,
} as const;

/** A self-edge the SQL/schema law must refuse. */
export const PROD_SELF_DEPENDENCY_EDGE = {
  prerequisite: 'G2' as DependencyGroupId,
  dependent: 'G2' as DependencyGroupId,
} as const;

export function prodDependencyGroup(groupId: DependencyGroupId): ProdDependencyGroupFixture {
  const found = PROD_DEPENDENCY_GROUP_DAG.find((row) => row.groupId === groupId);
  if (found === undefined) throw new Error(`no PROD dependency-group fixture for ${groupId}`);
  return found;
}
