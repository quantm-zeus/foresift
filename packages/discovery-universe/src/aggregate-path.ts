import type { OperationCostDeclaration } from '@foresift/shared-schemas';
export const DEFAULT_DISCOVERY_PATH = 'FREE_AGGREGATE' as const;
export const DISCOVERY_COST_MODE = 'STRICT_FREE' as const;
export function admitAggregateDiscovery(declaration: OperationCostDeclaration): void {
  if (
    !declaration.allowedInStrictFree ||
    !['FREE_UNMETERED', 'FREE_QUOTA'].includes(declaration.costClass) ||
    declaration.paidFallbackAllowed === true
  )
    throw new Error('STRICT_FREE_DISCOVERY_REFUSED');
}
export interface AggregateDiscoveryPort {
  discover(operation: OperationCostDeclaration, input: unknown): Promise<readonly unknown[]>;
}
export async function discoverBroadUniverse(
  port: AggregateDiscoveryPort,
  declaration: OperationCostDeclaration,
  input: unknown,
): Promise<readonly unknown[]> {
  admitAggregateDiscovery(declaration);
  return port.discover(declaration, input);
}
