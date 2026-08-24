// Incident lifecycle over sec.security_incidents (T110): severity taxonomy,
// monotone containment, evidence preservation, resolution evidence duties,
// and the §35.9 open-audit-failure query that gates high-impact activation.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import {
  applyMigrations,
  createEngine,
  PRECISION_RETAINING_TIMESTAMP_PARSERS,
  type DatabaseEngine,
} from '@foresift/persistence';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Incidents } from '../src/incidents.ts';
import { SecErrorCode } from '../src/errors.ts';

const MIGRATIONS_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../migrations',
);
const at = (s: string) => s as import('@foresift/domain').UtcTimestamp;

let db: PGlite;
let engine: DatabaseEngine;
let incidents: Incidents;

beforeAll(async () => {
  db = new PGlite({ parsers: PRECISION_RETAINING_TIMESTAMP_PARSERS });
  engine = createEngine(db, 'pglite');
  await applyMigrations({ engine, migrationsDir: MIGRATIONS_DIR });
  incidents = new Incidents(engine);
});

afterAll(async () => {
  await db.close();
});

async function seedIncident(id: string) {
  return incidents.open({
    incidentId: id,
    kind: 'AUDIT_CHAIN_FAILURE',
    severity: 'SEV1',
    owner: 'oncall-security',
    openedAt: at('2026-08-01T00:00:00Z'),
    evidenceRefs: ['evidence://audit/first-divergence'],
  });
}

describe('incident lifecycle (FR-SEC-011)', () => {
  it('opens with OPEN containment, owner, kind, and preserved evidence', async () => {
    const inc = await seedIncident('inc-open');
    expect(inc.containment).toBe('OPEN');
    expect(inc.severity).toBe('SEV1');
    expect(inc.evidenceRefs).toEqual(['evidence://audit/first-divergence']);
  });

  it('refuses opening without any evidence reference', async () => {
    await expect(
      incidents.open({
        incidentId: 'inc-noev',
        kind: 'DATA_LEAKAGE',
        severity: 'SEV2',
        owner: 'security',
        openedAt: at('2026-08-01T00:00:00Z'),
        evidenceRefs: [],
      }),
    ).rejects.toMatchObject({ code: SecErrorCode.SEC_INCIDENT_EVIDENCE_REQUIRED });
  });

  it('advances containment strictly monotonically', async () => {
    await seedIncident('inc-mono');
    await incidents.transition('inc-mono', 'CONTAINED', { at: at('2026-08-01T01:00:00Z') });
    // skipping a state is refused…
    await expect(
      incidents.transition('inc-mono', 'RESOLVED', {
        at: at('2026-08-01T02:00:00Z'),
        recoveryVerifiedAt: at('2026-08-01T02:00:00Z'),
        postmortemRef: 'pm://1',
        regressionTestRef: 'tests/x.spec.ts',
      }),
    ).rejects.toMatchObject({ code: SecErrorCode.SEC_INCIDENT_STATE_TRANSITION_INVALID });
    // …and so is regression.
    await expect(
      incidents.transition('inc-mono', 'OPEN', { at: at('2026-08-01T02:00:00Z') }),
    ).rejects.toMatchObject({ code: SecErrorCode.SEC_INCIDENT_STATE_TRANSITION_INVALID });

    await incidents.transition('inc-mono', 'RECOVERY_VERIFIED', {
      at: at('2026-08-01T03:00:00Z'),
    });
    const resolved = await incidents.transition('inc-mono', 'RESOLVED', {
      at: at('2026-08-01T04:00:00Z'),
      recoveryVerifiedAt: at('2026-08-01T03:30:00Z'),
      postmortemRef: 'postmortem://inc-mono',
      regressionTestRef: 'tests/negative/AC-259.negative.spec.ts',
    });
    expect(resolved.resolvedAt).toBe(at('2026-08-01T04:00:00Z'));
    expect(resolved.postmortemRef).toBe('postmortem://inc-mono');
  });

  it('refuses RESOLVED without recovery verification, postmortem, regression link', async () => {
    await seedIncident('inc-ev');
    await incidents.transition('inc-ev', 'CONTAINED', { at: at('2026-08-01T01:00:00Z') });
    await incidents.transition('inc-ev', 'RECOVERY_VERIFIED', {
      at: at('2026-08-01T02:00:00Z'),
    });
    await expect(
      incidents.transition('inc-ev', 'RESOLVED', { at: at('2026-08-01T05:00:00Z') }),
    ).rejects.toMatchObject({ code: SecErrorCode.SEC_INCIDENT_EVIDENCE_REQUIRED });
  });

  it('preserves evidence across later appends (no overwrite)', async () => {
    await seedIncident('inc-evapp');
    await incidents.attachEvidence('inc-evapp', ['evidence://second']);
    const inc = await incidents.get('inc-evapp');
    expect(inc?.evidenceRefs).toEqual(['evidence://audit/first-divergence', 'evidence://second']);
  });

  it('reports open critical audit-chain failures for the §35.9 block rule', async () => {
    // Independent oracle over the raw table: this suite shares one database,
    // so the block predicate is asserted as a delta around this test's row.
    const openCount = async () =>
      Number(
        (
          await engine.query(
            `SELECT COUNT(*)::int AS n FROM sec.security_incidents
             WHERE kind = 'AUDIT_CHAIN_FAILURE' AND severity = 'SEV1'
               AND containment <> 'RESOLVED'`,
          )
        ).rows[0]?.n ?? 0,
      );
    const baseline = await openCount();
    await seedIncident('inc-block');
    expect(await incidents.isOpenAuditChainFailure()).toBe(true);
    expect(await openCount()).toBe(baseline + 1);
    // A resolved audit failure no longer blocks.
    await incidents.transition('inc-block', 'CONTAINED', { at: at('2026-08-01T01:00:00Z') });
    await incidents.transition('inc-block', 'RECOVERY_VERIFIED', {
      at: at('2026-08-01T02:00:00Z'),
    });
    await incidents.transition('inc-block', 'RESOLVED', {
      at: at('2026-08-01T06:00:00Z'),
      recoveryVerifiedAt: at('2026-08-01T05:00:00Z'),
      postmortemRef: 'postmortem://inc-block',
      regressionTestRef: 'tests/negative/AC-259.negative.spec.ts',
    });
    expect(await openCount()).toBe(baseline);
  });

  it('a non-critical or non-audit incident never triggers the §35.9 block', async () => {
    const openCount = async () =>
      Number(
        (
          await engine.query(
            `SELECT COUNT(*)::int AS n FROM sec.security_incidents
             WHERE kind = 'AUDIT_CHAIN_FAILURE' AND severity = 'SEV1'
               AND containment <> 'RESOLVED'`,
          )
        ).rows[0]?.n ?? 0,
      );
    const baseline = await openCount();
    await incidents.open({
      incidentId: 'inc-sev4',
      kind: 'OTHER',
      severity: 'SEV4',
      owner: 'ops',
      openedAt: at('2026-08-01T00:00:00Z'),
      evidenceRefs: ['evidence://minor'],
    });
    expect(await openCount()).toBe(baseline);
  });
});

describe('incident fail-closed edges (M21/M10)', () => {
  it('fails closed on UNKNOWN incidents across every entrypoint', async () => {
    await expect(
      incidents.transition('incident-ghost', 'CONTAINED', { at: at('2026-08-01T01:00:00Z') }),
    ).rejects.toThrow(/not found/);
    expect(await incidents.get('incident-ghost')).toBeNull();
    // Evidence for an unknown incident is NEVER silently dropped.
    await expect(incidents.attachEvidence('incident-ghost', ['evidence://late'])).rejects.toThrow(
      /not found/,
    );
    await expect(incidents.attachEvidence('incident-ghost', [])).rejects.toMatchObject({
      code: SecErrorCode.SEC_INCIDENT_EVIDENCE_REQUIRED,
    });
    // Whitespace-only evidence references refuse identically to absence.
    await expect(
      incidents.open({
        incidentId: 'inc-blank-evidence',
        kind: 'OTHER',
        severity: 'SEV3',
        owner: 'oncall',
        openedAt: at('2026-08-01T01:00:00Z'),
        evidenceRefs: ['   '],
      }),
    ).rejects.toMatchObject({ code: SecErrorCode.SEC_INCIDENT_EVIDENCE_REQUIRED });
  });

  it('CAS-guards containment so a raced legal transition refuses TYPED', async () => {
    await incidents.open({
      incidentId: 'inc-cas',
      kind: 'OTHER',
      severity: 'SEV3',
      owner: 'oncall',
      openedAt: at('2026-08-01T01:00:00Z'),
      evidenceRefs: ['evidence://cas'],
    });
    // Simulate losing the compare-and-swap race: exactly one containment
    // UPDATE returns zero rows even though the SELECT saw a legal `from`.
    let swallowOnce = true;
    const racingEngine = {
      query: async (sql: string, params: readonly unknown[]) => {
        if (swallowOnce && /SET containment = \$2/.test(sql)) {
          swallowOnce = false;
          return { rows: [], rowCount: 0 };
        }
        return engine.query(sql as never, params as never);
      },
    } as unknown as typeof engine;
    const raced = new Incidents(racingEngine);
    const err = (await raced
      .transition('inc-cas', 'CONTAINED', { at: at('2026-08-01T02:00:00Z') })
      .catch((e: unknown) => e as { code?: string; message?: string })) as {
      code?: string;
      message?: string;
    };
    expect(err.code).toBe(SecErrorCode.SEC_INCIDENT_STATE_TRANSITION_INVALID);
    expect(err.message).toContain('concurrent transition raced');
    // The incident is untouched — containment never regressed or vanished.
    expect((await incidents.get('inc-cas'))?.containment).toBe('OPEN');
    // And the normal path still advances it afterwards.
    const advanced = await incidents.transition('inc-cas', 'CONTAINED', {
      at: at('2026-08-01T03:00:00Z'),
    });
    expect(advanced.containment).toBe('CONTAINED');
  });
});
