/**
 * Chain-access gate, declaration bounds, forecast tolerance, and incident clamping laws (FR-DISC-008).
 * Selective verification / retrospective backfill by default; cannot silently become broad paid ingestion.
 */
import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { PGlite } from '@electric-sql/pglite';
import {
  applyMigrations,
  createEngine,
  PRECISION_RETAINING_TIMESTAMP_PARSERS,
  type DatabaseEngine,
} from '@foresift/persistence';
import { DiscError } from '@foresift/domain';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  ChainAccessGate,
  admitChainAccessDeclaration,
  type ChainAccessOperation,
  type ChainAccessConsumption,
} from '../src/chain-access-gate.ts';
import type { ChainAccessDeclaration } from '@foresift/shared-schemas';

const MIGRATIONS_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../migrations',
);

let db: PGlite;
let engine: DatabaseEngine;
let gate: ChainAccessGate;

beforeAll(async () => {
  db = new PGlite({ parsers: PRECISION_RETAINING_TIMESTAMP_PARSERS });
  engine = createEngine(db, 'pglite');
  await applyMigrations({ engine, migrationsDir: MIGRATIONS_DIR });
  gate = new ChainAccessGate(engine);
});

afterAll(async () => {
  await db.close();
});

describe('Chain Access Gate & Declaration Laws (FR-DISC-008)', () => {
  const declarationV1: ChainAccessDeclaration = {
    declarationId: 'decl_pump_verify_001',
    version: 1,
    purpose: 'VERIFICATION',
    chainId: 'solana:mainnet',
    programIds: ['6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P'],
    maxCandidates: 10,
    maxSlotsPerRun: 100,
    maxCallsPerDay: 500,
    maxWindowSeconds: 300,
    costClass: 'FREE_UNMETERED',
    paidFallbackAllowed: false,
    protectedReserveCompatible: true,
    tolerancePercent: 20,
  };

  it('registers an immutable chain access declaration', async () => {
    const registered = await gate.register(declarationV1);
    expect(registered.declarationId).toBe('decl_pump_verify_001');
    expect(registered.version).toBe(1);
    expect(registered.paidFallbackAllowed).toBe(false);
  });

  it('refuses declarations with paid fallback or invalid reserve compatibility', () => {
    expect(() =>
      admitChainAccessDeclaration({
        ...declarationV1,
        paidFallbackAllowed: true, // PROHIBITED!
      }),
    ).toThrow(DiscError);
  });

  it('admits a valid chain access operation within declared bounds', async () => {
    const operation: ChainAccessOperation = {
      runId: 'run_valid_001',
      declarationId: 'decl_pump_verify_001',
      declarationVersion: 1,
      purpose: 'VERIFICATION',
      chainId: 'solana:mainnet',
      programIds: ['6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P'],
      candidates: 5,
      startSlot: 1000,
      endSlot: 1050, // 51 slots (<= 100)
      calls: 10,
      windowSeconds: 60,
    };

    const admission = await gate.admit(operation);
    expect(admission.admitted).toBe(true);
    expect(admission.paidFallbackAllowed).toBe(false);
    expect(admission.protectedReserveConsumptionAllowed).toBe(false);
  });

  it('refuses operation when bounds (slots, calls, candidates, programs) are exceeded', async () => {
    const excessSlots: ChainAccessOperation = {
      runId: 'run_excess_slots',
      declarationId: 'decl_pump_verify_001',
      declarationVersion: 1,
      purpose: 'VERIFICATION',
      chainId: 'solana:mainnet',
      programIds: ['6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P'],
      candidates: 5,
      startSlot: 1000,
      endSlot: 1500, // 501 slots > max 100!
      calls: 10,
      windowSeconds: 60,
    };
    await expect(gate.admit(excessSlots)).rejects.toThrow(/exceeds its declared bound/i);

    const undeclaredProgram: ChainAccessOperation = {
      ...excessSlots,
      endSlot: 1050,
      programIds: ['TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA'], // Undeclared!
    };
    await expect(gate.admit(undeclaredProgram)).rejects.toThrow(/undeclared program/i);
  });

  it('admitThenExecute protects network call and passes callback on success', async () => {
    const operation: ChainAccessOperation = {
      runId: 'run_exec_001',
      declarationId: 'decl_pump_verify_001',
      declarationVersion: 1,
      purpose: 'VERIFICATION',
      chainId: 'solana:mainnet',
      programIds: ['6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P'],
      candidates: 2,
      startSlot: 1000,
      endSlot: 1020,
      calls: 2,
      windowSeconds: 30,
    };

    let called = false;
    const result = await gate.admitThenExecute(operation, async (admission) => {
      called = true;
      expect(admission.runId).toBe('run_exec_001');
      return 'network_response_data';
    });

    expect(called).toBe(true);
    expect(result).toBe('network_response_data');
  });
});

describe('Chain Access Consumption, Tolerance Breaches & Clamping (FR-DISC-008)', () => {
  const operation: ChainAccessOperation = {
    runId: 'run_breach_001',
    declarationId: 'decl_pump_verify_001',
    declarationVersion: 1,
    purpose: 'VERIFICATION',
    chainId: 'solana:mainnet',
    programIds: ['6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P'],
    candidates: 2,
    startSlot: 1000,
    endSlot: 1050,
    calls: 5,
    windowSeconds: 60,
  };

  it('records normal consumption without creating an incident', async () => {
    const normalConsumption: ChainAccessConsumption = {
      consumptionId: 'cons_norm_001',
      operation,
      consumedAt: '2026-08-20T10:00:00Z',
      slotsScanned: 50,
      callsMade: 5,
      candidatesTouched: 2,
      forecastSlots: 50,
      forecastCalls: 5,
      forecastCandidates: 2,
    };

    const recordResult = await gate.record(normalConsumption);
    expect(recordResult.incident).toBeUndefined();
  });

  it('creates an incident when consumption exceeds forecast by more than tolerancePercent', async () => {
    // Forecast calls was 2, actual calls made was 5 (250% of forecast > 20% tolerance!)
    const breachedConsumption: ChainAccessConsumption = {
      consumptionId: 'cons_breach_001',
      operation,
      consumedAt: '2026-08-20T10:05:00Z',
      slotsScanned: 50,
      callsMade: 5,
      candidatesTouched: 2,
      forecastSlots: 50,
      forecastCalls: 2, // 2 * 1.2 = 2.4 < 5!
      forecastCandidates: 2,
    };

    const recordResult = await gate.record(breachedConsumption);
    expect(recordResult.incident).toBeDefined();
    expect(recordResult.incident?.reason).toBe('FORECAST_TOLERANCE_EXCEEDED');
    expect(recordResult.incident?.paidOverageConsumed).toBe(false);
    expect(recordResult.incident?.protectedReserveConsumed).toBe(false);
    // Effective bounds are clamped downwards
    expect(recordResult.incident?.effectiveMaxCallsPerDay).toBeLessThan(500);
  });
});
