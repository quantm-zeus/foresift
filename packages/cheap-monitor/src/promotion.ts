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
    const existing = await this.engine.query<{ decision_json: unknown }>(
      'SELECT decision_json FROM disc.promotion_decisions WHERE inputs_hash=$1',
      [hash],
    );
    const row = existing.rows[0];
    if (row)
      return PromotionDecisionSchema.parse(
        typeof row.decision_json === 'string' ? JSON.parse(row.decision_json) : row.decision_json,
      );
    const decision = decidePromotion(input, this.now().toISOString());
    await this.engine.transaction(async (tx) => {
      await tx.query(
        'INSERT INTO disc.promotion_decisions (decision_id,candidate_id,inputs_hash,decision_version,decision_json,decided_at) VALUES ($1,$2,$3,$4,$5,$6)',
        [
          decision.decisionId,
          decision.candidateId,
          decision.inputsHash,
          decision.decisionVersion,
          JSON.stringify(decision),
          decision.decidedAt,
        ],
      );
      if (decision.decision === 'PROMOTE_TO_VERIFY')
        await tx.query(
          `UPDATE disc.cheap_monitor_rows SET state='PROMOTED_TO_VERIFY',row_json=jsonb_set(row_json,'{state}','"PROMOTED_TO_VERIFY"') WHERE candidate_id=$1`,
          [decision.candidateId],
        );
    });
    return decision;
  }
}
