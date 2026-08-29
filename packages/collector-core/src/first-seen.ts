import type { DatabaseEngine } from '@foresift/persistence';
import { FirstSeenLatencySpansSchema, type FirstSeenLatencySpans } from '@foresift/shared-schemas';
export function recordCollectorFirstSeen(input: FirstSeenLatencySpans): FirstSeenLatencySpans {
  const parsed = FirstSeenLatencySpansSchema.parse(input);
  if (!parsed.scopeVerified) throw new Error('UNVERIFIED_SCOPE_TIMING_REFERENCE');
  return parsed;
}
export async function persistCollectorFirstSeen(
  engine: DatabaseEngine,
  input: FirstSeenLatencySpans,
): Promise<void> {
  const span = recordCollectorFirstSeen(input);
  await engine.query(
    'INSERT INTO col.collector_first_seen_spans (subject_id,scope_id,recorded_at,spans_json) VALUES ($1,$2,$3,$4)',
    [span.subjectId, span.scopeId, span.recordedAt, JSON.stringify(span)],
  );
}
export function latencyDecomposition(
  span: FirstSeenLatencySpans,
): Readonly<Record<string, number | null>> {
  const duration = (a: string, b: string | null) =>
    b === null ? null : Date.parse(b) - Date.parse(a);
  return {
    sourceToReceiptMs: duration(span.sourceEventAt, span.collectorReceiptAt),
    receiptToProviderMs: duration(span.collectorReceiptAt, span.providerAvailableAt),
    providerToFeatureMs: duration(
      span.providerAvailableAt ?? span.collectorReceiptAt,
      span.featureReadyAt,
    ),
    featureToDecisionMs: duration(
      span.featureReadyAt ?? span.collectorReceiptAt,
      span.decisionReadyAt,
    ),
    decisionToDeliveryMs: duration(
      span.decisionReadyAt ?? span.collectorReceiptAt,
      span.deliveredAt,
    ),
  };
}
