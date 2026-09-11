/** Append-only statistical incident seam (§68.12). */
import type { IncidentTrigger } from '@foresift/domain';

export interface EvaluationIncident {
  readonly incidentId: string;
  readonly trigger: IncidentTrigger;
  readonly affectedScope: string;
  readonly evidenceRefs: readonly string[];
  readonly openedAt: string;
  readonly influencePaused: true;
}

export class EvaluationIncidentLedger {
  readonly #incidents = new Map<string, EvaluationIncident>();

  open(input: Omit<EvaluationIncident, 'influencePaused'>): EvaluationIncident {
    const existing = this.#incidents.get(input.incidentId);
    if (existing) return existing;
    const incident = Object.freeze({
      ...input,
      evidenceRefs: Object.freeze([...new Set(input.evidenceRefs)].sort()),
      influencePaused: true as const,
    });
    this.#incidents.set(input.incidentId, incident);
    return incident;
  }

  list(): readonly EvaluationIncident[] {
    return [...this.#incidents.values()].sort((left, right) =>
      left.openedAt.localeCompare(right.openedAt),
    );
  }
}
