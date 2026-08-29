import { canonicalJson, sha256Text, type DatabaseEngine } from '@foresift/persistence';
import { PromotionDecisionSchema, type PromotionDecision } from '@foresift/shared-schemas';
export interface FrozenPromotionInputs {
  readonly candidateId: string;
  readonly frozenFeatures: Readonly<Record<string, string | number | boolean | null>>;
  readonly featureVersions: Readonly<Record<string, string>>;
  readonly policyVersion: string;
  readonly decisionVersion: string;
  readonly persistenceEligible: boolean;
  readonly changeEligible: boolean;
  readonly executionEligible: boolean;
  readonly securityEligible: boolean;
}
export function promotionInputsHash(input: FrozenPromotionInputs): string {
  return sha256Text(canonicalJson(input));
}
export function decidePromotion(
  input: FrozenPromotionInputs,
  decidedAt: string,
): PromotionDecision {
  const eligible =
    input.persistenceEligible &&
    input.changeEligible &&
    input.executionEligible &&
    input.securityEligible;
  const inputsHash = promotionInputsHash(input);
  return PromotionDecisionSchema.parse({
    decisionId: `promotion:${inputsHash}`,
    candidateId: input.candidateId,
    policyVersion: input.policyVersion,
    featureSnapshotVersion: sha256Text(
      canonicalJson({ features: input.frozenFeatures, versions: input.featureVersions }),
    ),
    inputsHash,
    decisionVersion: input.decisionVersion,
    decision: eligible ? 'PROMOTE_TO_VERIFY' : 'MONITOR_CHEAP',
    rationale: eligible
      ? 'all persistence, change, execution, and security gates passed'
      : 'one or more eligibility gates did not pass',
    decidedAt,
  });
}
export class PromotionStore {
  constructor(
    private readonly engine: DatabaseEngine,
    private readonly now: () => Date = () => new Date(),
  ) {}
  async decide(input: FrozenPromotionInputs): Promise<PromotionDecision> {
    const hash = promotionInputsHash(input);
    const decision = decidePromotion(input, this.now().toISOString());
    return this.engine.transaction(async (tx) => {
      await tx.query(
        `INSERT INTO disc.promotion_decisions (
          promotion_decision_id,candidate_id,frozen_feature_versions,policy_version,
          inputs_hash,decision,decided_at,decision_version
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
        ON CONFLICT (inputs_hash) DO NOTHING`,
        [
          decision.decisionId,
          decision.candidateId,
          JSON.stringify({
            features: input.frozenFeatures,
            featureVersions: input.featureVersions,
            featureSnapshotVersion: decision.featureSnapshotVersion,
          }),
          decision.policyVersion,
          decision.inputsHash,
          decision.decision,
          decision.decidedAt,
          decision.decisionVersion,
        ],
      );
      if (decision.decision === 'PROMOTE_TO_VERIFY')
        await tx.query(
          `UPDATE disc.cheap_monitor_rows
           SET state='PROMOTED_TO_VERIFY',updated_at=$2 WHERE candidate_id=$1`,
          [decision.candidateId, decision.decidedAt],
        );
      const stored = await tx.query<{
        promotion_decision_id: string;
        candidate_id: string;
        frozen_feature_versions: unknown;
        policy_version: string;
        inputs_hash: string;
        decision: PromotionDecision['decision'];
        decided_at: string | Date;
        decision_version: string;
      }>(
        `SELECT promotion_decision_id,candidate_id,frozen_feature_versions,policy_version,
                inputs_hash,decision,decided_at,decision_version
         FROM disc.promotion_decisions WHERE inputs_hash=$1`,
        [hash],
      );
      const row = stored.rows[0];
      if (!row) throw new Error('PROMOTION_DECISION_PERSISTENCE_FAILED');
      const frozen =
        typeof row.frozen_feature_versions === 'string'
          ? (JSON.parse(row.frozen_feature_versions) as { featureSnapshotVersion?: string })
          : (row.frozen_feature_versions as { featureSnapshotVersion?: string });
      return PromotionDecisionSchema.parse({
        decisionId: row.promotion_decision_id,
        candidateId: row.candidate_id,
        policyVersion: row.policy_version,
        featureSnapshotVersion: frozen.featureSnapshotVersion ?? decision.featureSnapshotVersion,
        inputsHash: row.inputs_hash,
        decisionVersion: row.decision_version,
        decision: row.decision,
        rationale:
          row.decision === 'PROMOTE_TO_VERIFY'
            ? 'all persistence, change, execution, and security gates passed'
            : 'one or more eligibility gates did not pass',
        decidedAt: row.decided_at instanceof Date ? row.decided_at.toISOString() : row.decided_at,
      });
    });
  }
}
