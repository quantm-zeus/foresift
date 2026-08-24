/**
 * Import gating over the quarantine state machine (FR-SEC-008, §35.14;
 * T127). DB-backed over the real sec.import_artifacts rows so CHECKs,
 * monotone ranks, and finding evidence are exercised against SQL truth.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { UtcTimestamp } from '@foresift/domain';
import {
  applyMigrations,
  createEngine,
  PRECISION_RETAINING_TIMESTAMP_PARSERS,
  type DatabaseEngine,
} from '@foresift/persistence';
import { ImportGate } from '../src/import-gating.ts';

const MIGRATIONS_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../migrations',
);

/** Brand test anchors as UtcTimestamp (same convention as the other suites). */
const at = (s: string) => s as UtcTimestamp;

let db: PGlite;
let engine: DatabaseEngine;
let gate: ImportGate;

const TRUSTED = {
  keyId: 'producer-key-1',
  expiresAt: at('2030-01-01T00:00:00.000Z'),
};

function intakeRequest(overrides: Partial<Parameters<ImportGate['intake']>[0]> = {}) {
  return {
    artifactId: 'art-1',
    format: 'VERSIONED_JSON',
    producerKeyId: 'producer-key-1',
    manifestCanonicalJson: '{"dataset":"whale-alerts","version":1}',
    byteSize: 1024,
    fileCount: 1,
    memberPaths: ['data/manifest.json'],
    stepUpApprovalRef: 'stepup-123',
    ...overrides,
  };
}

beforeAll(async () => {
  db = new PGlite({ parsers: PRECISION_RETAINING_TIMESTAMP_PARSERS });
  engine = createEngine(db, 'pglite');
  await applyMigrations({ engine, migrationsDir: MIGRATIONS_DIR });
  gate = new ImportGate({
    engine,
    trustedProducers: [TRUSTED],
    verifier: (bytes) => bytes.length > 0,
  });
});

afterAll(async () => {
  await db.close();
});

describe('intake hygiene (§35.14 — refusals happen BEFORE a row exists)', () => {
  it('records a RECEIVED artifact at rank 0 with its step-up reference', async () => {
    const row = await gate.intake(intakeRequest(), at('2026-08-24T10:00:00.000Z'));
    expect(row.state).toBe('RECEIVED');
    expect(row.state_rank).toBe(0);
    expect(row.prior_state_rank).toBe(-1);
    expect(row.step_up_approval_ref).toBe('stepup-123');
  });

  it('refuses non-allowlisted formats without inserting anything', async () => {
    await expect(
      gate.intake(
        intakeRequest({ artifactId: 'art-fmt', format: 'RAW_SQL_DUMP' }),
        at('2026-08-24T10:00:01.000Z'),
      ),
    ).rejects.toThrow(/not on the intake allowlist/);
    const check = await engine.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM sec.import_artifacts WHERE artifact_id = 'art-fmt'`,
    );
    expect(check.rows[0]?.n).toBe('0');
  });

  it('refuses intake without a step-up approval reference', async () => {
    await expect(
      gate.intake(
        intakeRequest({ artifactId: 'art-nostep', stepUpApprovalRef: '' }),
        at('2026-08-24T10:00:02.000Z'),
      ),
    ).rejects.toThrow(/step-up approval/);
  });

  it('enforces count and size limits and the decompression-ratio cap', async () => {
    await expect(
      gate.intake(
        intakeRequest({ artifactId: 'art-count', fileCount: 5001 }),
        at('2026-08-24T10:00:03.000Z'),
      ),
    ).rejects.toThrow(/count or size limits/);
    await expect(
      gate.intake(
        intakeRequest({
          artifactId: 'art-zipbomb',
          compressedByteSize: 100,
          byteSize: 1_000_000,
        }),
        at('2026-08-24T10:00:04.000Z'),
      ),
    ).rejects.toThrow(/decompression ratio/);
  });

  it('refuses traversal, absolute, drive-letter, and NUL member paths structurally', async () => {
    for (const [label, memberPaths] of [
      ['traversal', ['data/../../etc/passwd']],
      ['absolute', ['/etc/passwd']],
      ['drive', ['C:/Windows/system32']],
      ['nul', ['data\0hidden']],
    ] as const) {
      await expect(
        gate.intake(
          intakeRequest({ artifactId: `art-${label}`, memberPaths }),
          at('2026-08-24T10:00:05.000Z'),
        ),
        label,
      ).rejects.toThrow(/unsafe member path/);
    }
  });
});

describe('signature verification against the trusted-producer allowlist', () => {
  it('verifies matching material signed by a trusted producer', async () => {
    const material = new TextEncoder().encode('{"dataset":"whale-alerts","version":1}');
    await expect(
      gate.verifySignature({
        artifactId: 'art-1',
        signature: 'sig-ok',
        materialBytes: material,
        nowMs: Date.parse('2026-08-24T00:00:00.000Z'),
      }),
    ).resolves.toBeUndefined();
  });

  it('refuses unknown producers BEFORE verification is attempted', async () => {
    await gate.intake(
      intakeRequest({ artifactId: 'art-rogue', producerKeyId: 'rogue-key' }),
      at('2026-08-24T10:01:00.000Z'),
    );
    await expect(
      gate.verifySignature({
        artifactId: 'art-rogue',
        signature: 'sig',
        materialBytes: new TextEncoder().encode('{}'),
        nowMs: Date.parse('2026-08-24T00:00:00.000Z'),
      }),
    ).rejects.toThrow(/not on the trust allowlist/);
  });

  it('refuses expired and revoked producer trust anchors', async () => {
    const expiredGate = new ImportGate({
      engine,
      trustedProducers: [{ keyId: 'expired-key', expiresAt: at('2020-01-01T00:00:00.000Z') }],
      verifier: () => true,
    });
    await expiredGate.intake(
      intakeRequest({ artifactId: 'art-expired', producerKeyId: 'expired-key' }),
      at('2026-08-24T10:01:01.000Z'),
    );
    await expect(
      expiredGate.verifySignature({
        artifactId: 'art-expired',
        signature: 'sig',
        materialBytes: new TextEncoder().encode('{"dataset":"whale-alerts","version":1}'),
        nowMs: Date.parse('2026-08-24T00:00:00.000Z'),
      }),
    ).rejects.toThrow(/expired or revoked/);

    const revokedGate = new ImportGate({
      engine,
      trustedProducers: [
        {
          keyId: 'revoked-key',
          expiresAt: at('2030-01-01T00:00:00.000Z'),
          revokedAt: at('2026-01-01T00:00:00.000Z'),
        },
      ],
      verifier: () => true,
    });
    await revokedGate.intake(
      intakeRequest({ artifactId: 'art-revoked', producerKeyId: 'revoked-key' }),
      at('2026-08-24T10:01:02.000Z'),
    );
    await expect(
      revokedGate.verifySignature({
        artifactId: 'art-revoked',
        signature: 'sig',
        materialBytes: new TextEncoder().encode('{"dataset":"whale-alerts","version":1}'),
        nowMs: Date.parse('2026-08-24T00:00:00.000Z'),
      }),
    ).rejects.toThrow(/expired or revoked/);
  });

  it('refuses presented material whose hash diverges from the recorded manifest', async () => {
    await expect(
      gate.verifySignature({
        artifactId: 'art-1',
        signature: 'sig',
        materialBytes: new TextEncoder().encode('tampered'),
        nowMs: Date.parse('2026-08-24T00:00:00.000Z'),
      }),
    ).rejects.toThrow(/does not match the recorded manifest hash/);
  });

  it('refuses an invalid producer signature even when the hash matches', async () => {
    const strictGate = new ImportGate({
      engine,
      trustedProducers: [TRUSTED],
      verifier: () => false,
    });
    // art-1 already exists in this database with the same manifest content.
    await expect(
      strictGate.verifySignature({
        artifactId: 'art-1',
        signature: 'forged',
        materialBytes: new TextEncoder().encode('{"dataset":"whale-alerts","version":1}'),
        nowMs: Date.parse('2026-08-24T00:00:00.000Z'),
      }),
    ).rejects.toThrow(/signature verification failed/);
  });
});

describe('monotone quarantine state machine (no ACTIVE state)', () => {
  it('walks RECEIVED→QUARANTINED→SCANNED→VALIDATING→SHADOW_ELIGIBLE monotonically', async () => {
    await gate.intake(intakeRequest({ artifactId: 'art-happy' }), at('2026-08-24T11:00:00.000Z'));
    for (const state of ['QUARANTINED', 'SCANNED', 'VALIDATING'] as const) {
      const row = await gate.transition(`art-happy`, state, at('2026-08-24T11:00:01.000Z'));
      expect(row.state).toBe(state);
      expect(row.state_rank).toBeGreaterThan(row.prior_state_rank);
    }
    const final = await gate.finalizeValidation({
      artifactId: 'art-happy',
      outcome: 'SHADOW_ELIGIBLE',
      at: at('2026-08-24T11:00:02.000Z'),
      stepUpApprovalRef: 'stepup-123',
    });
    expect(final.state).toBe('SHADOW_ELIGIBLE');
    expect(final.state_rank).toBe(4);
    // Terminal: no outgoing edges exist.
    await expect(
      gate.transition('art-happy', 'VALIDATING', at('2026-08-24T11:00:03.000Z')),
    ).rejects.toThrow(/illegal quarantine transition/);
  });

  it('refuses backward and skipping transitions', async () => {
    await gate.intake(intakeRequest({ artifactId: 'art-back' }), at('2026-08-24T11:01:00.000Z'));
    await gate.transition('art-back', 'QUARANTINED', at('2026-08-24T11:01:01.000Z'));
    await expect(
      gate.transition('art-back', 'RECEIVED', at('2026-08-24T11:01:02.000Z')),
    ).rejects.toThrow(/illegal quarantine transition.*RECEIVED/);
    await expect(
      gate.transition('art-back', 'SHADOW_ELIGIBLE', at('2026-08-24T11:01:03.000Z')),
    ).rejects.toThrow(/illegal quarantine transition/);
  });

  it('cannot name an ACTIVE state anywhere in the machine', async () => {
    await expect(
      gate.transition('art-back', 'ACTIVE' as never, at('2026-08-24T11:01:04.000Z')),
    ).rejects.toThrow(/unknown quarantine state 'ACTIVE'/);
  });

  it('REFUSES (never silently no-ops) when a concurrent writer wins the guarded UPDATE', async () => {
    await gate.intake(intakeRequest({ artifactId: 'art-race' }), at('2026-08-24T14:00:00.000Z'));
    await gate.transition('art-race', 'QUARANTINED', at('2026-08-24T14:00:01.000Z'));
    await gate.transition('art-race', 'SCANNED', at('2026-08-24T14:00:02.000Z'));

    // Reproduce the race deterministically: a racing writer advances the row
    // BETWEEN the legality re-read and the guarded UPDATE, so the CAS UPDATE
    // matches ZERO rows even though the check just passed.
    const racingEngine: DatabaseEngine = {
      engineKind: engine.engineKind,
      exec: (sql) => engine.exec(sql),
      query: <T>(sql: string, params?: readonly unknown[]) => {
        if (sql.includes('UPDATE sec.import_artifacts')) {
          return (async () => {
            await engine.query(
              `UPDATE sec.import_artifacts
               SET prior_state_rank = state_rank, state_rank = state_rank + 1,
                   state = 'VALIDATING', state_changed_at = $2
               WHERE artifact_id = $1`,
              [params?.[0], at('2026-08-24T14:00:03.000Z')],
            );
            return engine.query<T>(sql, params);
          })();
        }
        return engine.query<T>(sql, params);
      },
      transaction: <R>(work: (tx: DatabaseEngine) => Promise<R>) => engine.transaction(work),
    };
    const racingGate = new ImportGate({
      engine: racingEngine,
      trustedProducers: [TRUSTED],
      verifier: () => true,
    });

    await expect(
      racingGate.transition('art-race', 'VALIDATING', at('2026-08-24T14:00:04.000Z')),
    ).rejects.toThrow(/concurrent transition raced/);
    // SQL truth kept exactly the racing writer's outcome — no silent loss.
    const row = await gate.getArtifact('art-race');
    expect(row.state).toBe('VALIDATING');
  });

  it('couples validation completion to the step-up approval reference', async () => {
    await gate.intake(
      intakeRequest({ artifactId: 'art-finalize' }),
      at('2026-08-24T11:02:00.000Z'),
    );
    await gate.transition('art-finalize', 'QUARANTINED', at('2026-08-24T11:02:01.000Z'));
    await gate.transition('art-finalize', 'SCANNED', at('2026-08-24T11:02:02.000Z'));
    await gate.transition('art-finalize', 'VALIDATING', at('2026-08-24T11:02:03.000Z'));
    await expect(
      gate.finalizeValidation({
        artifactId: 'art-finalize',
        outcome: 'SHADOW_ELIGIBLE',
        at: at('2026-08-24T11:02:04.000Z'),
        stepUpApprovalRef: '',
      }),
    ).rejects.toThrow(/step-up approval/);
  });
});

describe('content-scan findings and auto-reject', () => {
  it('persists scan findings as evidence child rows', async () => {
    await gate.recordScanFinding({
      findingId: 'find-1',
      artifactId: 'art-happy',
      scanner: 'FORMAT_INSPECTION',
      verdict: 'CLEAN',
      detail: 'versioned JSON structure validated',
      recordedAt: at('2026-08-24T11:00:00.500Z'),
    });
    const findings = await gate.findingsFor('art-happy');
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({ scanner: 'FORMAT_INSPECTION', verdict: 'CLEAN' });
  });

  it('auto-transitions MALICIOUS verdicts straight to REJECTED', async () => {
    await gate.intake(
      intakeRequest({ artifactId: 'art-malicious' }),
      at('2026-08-24T12:00:00.000Z'),
    );
    await gate.transition('art-malicious', 'QUARANTINED', at('2026-08-24T12:00:01.000Z'));
    await gate.recordScanFinding({
      findingId: 'find-2',
      artifactId: 'art-malicious',
      scanner: 'CONTENT_SCAN',
      verdict: 'MALICIOUS',
      detail: 'eicar-style test pattern matched',
      recordedAt: at('2026-08-24T12:00:02.000Z'),
    });
    const row = await gate.getArtifact('art-malicious');
    expect(row.state).toBe('REJECTED');
    // REJECTED is terminal — no VALIDATING limbo afterwards.
    await expect(
      gate.transition('art-malicious', 'VALIDATING', at('2026-08-24T12:00:03.000Z')),
    ).rejects.toThrow(/illegal quarantine transition/);
  });
});

describe('isolated-parsing boundary contract', () => {
  it('refuses any claim that parsing ran in-process', () => {
    expect(() => gate.assertIsolatedParsingBoundary({ inProcess: true })).toThrow(
      /isolated-parsing boundary/,
    );
    expect(() => gate.assertIsolatedParsingBoundary({ inProcess: false })).not.toThrow();
  });
});
