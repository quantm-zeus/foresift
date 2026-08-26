// AC-273 (negative): rights enforcement fails closed — absent declarations
// refuse, expired verifications refuse, tightening history keeps captured
// material refused across later loosening, empty diffs are refused, and
// reactivation without a fresh RIGHTS pass stays closed even with evidence.
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
import { ProvErrorCode } from '../../packages/provider-lifecycle/src/index.ts';

const CHANGE_AT = atOffset(60);

function declaration(
  op: { readonly providerId: string; readonly operationId: string; readonly version: string },
  fields: Record<string, unknown>,
  rightsVersion: string,
  window?: { readonly verifiedAt: UtcTimestamp; readonly verificationExpiresAt: UtcTimestamp },
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
    verifiedAt: window?.verifiedAt ?? T0,
    verificationExpiresAt: window?.verificationExpiresAt ?? ('2027-01-01T00:00:00Z' as UtcTimestamp),
  };
}

interface RightsScenario {
  readonly fromRightsVersion: string;
  readonly toRightsVersion: string;
  readonly fromDeclaration: Record<string, unknown>;
  readonly toDeclaration: Record<string, unknown>;
}

describe('AC-273 negative: use-path decisions refuse every open question', () => {
  it('no declaration at all ⇒ PROV_RIGHTS_VERSION_UNKNOWN on every use path', async () => {
    const stack = await makeProvAcceptanceStack();
    try {
      const op = await seedAcOperation(stack);
      await expect(
        stack.rights.decideUse({ ref: op, usePath: 'CACHE', at: T0 }),
      ).rejects.toMatchObject({ code: ProvErrorCode.PROV_RIGHTS_VERSION_UNKNOWN });
      await expect(
        stack.rights.decideUse({ ref: op, usePath: 'MODEL_USE', at: T0 }),
      ).rejects.toMatchObject({ code: ProvErrorCode.PROV_RIGHTS_VERSION_UNKNOWN });
    } finally {
      await closeProvAcceptanceStack(stack);
    }
  });

  it('expired rights verification refuses fail-closed until re-verified', async () => {
    const stack = await makeProvAcceptanceStack();
    try {
      const scenario = readProvFixture('scenarios/rights-change.json') as unknown as RightsScenario;
      const op = await seedAcOperation(stack);
      await stack.rights.declare(
        declaration(op, scenario.fromDeclaration, scenario.fromRightsVersion, {
          verifiedAt: T0,
          verificationExpiresAt: atOffset(10),
        }),
      );
      await expect(
        stack.rights.decideUse({ ref: op, usePath: 'CACHE', at: atOffset(11) }),
      ).rejects.toMatchObject({ code: ProvErrorCode.PROV_RIGHTS_VERIFICATION_EXPIRED });
    } finally {
      await closeProvAcceptanceStack(stack);
    }
  });

  it('a later LOOSENING never restores material tightened after capture', async () => {
    const scenario = readProvFixture('scenarios/rights-change.json') as unknown as RightsScenario;
    const stack = await makeProvAcceptanceStack();
    try {
      const op = await seedAcOperation(stack);
      // v2 (loose) → capture → tighten to v3 → loosen back to v4 (retention allowed again).
      await stack.rights.declare(declaration(op, scenario.fromDeclaration, scenario.fromRightsVersion));
      await stack.artifacts.registerArtifact({
        artifactId: 'art-neg273',
        objectRef: 'store://neg273/captured.json',
        ref: op,
        rightsVersionAtCapture: scenario.fromRightsVersion,
        capturedAt: T0,
      });
      await stack.rights.declare(declaration(op, scenario.toDeclaration, scenario.toRightsVersion));
      await stack.rights.recordChange({
        changeId: 'chg-tighten',
        ref: op,
        fromRightsVersion: scenario.fromRightsVersion,
        toRightsVersion: scenario.toRightsVersion,
        changedAt: CHANGE_AT,
        declaredBy: 'operator',
        evidenceRefs: ['terms://2026-07'],
      });
      const loosenedFields = { ...scenario.fromDeclaration };
      await stack.rights.declare(
        declaration(op, loosenedFields, 'terms-v4-loose', {
          verifiedAt: atOffset(90),
          verificationExpiresAt: '2027-01-01T00:00:00Z' as UtcTimestamp,
        }),
      );
      // Loosening is NOT recordable as a change: changes exist to record
      // tightenings (their blast-radius machinery); a no-new-prohibition diff
      // refuses so the tightening history cannot be diluted.
      await expect(
        stack.rights.recordChange({
          changeId: 'chg-loosen',
          ref: op,
          fromRightsVersion: scenario.toRightsVersion,
          toRightsVersion: 'terms-v4-loose',
          changedAt: atOffset(95),
          declaredBy: 'operator',
          evidenceRefs: ['terms://2026-08'],
        }),
      ).rejects.toMatchObject({ code: ProvErrorCode.PROV_DEFINITION_INVALID });

      // Live RAW_RETENTION is allowed AGAIN under v4…
      const liveDecision = await stack.rights.decideUse({
        ref: op,
        usePath: 'RAW_RETENTION',
        at: atOffset(96),
      });
      expect(liveDecision.allowed).toBe(true);

      // …but the v2-captured artifact stays REFUSED: the tightening that hit
      // it after capture is history, and no silent reactivation exists.
      await expect(
        stack.rights.decideUse({
          ref: op,
          usePath: 'RAW_RETENTION',
          at: atOffset(96),
          capturedRightsVersion: scenario.fromRightsVersion,
          capturedAt: T0,
          artifactId: 'art-neg273',
        }),
      ).rejects.toMatchObject({ code: ProvErrorCode.PROV_RIGHTS_USE_PATH_PROHIBITED });

      // Reactivation with evidence but NO fresh RIGHTS pass stays closed.
      await expect(
        stack.artifacts.reactivate({
          artifactId: 'art-neg273',
          actor: 'operator',
          at: atOffset(97),
          reverificationEvidenceRefs: ['reverification://neg273/attempted'],
        }),
      ).rejects.toMatchObject({
        code: ProvErrorCode.PROV_RIGHTS_REACTIVATION_REVERIFICATION_REQUIRED,
      });
    } finally {
      await closeProvAcceptanceStack(stack);
    }
  });

  it('recording a change between identical declarations is refused (empty diff)', async () => {
    const stack = await makeProvAcceptanceStack();
    try {
      const scenario = readProvFixture('scenarios/rights-change.json') as unknown as RightsScenario;
      const op = await seedAcOperation(stack);
      await stack.rights.declare(declaration(op, scenario.fromDeclaration, scenario.fromRightsVersion));
      await stack.rights.declare(
        declaration(op, scenario.fromDeclaration, `${scenario.fromRightsVersion}-copy`),
      );
      await expect(
        stack.rights.recordChange({
          changeId: 'chg-empty-diff',
          ref: op,
          fromRightsVersion: scenario.fromRightsVersion,
          toRightsVersion: `${scenario.fromRightsVersion}-copy`,
          changedAt: CHANGE_AT,
          declaredBy: 'operator',
          evidenceRefs: ['terms://none'],
        }),
      ).rejects.toMatchObject({ code: ProvErrorCode.PROV_DEFINITION_INVALID });
    } finally {
      await closeProvAcceptanceStack(stack);
    }
  });
});
