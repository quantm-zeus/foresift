import { ErrorCode, isForesiftError, utcTimestamp, type UtcTimestamp } from '@foresift/domain';
import { recordCanonicalEvent, type DatabaseEngine } from '@foresift/persistence';
export interface DedupCounters {
  incrementReceived(): void | Promise<void>;
  incrementDuplicate(): void | Promise<void>;
  incrementAccepted(): void | Promise<void>;
}
export function canonicalEventKey(input: {
  chainId: string;
  slot: number;
  transactionSignature: string;
  instructionIndex: number | null;
  innerInstructionIndex: number | null;
  logIndex: number | null;
  normalizedEventHash: string;
}): string {
  return [
    input.chainId,
    input.slot,
    input.transactionSignature,
    input.instructionIndex ?? '-',
    input.innerInstructionIndex ?? '-',
    input.logIndex ?? '-',
    input.normalizedEventHash,
  ].join(':');
}
export class DuplicateAbsorber {
  constructor(
    private readonly engine: DatabaseEngine,
    private readonly counters: DedupCounters,
  ) {}
  async absorb(
    input: Parameters<typeof canonicalEventKey>[0] & {
      eventFamily: string;
      firstSeenAt?: UtcTimestamp;
    },
  ): Promise<'ACCEPTED' | 'DUPLICATE'> {
    await this.counters.incrementReceived();
    try {
      await recordCanonicalEvent(this.engine, {
        canonicalKey: canonicalEventKey(input),
        eventFamily: input.eventFamily,
        firstSeenAt: input.firstSeenAt ?? utcTimestamp(new Date().toISOString()),
      });
      await this.counters.incrementAccepted();
      return 'ACCEPTED';
    } catch (error) {
      if (isForesiftError(error) && error.code === ErrorCode.CANONICAL_EVENT_DUPLICATE) {
        await this.counters.incrementDuplicate();
        return 'DUPLICATE';
      }
      throw error;
    }
  }
}
