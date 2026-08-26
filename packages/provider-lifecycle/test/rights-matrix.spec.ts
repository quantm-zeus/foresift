// Rights matrix + artifact registry (FR-PROV-009; AC-273): sixteen-field
// declarations as immutable history, tightening-only change records with
// durable artifact-action enumeration, immediate fail-closed use decisions
// against the captured rights version, and reactivation that requires real
// reverification.
import { describe, expect, it } from 'vitest';
import type { UtcTimestamp } from '@foresift/domain';
import { makeProvStack, closeProvStack, seedOperation, T0 } from './helpers.ts';

const at = (iso: string) => iso as UtcTimestamp;

const V1 = {
  ref: { providerId: 'prov-test', operationId: 'get-token-price', version: '1.0.0' },
  rightsVersion: 'v1',
  commercialUseAllowed: false,
  personalResearchAllowed: true,
  cacheAllowed: true,
  maximumCacheDuration: 'PT24H',
  rawRetentionAllowed: true,
  derivedFeaturesAllowed: true,
  modelTrainingAllowed: true,
  redistributionAllowed: true,
  publicAlertDerivativeAllowed: true,
  attributionRequired: true,
  userByokRequired: false,
  rawExportAllowed: true,
  jurisdictionRestrictions: ['EU'],
  termsVersion: 'terms-2026-01',
  verifiedAt: T0,
  verificationExpiresAt: at('2026-09-01T00:00:00Z'),
};

/** The tightened successor of V1: cache, model use, and export prohibited. */
const V2 = {
  ...V1,
  rightsVersion: 'v2',
  cacheAllowed: false,
  maximumCacheDuration: null,
  modelTrainingAllowed: false,
  rawExportAllowed: false,
  verifiedAt: at('2026-08-15T00:00:00Z'),
};

async function seedRightsWorld(stack: Awaited<ReturnType<typeof makeProvStack>>) {
  const op = await seedOperation(stack);
  await stack.rights.declare({ ...V1, ref: op });
  await stack.rights.declare({ ...V2, ref: op });
  return op;
}

describe('rights declarations', () => {
  it('stores all sixteen fields and serves current/at-version lookups', async () => {
    const stack = await makeProvStack();
    try {
      const op = await seedRightsWorld(stack);
      const current = await stack.rights.currentDeclaration(op);
      expect(current?.rightsVersion).toBe('v2');
      expect(current?.commercialUseAllowed).toBe(false);
      expect(current?.attributionRequired).toBe(true);
      expect(current?.jurisdictionRestrictions).toEqual(['EU']);
      const v1 = await stack.rights.declarationAt(op, 'v1');
      expect(v1.cacheAllowed).toBe(true);
      expect(v1.maximumCacheDuration).toBe('PT24H');
    } finally {
      await closeProvStack(stack);
    }
  });

  it('refuses unknown rights versions and inverted verification windows', async () => {
    const stack = await makeProvStack();
    try {
      const op = await seedOperation(stack);
      await expect(stack.rights.declarationAt(op, 'nope')).rejects.toMatchObject({
        code: 'PROV_RIGHTS_VERSION_UNKNOWN',
      });
      await expect(
        stack.rights.declare({
          ...V1,
          ref: op,
          verifiedAt: at('2026-09-01T00:00:00Z'),
          verificationExpiresAt: T0,
        }),
      ).rejects.toMatchObject({ code: 'PROV_RIGHTS_VERIFICATION_EXPIRED' });
    } finally {
      await closeProvStack(stack);
    }
  });

  it('a cache-allowing declaration must carry its maximum duration', async () => {
    const stack = await makeProvStack();
    try {
      const op = await seedOperation(stack);
      await expect(
        stack.rights.declare({ ...V1, ref: op, maximumCacheDuration: null }),
      ).rejects.toMatchObject({ code: 'PROV_DEFINITION_INVALID' });
    } finally {
      await closeProvStack(stack);
    }
  });
});

describe('rights changes (tightenings)', () => {
  it('computes the diff, refuses empty diffs, and audits the change', async () => {
    const stack = await makeProvStack();
    try {
      const op = await seedRightsWorld(stack);
      // v1→v3 loosens nothing new (identical to v1) → refused.
      await stack.rights.declare({ ...V1, ref: op, rightsVersion: 'v3' });
      await expect(
        stack.rights.recordChange({
          changeId: 'chg-empty',
          ref: op,
          fromRightsVersion: 'v1',
          toRightsVersion: 'v3',
          changedAt: T0,
          declaredBy: 'provider-relations',
          evidenceRefs: ['e'],
        }),
      ).rejects.toMatchObject({ code: 'PROV_DEFINITION_INVALID' });

      const recorded = await stack.rights.recordChange({
        changeId: 'chg-1',
        ref: op,
        fromRightsVersion: 'v1',
        toRightsVersion: 'v2',
        changedAt: at('2026-08-15T00:00:00Z'),
        declaredBy: 'provider-relations',
        evidenceRefs: ['notice:official-2026-08-15'],
      });
      expect([...recorded.newlyProhibitedUses].sort()).toEqual(['CACHE', 'EXPORT', 'MODEL_USE']);

      const chain = await stack.engine.query<{ action_class: string; payload_canonical: string }>(
        "SELECT action_class, payload_canonical FROM sec.sec_audit_events WHERE action_class = 'RIGHTS_CHANGE'",
      );
      expect(chain.rows.length).toBe(1);
      expect(chain.rows[0]?.payload_canonical).toContain('newlyProhibitedUses');
    } finally {
      await closeProvStack(stack);
    }
  });

  it('enumerates affected artifacts durably: RETIRE for export/retention bans, QUARANTINE otherwise', async () => {
    const stack = await makeProvStack();
    try {
      const op = await seedRightsWorld(stack);
      await stack.artifacts.registerArtifact({
        artifactId: 'art-cache-only',
        objectRef: 'obj://cache/snapshot-1',
        ref: op,
        rightsVersionAtCapture: 'v1',
        capturedAt: T0,
      });
      await stack.artifacts.registerArtifact({
        artifactId: 'art-exported',
        objectRef: 'obj://export/dump-1',
        ref: op,
        rightsVersionAtCapture: 'v1',
        capturedAt: T0,
      });
      await stack.artifacts.registerArtifact({
        artifactId: 'art-post',
        objectRef: 'obj://cache/snapshot-2',
        ref: op,
        rightsVersionAtCapture: 'v2',
        capturedAt: at('2026-08-16T00:00:00Z'),
      });

      await stack.rights.recordChange({
        changeId: 'chg-blast',
        ref: op,
        fromRightsVersion: 'v1',
        toRightsVersion: 'v2',
        changedAt: at('2026-08-15T00:00:00Z'),
        declaredBy: 'provider-relations',
        evidenceRefs: ['e'],
      });

      // EXPORT is newly prohibited → both pre-tightening artifacts RETIRE.
      const actions = await stack.engine.query<{
        artifact_id: string;
        action: string;
      }>('SELECT artifact_id, action FROM prov.prov_rights_change_actions ORDER BY artifact_id');
      expect(actions.rows.map((r) => [r.artifact_id, r.action])).toEqual([
        ['art-cache-only', 'RETIRE'],
        ['art-exported', 'RETIRE'],
      ]);
      const states = await stack.engine.query<{ artifact_id: string; state: string }>(
        "SELECT artifact_id, state FROM prov.prov_provider_artifacts WHERE state <> 'ACTIVE' ORDER BY artifact_id",
      );
      expect(states.rows.map((r) => [r.artifact_id, r.state])).toEqual([
        ['art-cache-only', 'RETIRED'],
        ['art-exported', 'RETIRED'],
      ]);
      // Post-tightening capture is untouched.
      const postState = await stack.artifacts.getArtifact('art-post');
      expect(postState.state).toBe('ACTIVE');
    } finally {
      await closeProvStack(stack);
    }
  });
});

describe('fail-closed use decisions', () => {
  it('live decisions follow the CURRENT declaration and refuse prohibited paths', async () => {
    const stack = await makeProvStack();
    try {
      const op = await seedRightsWorld(stack);
      const allowed = await stack.rights.decideUse({ ref: op, usePath: 'RAW_RETENTION', at: T0 });
      expect(allowed.allowed).toBe(true);
      expect(allowed.evaluatedAgainstRightsVersion).toBe('v2');
      await expect(
        stack.rights.decideUse({ ref: op, usePath: 'MODEL_USE', at: T0 }),
      ).rejects.toMatchObject({ code: 'PROV_RIGHTS_USE_PATH_PROHIBITED' });
    } finally {
      await closeProvStack(stack);
    }
  });

  it('expired rights verification refuses EVERY path fail-closed', async () => {
    const stack = await makeProvStack();
    try {
      const op = await seedRightsWorld(stack);
      await expect(
        stack.rights.decideUse({ ref: op, usePath: 'RAW_RETENTION', at: at('2026-09-02T00:00:00Z') }),
      ).rejects.toMatchObject({ code: 'PROV_RIGHTS_VERIFICATION_EXPIRED' });
    } finally {
      await closeProvStack(stack);
    }
  });

  it('captured material stays refused after a tightening even when later versions loosen', async () => {
    const stack = await makeProvStack();
    try {
      const op = await seedRightsWorld(stack);
      // Material captured under v1 BEFORE the tightening lands.
      await stack.artifacts.registerArtifact({
        artifactId: 'art-bound',
        objectRef: 'obj://corpus/item-9',
        ref: op,
        rightsVersionAtCapture: 'v1',
        capturedAt: T0,
      });
      await stack.rights.recordChange({
        changeId: 'chg-tighten',
        ref: op,
        fromRightsVersion: 'v1',
        toRightsVersion: 'v2',
        changedAt: at('2026-08-15T00:00:00Z'),
        declaredBy: 'provider-relations',
        evidenceRefs: ['notice:official'],
      });
      // Captured under v1 (model use allowed), tightened by the v1→v2 change.
      await expect(
        stack.rights.decideUse({
          ref: op,
          usePath: 'MODEL_USE',
          at: at('2026-08-16T00:00:00Z'),
          capturedRightsVersion: 'v1',
          capturedAt: T0,
        }),
      ).rejects.toMatchObject({ code: 'PROV_RIGHTS_USE_PATH_PROHIBITED' });

      // A LOOSER v3 does NOT silently reactivate the captured material…
      await stack.rights.declare({
        ...V1,
        ref: op,
        rightsVersion: 'v3',
        modelTrainingAllowed: true,
        verifiedAt: at('2026-08-20T00:00:00Z'),
      });
      await expect(
        stack.rights.decideUse({
          ref: op,
          usePath: 'MODEL_USE',
          at: at('2026-08-21T00:00:00Z'),
          capturedRightsVersion: 'v1',
          capturedAt: T0,
        }),
      ).rejects.toMatchObject({ code: 'PROV_RIGHTS_USE_PATH_PROHIBITED' });

      // …but FRESH captures under v3 may use the path again.
      const freshCapture = await stack.rights.decideUse({
        ref: op,
        usePath: 'MODEL_USE',
        at: at('2026-08-21T00:00:00Z'),
        capturedRightsVersion: 'v3',
        capturedAt: at('2026-08-20T12:00:00Z'),
      });
      expect(freshCapture.allowed).toBe(true);

      // Explicit REVERIFICATION reactivates exactly the bound artifact.
      await stack.verifications.configureTtl({ configId: 'ttl-rights', kind: 'RIGHTS', ttlSeconds: 86_400 });
      await stack.verifications.recordVerification({
        ref: op,
        kind: 'RIGHTS',
        source: 'OFFICIAL_DOC',
        outcome: 'PASS',
        verifiedAt: at('2026-08-21T00:00:00Z'),
        evidenceRefs: ['e'],
        recordedBy: 'test',
        idempotencyKey: 'rights-refresh-1',
      });
      // Without reverification evidence the registry refuses outright.
      await expect(
        stack.artifacts.reactivate({
          artifactId: 'art-bound',
          actor: 'compliance',
          at: at('2026-08-21T06:00:00Z'),
          reverificationEvidenceRefs: [],
        }),
      ).rejects.toMatchObject({ code: 'PROV_RIGHTS_REACTIVATION_REVERIFICATION_REQUIRED' });
      await stack.artifacts.reactivate({
        artifactId: 'art-bound',
        actor: 'compliance',
        at: at('2026-08-21T06:00:00Z'),
        reverificationEvidenceRefs: ['reverify:model-use-review-77'],
      });
      const reactivated = await stack.rights.decideUse({
        ref: op,
        usePath: 'MODEL_USE',
        at: at('2026-08-21T06:00:00Z'),
        capturedRightsVersion: 'v1',
        capturedAt: T0,
        artifactId: 'art-bound',
      });
      expect(reactivated.allowed).toBe(true);
    } finally {
      await closeProvStack(stack);
    }
  });
});
