import { DiscError, ErrorCode } from '@foresift/domain';
import type { DatabaseEngine } from '@foresift/persistence';

export interface CheapMonitorPopulationRider {
  readonly monitorId: string;
  readonly populationManifestId: string;
  readonly entryProvenanceId: string;
}

export interface PromotionPopulationRider extends CheapMonitorPopulationRider {
  readonly promotionDecisionId: string;
}

function nonempty(value: string, field: string): void {
  if (value.trim().length === 0) {
    throw new DiscError(
      'population rider identifiers must be non-empty',
      { field },
      ErrorCode.CONTRACT_INVARIANT_VIOLATED,
    );
  }
}

export function assertPromotionReplayHasRider(
  input: Partial<Pick<PromotionPopulationRider, 'populationManifestId' | 'entryProvenanceId'>>,
): asserts input is Pick<PromotionPopulationRider, 'populationManifestId' | 'entryProvenanceId'> {
  if (!input.populationManifestId || !input.entryProvenanceId) {
    throw new DiscError(
      'promotion replay requires a frozen population and entry-provenance rider',
      {},
      ErrorCode.DISC_POPULATION_RIDER_MISSING,
    );
  }
}

async function assertReferences(
  engine: DatabaseEngine,
  populationManifestId: string,
  entryProvenanceId: string,
): Promise<void> {
  const manifest = await engine.query<{ manifest_id: string }>(
    'SELECT manifest_id FROM disc.coverage_population_manifests WHERE manifest_id=$1',
    [populationManifestId],
  );
  if (manifest.rows.length === 0) {
    throw new DiscError(
      'population rider references an unknown manifest',
      { populationManifestId },
      ErrorCode.DISC_POPULATION_MANIFEST_MISSING,
    );
  }
  const provenance = await engine.query<{ entry_id: string }>(
    'SELECT entry_id FROM disc.universe_entry_provenance WHERE entry_id=$1',
    [entryProvenanceId],
  );
  if (provenance.rows.length === 0) {
    throw new DiscError(
      'population rider references unknown entry provenance',
      { entryProvenanceId },
      ErrorCode.DISC_ENTRY_PROVENANCE_MISSING,
    );
  }
}

export async function persistCheapMonitorPopulationRider(
  engine: DatabaseEngine,
  rider: CheapMonitorPopulationRider,
): Promise<CheapMonitorPopulationRider> {
  nonempty(rider.monitorId, 'monitorId');
  nonempty(rider.populationManifestId, 'populationManifestId');
  nonempty(rider.entryProvenanceId, 'entryProvenanceId');
  await assertReferences(engine, rider.populationManifestId, rider.entryProvenanceId);
  const monitor = await engine.query<{ monitor_id: string }>(
    'SELECT monitor_id FROM disc.cheap_monitor_rows WHERE monitor_id=$1',
    [rider.monitorId],
  );
  if (monitor.rows.length === 0) {
    throw new DiscError(
      'population rider references an unknown cheap-monitor row',
      { monitorId: rider.monitorId },
      ErrorCode.DISC_POPULATION_RIDER_MISSING,
    );
  }
  await engine.query(
    `INSERT INTO disc.cheap_monitor_population_riders (
       monitor_id,population_manifest_id,entry_provenance_id)
     VALUES ($1,$2,$3) ON CONFLICT (monitor_id) DO NOTHING`,
    [rider.monitorId, rider.populationManifestId, rider.entryProvenanceId],
  );
  return rider;
}

export async function persistPromotionPopulationRider(
  engine: DatabaseEngine,
  rider: PromotionPopulationRider,
): Promise<PromotionPopulationRider> {
  assertPromotionReplayHasRider(rider);
  nonempty(rider.promotionDecisionId, 'promotionDecisionId');
  nonempty(rider.monitorId, 'monitorId');
  await assertReferences(engine, rider.populationManifestId, rider.entryProvenanceId);
  const linked = await engine.query<{
    promotion_decision_id: string;
    population_manifest_id: string;
    entry_provenance_id: string;
  }>(
    `SELECT p.promotion_decision_id,r.population_manifest_id,r.entry_provenance_id
     FROM disc.promotion_decisions p
     JOIN disc.cheap_monitor_population_riders r ON r.monitor_id=$2
     WHERE p.promotion_decision_id=$1`,
    [rider.promotionDecisionId, rider.monitorId],
  );
  const row = linked.rows[0];
  if (
    row === undefined ||
    row.population_manifest_id !== rider.populationManifestId ||
    row.entry_provenance_id !== rider.entryProvenanceId
  ) {
    throw new DiscError(
      'promotion rider must match the candidate monitor rider',
      { promotionDecisionId: rider.promotionDecisionId, monitorId: rider.monitorId },
      ErrorCode.DISC_POPULATION_RIDER_MISSING,
    );
  }
  await engine.query(
    `INSERT INTO disc.promotion_population_riders (
       promotion_decision_id,population_manifest_id,entry_provenance_id,monitor_id)
     VALUES ($1,$2,$3,$4) ON CONFLICT (promotion_decision_id) DO NOTHING`,
    [
      rider.promotionDecisionId,
      rider.populationManifestId,
      rider.entryProvenanceId,
      rider.monitorId,
    ],
  );
  return rider;
}

export async function requirePromotionReplayRider(
  engine: DatabaseEngine,
  promotionDecisionId: string,
): Promise<PromotionPopulationRider> {
  const result = await engine.query<{
    promotion_decision_id: string;
    monitor_id: string;
    population_manifest_id: string;
    entry_provenance_id: string;
  }>(
    `SELECT promotion_decision_id,monitor_id,population_manifest_id,entry_provenance_id
     FROM disc.promotion_population_riders WHERE promotion_decision_id=$1`,
    [promotionDecisionId],
  );
  const row = result.rows[0];
  if (row === undefined) {
    throw new DiscError(
      'rider-less promotion replay is refused',
      { promotionDecisionId },
      ErrorCode.DISC_POPULATION_RIDER_MISSING,
    );
  }
  return {
    promotionDecisionId: row.promotion_decision_id,
    monitorId: row.monitor_id,
    populationManifestId: row.population_manifest_id,
    entryProvenanceId: row.entry_provenance_id,
  };
}

export class PopulationRiderStore {
  constructor(private readonly engine: DatabaseEngine) {}
  attachMonitor(rider: CheapMonitorPopulationRider): Promise<CheapMonitorPopulationRider> {
    return persistCheapMonitorPopulationRider(this.engine, rider);
  }
  attachPromotion(rider: PromotionPopulationRider): Promise<PromotionPopulationRider> {
    return persistPromotionPopulationRider(this.engine, rider);
  }
  requireForReplay(promotionDecisionId: string): Promise<PromotionPopulationRider> {
    return requirePromotionReplayRider(this.engine, promotionDecisionId);
  }
}

export const persistMonitorRider = persistCheapMonitorPopulationRider;
export const persistPromotionRider = persistPromotionPopulationRider;
