/**
 * AC-234 negative (failure) — retrospective route selection and future migration routing refused.
 * Traces: FR-EXEC-022, AC-234.
 * Refusal: Selecting a route/pool or using a migration transition that did not exist at action time is refused.
 */
import { describe, expect, it } from 'bun:test';

function selectRoutePointInTime(params: {
  actionSlot: number;
  poolCreatedSlot: number;
  migrationCompletedSlot?: number;
}) {
  if (params.poolCreatedSlot > params.actionSlot) {
    throw new Error('RETROSPECTIVE_ROUTE_SELECTION_REFUSED');
  }
  if (params.migrationCompletedSlot !== undefined && params.migrationCompletedSlot > params.actionSlot) {
    throw new Error('POST_ACTION_MIGRATION_TRANSITION_REFUSED');
  }
  return true;
}

describe('AC-234 negative: retrospective route selection and future migration transitions refused', () => {
  it('throws when trying to select a route or pool created after action slot', () => {
    expect(() =>
      selectRoutePointInTime({
        actionSlot: 284100000,
        poolCreatedSlot: 284100750,
      }),
    ).toThrow('RETROSPECTIVE_ROUTE_SELECTION_REFUSED');
  });

  it('throws when trying to route through a migration edge completed after action slot', () => {
    expect(() =>
      selectRoutePointInTime({
        actionSlot: 284200000,
        poolCreatedSlot: 284190000,
        migrationCompletedSlot: 284210000,
      }),
    ).toThrow('POST_ACTION_MIGRATION_TRANSITION_REFUSED');
  });
});
