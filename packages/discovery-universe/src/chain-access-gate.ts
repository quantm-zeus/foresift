import { DiscError, ErrorCode } from '@foresift/domain';
import type { DatabaseEngine } from '@foresift/persistence';
import {
  ChainAccessDeclarationSchema,
  type ChainAccessDeclaration,
} from '@foresift/shared-schemas';

export interface ChainAccessOperation {
  readonly runId: string;
  readonly declarationId: string;
  readonly declarationVersion: number;
  readonly purpose: ChainAccessDeclaration['purpose'];
  readonly chainId: string;
  readonly programIds: readonly string[];
  readonly candidates: number;
  readonly startSlot: number;
  readonly endSlot: number;
  readonly calls: number;
  readonly windowSeconds: number;
}

export interface ChainAccessAdmission {
  readonly admitted: true;
  readonly runId: string;
  readonly declarationId: string;
  readonly declarationVersion: number;
  readonly paidFallbackAllowed: false;
  readonly protectedReserveConsumptionAllowed: false;
}

export interface ChainAccessConsumption {
  readonly consumptionId: string;
  readonly operation: ChainAccessOperation;
  readonly consumedAt: string;
  readonly slotsScanned: number;
  readonly callsMade: number;
  readonly candidatesTouched: number;
  readonly forecastSlots?: number;
  readonly forecastCalls?: number;
  readonly forecastCandidates?: number;
}

export interface ChainAccessIncident {
  readonly incidentId: string;
  readonly reason: 'FORECAST_TOLERANCE_EXCEEDED';
  readonly effectiveMaxSlotsPerRun: number;
  readonly effectiveMaxCallsPerDay: number;
  readonly effectiveMaxCandidates: number;
  readonly paidOverageConsumed: false;
  readonly protectedReserveConsumed: false;
}

function refuse(message: string, detail: Readonly<Record<string, string | number>> = {}): never {
  throw new DiscError(message, detail, ErrorCode.DISC_CLAIM_LANGUAGE_REFUSED);
}

function natural(value: number, field: string): void {
  if (!Number.isSafeInteger(value) || value < 0)
    refuse('chain access bound is invalid', { field, value });
}

export function admitChainAccessDeclaration(input: unknown): ChainAccessDeclaration {
  const parsed = ChainAccessDeclarationSchema.safeParse(input);
  if (!parsed.success) {
    throw new DiscError(
      'chain access declaration is invalid or could permit paid/reserve ingestion',
      {},
      ErrorCode.DISC_CHAIN_ACCESS_PURPOSE_UNKNOWN,
    );
  }
  return parsed.data;
}

/** This function must run before an adapter receives permission to make a network call. */
export function admitChainAccessOperation(
  declarationInput: ChainAccessDeclaration,
  operation: ChainAccessOperation,
): ChainAccessAdmission {
  const declaration = admitChainAccessDeclaration(declarationInput);
  if (
    operation.declarationId !== declaration.declarationId ||
    operation.declarationVersion !== declaration.version
  ) {
    refuse('run did not declare the exact chain-access declaration version');
  }
  if (operation.purpose !== declaration.purpose || operation.chainId !== declaration.chainId) {
    refuse('chain-access operation falls outside declared purpose or chain');
  }
  if (
    operation.programIds.length === 0 ||
    operation.programIds.some((id) => !declaration.programIds.includes(id))
  ) {
    refuse('chain-access operation includes an undeclared program');
  }
  natural(operation.candidates, 'candidates');
  natural(operation.startSlot, 'startSlot');
  natural(operation.endSlot, 'endSlot');
  natural(operation.calls, 'calls');
  natural(operation.windowSeconds, 'windowSeconds');
  const slots = operation.endSlot - operation.startSlot + 1;
  if (
    operation.endSlot < operation.startSlot ||
    operation.candidates > declaration.maxCandidates ||
    slots > declaration.maxSlotsPerRun ||
    operation.calls > declaration.maxCallsPerDay ||
    operation.windowSeconds > declaration.maxWindowSeconds
  ) {
    refuse('chain-access operation exceeds its declared bound', { slots });
  }
  return {
    admitted: true,
    runId: operation.runId,
    declarationId: declaration.declarationId,
    declarationVersion: declaration.version,
    paidFallbackAllowed: false,
    protectedReserveConsumptionAllowed: false,
  };
}

function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, child]) => `${JSON.stringify(key)}:${stable(child)}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

function declarationFromRow(row: Record<string, unknown>): ChainAccessDeclaration {
  return admitChainAccessDeclaration({
    declarationId: row.declaration_id,
    version: row.version,
    purpose: row.purpose,
    chainId: row.chain_id,
    programIds: row.program_ids,
    maxCandidates: Number(row.max_candidates),
    maxSlotsPerRun: Number(row.max_slots_per_run),
    maxCallsPerDay: Number(row.max_calls_per_day),
    maxWindowSeconds: Number(row.max_window_seconds),
    costClass: row.cost_class,
    paidFallbackAllowed: row.paid_fallback_allowed,
    protectedReserveCompatible: row.protected_reserve_compatible,
    tolerancePercent: row.tolerance_percent,
  });
}

export class ChainAccessGate {
  constructor(private readonly engine: DatabaseEngine) {}

  async register(input: unknown): Promise<ChainAccessDeclaration> {
    const declaration = admitChainAccessDeclaration(input);
    return this.engine.transaction(async (tx) => {
      const same = await tx.query<Record<string, unknown>>(
        'SELECT * FROM disc.chain_access_declarations WHERE declaration_id=$1 AND version=$2',
        [declaration.declarationId, declaration.version],
      );
      if (same.rows[0] !== undefined) {
        const stored = declarationFromRow(same.rows[0]);
        if (stable(stored) !== stable(declaration))
          refuse('chain-access bounds cannot change in place');
        return stored;
      }
      const latest = await tx.query<{ version: number }>(
        `SELECT version FROM disc.chain_access_declarations
         WHERE declaration_id=$1 ORDER BY version DESC LIMIT 1`,
        [declaration.declarationId],
      );
      if (latest.rows[0] !== undefined && declaration.version <= latest.rows[0].version) {
        refuse('changed chain-access bounds require a new advancing declaration version');
      }
      await tx.query(
        `INSERT INTO disc.chain_access_declarations (
           declaration_id,version,purpose,chain_id,program_ids,max_candidates,max_slots_per_run,
           max_calls_per_day,max_window_seconds,cost_class,paid_fallback_allowed,
           protected_reserve_compatible,tolerance_percent)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
        [
          declaration.declarationId,
          declaration.version,
          declaration.purpose,
          declaration.chainId,
          [...declaration.programIds],
          declaration.maxCandidates,
          declaration.maxSlotsPerRun,
          declaration.maxCallsPerDay,
          declaration.maxWindowSeconds,
          declaration.costClass,
          false,
          true,
          declaration.tolerancePercent,
        ],
      );
      return declaration;
    });
  }

  async admit(operation: ChainAccessOperation): Promise<ChainAccessAdmission> {
    const declaration = await this.loadEffective(
      operation.declarationId,
      operation.declarationVersion,
    );
    const admission = admitChainAccessOperation(declaration, operation);
    const dayStart = new Date().toISOString().slice(0, 10);
    const daily = await this.engine.query<{ calls: string | number }>(
      `SELECT COALESCE(sum(calls_made),0) AS calls FROM disc.chain_access_consumption
       WHERE declaration_id=$1 AND declaration_version=$2 AND consumed_at >= $3::date`,
      [declaration.declarationId, declaration.version, dayStart],
    );
    if (Number(daily.rows[0]?.calls ?? 0) + operation.calls > declaration.maxCallsPerDay) {
      refuse('daily call consumption would exceed the declaration');
    }
    return admission;
  }

  /** Adapter callback is unreachable until every persisted and pure gate passes. */
  async admitThenExecute<T>(
    operation: ChainAccessOperation,
    networkCall: (admission: ChainAccessAdmission) => Promise<T>,
  ): Promise<T> {
    const admission = await this.admit(operation);
    return networkCall(admission);
  }

  async record(
    consumption: ChainAccessConsumption,
  ): Promise<{ readonly incident?: ChainAccessIncident }> {
    const declaration = await this.loadEffective(
      consumption.operation.declarationId,
      consumption.operation.declarationVersion,
    );
    admitChainAccessOperation(declaration, consumption.operation);
    natural(consumption.slotsScanned, 'slotsScanned');
    natural(consumption.callsMade, 'callsMade');
    natural(consumption.candidatesTouched, 'candidatesTouched');
    const prior = await this.engine.query<{
      slots: string | number;
      calls: string | number;
      candidates: string | number;
    }>(
      `SELECT COALESCE(sum(slots_scanned),0) AS slots,COALESCE(sum(calls_made),0) AS calls,
              COALESCE(sum(candidates_touched),0) AS candidates
       FROM disc.chain_access_consumption
       WHERE run_id=$1 AND declaration_id=$2 AND declaration_version=$3`,
      [consumption.operation.runId, declaration.declarationId, declaration.version],
    );
    const runSlots = Number(prior.rows[0]?.slots ?? 0) + consumption.slotsScanned;
    const runCalls = Number(prior.rows[0]?.calls ?? 0) + consumption.callsMade;
    const runCandidates = Number(prior.rows[0]?.candidates ?? 0) + consumption.candidatesTouched;
    if (
      runSlots > declaration.maxSlotsPerRun ||
      runCalls > declaration.maxCallsPerDay ||
      runCandidates > declaration.maxCandidates
    ) {
      refuse('actual chain-access consumption exceeded a hard bound');
    }
    const tolerance = 1 + declaration.tolerancePercent / 100;
    const breached =
      consumption.slotsScanned >
        (consumption.forecastSlots ??
          consumption.operation.endSlot - consumption.operation.startSlot + 1) *
          tolerance ||
      consumption.callsMade >
        (consumption.forecastCalls ?? consumption.operation.calls) * tolerance ||
      consumption.candidatesTouched >
        (consumption.forecastCandidates ?? consumption.operation.candidates) * tolerance;
    const incidentId = breached ? `chain-access-tolerance:${consumption.consumptionId}` : undefined;
    await this.engine.query(
      `INSERT INTO disc.chain_access_consumption (
         consumption_id,declaration_id,declaration_version,run_id,consumed_at,slots_scanned,
         calls_made,candidates_touched,incident_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT (consumption_id) DO NOTHING`,
      [
        consumption.consumptionId,
        declaration.declarationId,
        declaration.version,
        consumption.operation.runId,
        consumption.consumedAt,
        consumption.slotsScanned,
        consumption.callsMade,
        consumption.candidatesTouched,
        incidentId ?? null,
      ],
    );
    if (!breached || incidentId === undefined) return {};
    const ratio = Math.max(
      1,
      consumption.slotsScanned / Math.max(1, consumption.forecastSlots ?? consumption.slotsScanned),
      consumption.callsMade / Math.max(1, consumption.forecastCalls ?? consumption.callsMade),
      consumption.candidatesTouched /
        Math.max(1, consumption.forecastCandidates ?? consumption.candidatesTouched),
    );
    const incident: ChainAccessIncident = {
      incidentId,
      reason: 'FORECAST_TOLERANCE_EXCEEDED',
      effectiveMaxSlotsPerRun: Math.max(1, Math.floor(declaration.maxSlotsPerRun / ratio)),
      effectiveMaxCallsPerDay: Math.max(1, Math.floor(declaration.maxCallsPerDay / ratio)),
      effectiveMaxCandidates: Math.max(1, Math.floor(declaration.maxCandidates / ratio)),
      paidOverageConsumed: false,
      protectedReserveConsumed: false,
    };
    await this.engine.query(
      `INSERT INTO disc.chain_access_incidents (
         incident_id,consumption_id,declaration_id,declaration_version,reason,
         effective_max_slots_per_run,effective_max_calls_per_day,effective_max_candidates,
         paid_overage_consumed,protected_reserve_consumed)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,false,false) ON CONFLICT (incident_id) DO NOTHING`,
      [
        incident.incidentId,
        consumption.consumptionId,
        declaration.declarationId,
        declaration.version,
        incident.reason,
        incident.effectiveMaxSlotsPerRun,
        incident.effectiveMaxCallsPerDay,
        incident.effectiveMaxCandidates,
      ],
    );
    return { incident };
  }

  private async load(declarationId: string, version: number): Promise<ChainAccessDeclaration> {
    const result = await this.engine.query<Record<string, unknown>>(
      'SELECT * FROM disc.chain_access_declarations WHERE declaration_id=$1 AND version=$2',
      [declarationId, version],
    );
    if (result.rows[0] === undefined) refuse('chain-access operation names an unknown declaration');
    return declarationFromRow(result.rows[0]);
  }

  private async loadEffective(
    declarationId: string,
    version: number,
  ): Promise<ChainAccessDeclaration> {
    const declaration = await this.load(declarationId, version);
    const result = await this.engine.query<{
      effective_max_slots_per_run: string | number;
      effective_max_calls_per_day: string | number;
      effective_max_candidates: string | number;
    }>(
      `SELECT effective_max_slots_per_run,effective_max_calls_per_day,effective_max_candidates
       FROM disc.chain_access_incidents
       WHERE declaration_id=$1 AND declaration_version=$2
       ORDER BY recorded_at DESC,incident_id DESC LIMIT 1`,
      [declarationId, version],
    );
    const effective = result.rows[0];
    if (effective === undefined) return declaration;
    return {
      ...declaration,
      maxSlotsPerRun: Math.min(
        declaration.maxSlotsPerRun,
        Number(effective.effective_max_slots_per_run),
      ),
      maxCallsPerDay: Math.min(
        declaration.maxCallsPerDay,
        Number(effective.effective_max_calls_per_day),
      ),
      maxCandidates: Math.min(
        declaration.maxCandidates,
        Number(effective.effective_max_candidates),
      ),
    };
  }
}

export const validateChainAccessDeclaration = admitChainAccessDeclaration;
export const validateChainAccessOperation = admitChainAccessOperation;
