import { canonicalJson, sha256Text } from '@foresift/persistence';
import type { ProgramDecoder, RawProgramEvent } from './decoder-registry.ts';
export interface GoldenVector {
  readonly vectorId: string;
  readonly input: RawProgramEvent;
  readonly expectedCanonical: string;
  readonly adversarial: boolean;
}
export interface QuoteParityCase {
  readonly caseId: string;
  readonly notional: string;
  readonly observedOutput: string;
  readonly referenceOutput: string;
  readonly toleranceBps: number;
}
export interface ParityResult {
  readonly decoderVersion: string;
  readonly decoderHash: string;
  readonly vectorsPassed: number;
  readonly vectorsFailed: readonly string[];
  readonly quoteCasesFailed: readonly string[];
  readonly resultHash: string;
  readonly passed: boolean;
}
function withinTolerance(c: QuoteParityCase): boolean {
  const actual = BigInt(c.observedOutput),
    expected = BigInt(c.referenceOutput);
  if (expected === 0n) return actual === 0n;
  return (
    (actual > expected ? actual - expected : expected - actual) * 10000n <=
    expected * BigInt(c.toleranceBps)
  );
}
export function runParityHarness(
  decoder: ProgramDecoder,
  vectors: readonly GoldenVector[],
  quotes: readonly QuoteParityCase[],
  expectedDecoderHash: string,
): ParityResult {
  const vectorFailures: string[] = [];
  for (const v of vectors) {
    try {
      if (canonicalJson(decoder.decode(v.input)) !== v.expectedCanonical)
        vectorFailures.push(v.vectorId);
    } catch {
      if (!v.adversarial) vectorFailures.push(v.vectorId);
    }
  }
  const quoteFailures = quotes.filter((q) => !withinTolerance(q)).map((q) => q.caseId);
  if (decoder.decoderHash !== expectedDecoderHash) vectorFailures.push('DECODER_HASH_MISMATCH');
  const result = {
    decoderVersion: decoder.decoderVersion,
    decoderHash: decoder.decoderHash,
    vectorsPassed:
      vectors.length - vectorFailures.filter((x) => x !== 'DECODER_HASH_MISMATCH').length,
    vectorsFailed: vectorFailures,
    quoteCasesFailed: quoteFailures,
    passed: vectorFailures.length === 0 && quoteFailures.length === 0,
  };
  return { ...result, resultHash: sha256Text(canonicalJson(result)) };
}
export function detectUpgradeChange(input: {
  manifestLayoutHash: string;
  observedLayoutHash: string;
  manifestDecoderHash: string;
  decoderHash: string;
}): readonly string[] {
  const findings: string[] = [];
  if (input.manifestLayoutHash !== input.observedLayoutHash)
    findings.push('IDL_OR_LAYOUT_HASH_MISMATCH');
  if (input.manifestDecoderHash !== input.decoderHash) findings.push('DECODER_HASH_MISMATCH');
  return findings;
}
