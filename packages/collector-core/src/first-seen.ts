import { FirstSeenLatencySpansSchema, type FirstSeenLatencySpans } from '@foresift/shared-schemas';
export function recordCollectorFirstSeen(input: FirstSeenLatencySpans): FirstSeenLatencySpans {
  const parsed = FirstSeenLatencySpansSchema.parse(input);
  if (!parsed.isFirstPartyVerifiedScope) throw new Error('UNVERIFIED_SCOPE_TIMING_REFERENCE');
  return parsed;
}
export function latencyDecomposition(
  span: FirstSeenLatencySpans,
): Readonly<Record<string, number>> {
  return {
    eventToCollectorMs: span.eventToCollectorMs,
    collectorToFeatureMs: span.collectorToFeatureMs,
    featureToDecisionMs: span.featureToDecisionMs,
    decisionToDeliveryMs: span.decisionToDeliveryMs,
    providerComparisonMs: span.providerComparisonMs,
  };
}
