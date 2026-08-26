// AC-273 (acceptance): a rights tightening revokes use paths with full
// blast-radius accounting. Driven by
// tests/fixtures/prov/scenarios/rights-change.json: v2 → v3 revokes
// RAW_RETENTION/STORAGE/EXPORT; ACTIVE artifacts captured under v2 are
// RETIRED; live decisions follow the new declaration; CACHE stays allowed.
import { describe, expect, it } from 'vitest';
import type { UtcTimestamp } from '@foresift/domain';
import {
  atOffset,
  closeProvAcceptanceStack,
  makeProvAcceptanceStack,
  readProvFixture,
  seedAcOperation,
  T0,
} from '../helpers/prov.ts';

interface RightsScenario {
  readonly fromRightsVersion: string;
  readonly toRightsVersion: string;
  readonly fromDeclaration: Record<string, unknown>;
  readonly toDeclaration: Record<string, unknown>;
  readonly expectedNewlyProhibitedUses: string[];
  readonly expectedActionForCapturedArtifacts: string;
}

const CHANGE_AT = atOffset(60);

function declaration(
  op: { readonly providerId: string; readonly operationId: string; readonly version: string },
  fields: Record<string, unknown>,
  rightsVersion: string,
) {
  return {
    ref: op,
    rightsVersion,
    commercialUseAllowed: fields.commercialUseAllowed as boolean,
    personalResearchAllowed: fields.personalResearchAllowed as boolean,
    cacheAllowed: fields.cacheAllowed as boolean,
    maximumCacheDuration: (fields.maximumCacheDuration as string) ?? null,
    rawRetentionAllowed: fields.rawRetentionAllowed as boolean,
    derivedFeaturesAllowed: fields.derivedFeaturesAllowed as boolean,
    modelTrainingAllowed: fields.modelTrainingAllowed as boolean,
    redistributionAllowed: fields.redistributionAllowed as boolean,
    publicAlertDerivativeAllowed: fields.publicAlertDerivativeAllowed as boolean,
    attributionRequired: fields.attributionRequired as boolean,
    userByokRequired: fields.userByokRequired as boolean,
    rawExportAllowed: fields.rawExportAllowed as boolean,
    jurisdictionRestrictions: fields.jurisdictionRestrictions as string[],
    termsVersion: fields.termsVersion as string,
    verifiedAt: T0,
    verificationExpiresAt: '2027-01-01T00:00:00Z' as UtcTimestamp,
  };
}

describe('AC-273: rights tightening with blast-radius accounting', () => {
  it('v2→v3 export revocation retires captured artifacts and rebinds live decisions', async () => {
    const scenario = readProvFixture('scenarios/rights-change.json') as unknown as RightsScenario;
    const stack = await makeProvAcceptanceStack();
    try {
      const op = await seedAcOperation(stack);

      // v2 world: retention and export allowed.
      await stack.rights.declare(declaration(op, scenario.fromDeclaration, scenario.fromRightsVersion));
      const artifact = await stack.artifacts.registerArtifact({
        artifactId: 'art-ac273-captured-v2',
        objectRef: 'store://ac273/response-v2.json',
        ref: op,
        rightsVersionAtCapture: scenario.fromRightsVersion,
        capturedAt: T0,
      });
      expect(artifact.state).toBe('ACTIVE');

      // Record the tightening; the engine computes the diff + actions.
      await stack.rights.declare(declaration(op, scenario.toDeclaration, scenario.toRightsVersion));
      const change = await stack.rights.recordChange({
        changeId: 'chg-ac273',
        ref: op,
        fromRightsVersion: scenario.fromRightsVersion,
        toRightsVersion: scenario.toRightsVersion,
        changedAt: CHANGE_AT,
        declaredBy: 'operator',
        evidenceRefs: ['terms://provider/2026-07-update'],
      });
      expect([...change.newlyProhibitedUses].sort()).toEqual([
        ...scenario.expectedNewlyProhibitedUses,
      ].sort());

      // Captured artifact was retired by the recorded action.
      expect(scenario.expectedActionForCapturedArtifacts).toBe('RETIRE');
      const retired = await stack.artifacts.getArtifact('art-ac273-captured-v2');
      expect(retired.state).toBe('RETIRED');

      // Live decisions under v3 refuse the revoked paths…
      for (const [index, usePath] of ['RAW_RETENTION', 'STORAGE', 'EXPORT'].entries()) {
        await expect(
          stack.rights.decideUse({ ref: op, usePath: usePath as never, at: atOffset(61) }),
        ).rejects.toMatchObject({
          code: 'PROV_RIGHTS_USE_PATH_PROHIBITED',
          detail: { rightsVersion: scenario.toRightsVersion },
        });
        void index;
      }
      // …while CACHE remains allowed under its declared duration.
      const cacheDecision = await stack.rights.decideUse({
        ref: op,
        usePath: 'CACHE',
        at: atOffset(61),
      });
      expect(cacheDecision.allowed).toBe(true);
      expect(cacheDecision.maximumCacheDuration).toBe('PT5M');
    } finally {
      await closeProvAcceptanceStack(stack);
    }
  });

  it('fresh captures under v3 proceed normally while v2 material stays refused', async () => {
    const scenario = readProvFixture('scenarios/rights-change.json') as unknown as RightsScenario;
    const stack = await makeProvAcceptanceStack();
    try {
      const op = await seedAcOperation(stack);
      await stack.rights.declare(declaration(op, scenario.fromDeclaration, scenario.fromRightsVersion));
      await stack.artifacts.registerArtifact({
        artifactId: 'art-ac273-old',
        objectRef: 'store://ac273/old.json',
        ref: op,
        rightsVersionAtCapture: scenario.fromRightsVersion,
        capturedAt: T0,
      });
      await stack.rights.declare(declaration(op, scenario.toDeclaration, scenario.toRightsVersion));
      await stack.rights.recordChange({
        changeId: 'chg-ac273b',
        ref: op,
        fromRightsVersion: scenario.fromRightsVersion,
        toRightsVersion: scenario.toRightsVersion,
        changedAt: CHANGE_AT,
        declaredBy: 'operator',
        evidenceRefs: ['terms://provider/2026-07-update'],
      });
      const fresh = await stack.artifacts.registerArtifact({
        artifactId: 'art-ac273-new',
        objectRef: 'store://ac273/new.json',
        ref: op,
        rightsVersionAtCapture: scenario.toRightsVersion,
        capturedAt: atOffset(90),
      });
      expect(fresh.state).toBe('ACTIVE');
      // The fresh capture is bound to v3, where EXPORT is prohibited anyway —
      // but RAW_RETENTION refusal applies to BOTH captures alike.
      for (const artifactId of ['art-ac273-old', 'art-ac273-new']) {
        await expect(
          stack.rights.decideUse({
            ref: op,
            usePath: 'RAW_RETENTION',
            at: atOffset(91),
            capturedRightsVersion:
              artifactId === 'art-ac273-old' ? scenario.fromRightsVersion : scenario.toRightsVersion,
            capturedAt: artifactId === 'art-ac273-old' ? T0 : atOffset(90),
            artifactId,
          }),
        ).rejects.toMatchObject({ code: 'PROV_RIGHTS_USE_PATH_PROHIBITED' });
      }
    } finally {
      await closeProvAcceptanceStack(stack);
    }
  });

  it('reactivation of a retired artifact requires evidence plus a fresh RIGHTS pass', async () => {
    const scenario = readProvFixture('scenarios/rights-change.json') as unknown as RightsScenario;
    const stack = await makeProvAcceptanceStack();
    try {
      const op = await seedAcOperation(stack);
      await stack.rights.declare(declaration(op, scenario.fromDeclaration, scenario.fromRightsVersion));
      await stack.artifacts.registerArtifact({
        artifactId: 'art-ac273-reactivate',
        objectRef: 'store://ac273/reactivate.json',
        ref: op,
        rightsVersionAtCapture: scenario.fromRightsVersion,
        capturedAt: T0,
      });
      await stack.rights.declare(declaration(op, scenario.toDeclaration, scenario.toRightsVersion));
      await stack.rights.recordChange({
        changeId: 'chg-ac273c',
        ref: op,
        fromRightsVersion: scenario.fromRightsVersion,
        toRightsVersion: scenario.toRightsVersion,
        changedAt: CHANGE_AT,
        declaredBy: 'operator',
        evidenceRefs: ['terms://provider/2026-07-update'],
      });

      // No evidence ⇒ typed refusal.
      await expect(
        stack.artifacts.reactivate({
          artifactId: 'art-ac273-reactivate',
          actor: 'operator',
          at: atOffset(120),
          reverificationEvidenceRefs: [],
        }),
      ).rejects.toMatchObject({ code: 'PROV_RIGHTS_REACTIVATION_REVERIFICATION_REQUIRED' });

      // Evidence alone is not enough without a current RIGHTS PASS either —
      // record one now, then reactivate succeeds.
      await stack.verifications.configureTtl({ configId: 'ac273-rights', providerId: '*', kind: 'RIGHTS', ttlSeconds: 86_400 });
      for (const source of ['OFFICIAL_DOC', 'LIVE_CONTRACT'] as const) {
        await stack.verifications.recordVerification({
          ref: op,
          kind: 'RIGHTS',
          source,
          outcome: 'PASS',
          verifiedAt: atOffset(121),
          evidenceRefs: [`rights-pass:${source}`],
          recordedBy: 'acceptance',
          idempotencyKey: `ac273-rights:${source}`,
        });
      }
      const restored = await stack.artifacts.reactivate({
        artifactId: 'art-ac273-reactivate',
        actor: 'operator',
        at: atOffset(122),
        reverificationEvidenceRefs: ['reverification://ac273/manual-review'],
      });
      expect(restored.state).toBe('ACTIVE');
    } finally {
      await closeProvAcceptanceStack(stack);
    }
  });
});
