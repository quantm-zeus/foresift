import { utcTimestamp, type UtcTimestamp } from '@foresift/domain';
export interface RetrievalClock {
  now(): UtcTimestamp;
}
export function systemRetrievalClock(): RetrievalClock {
  return { now: () => utcTimestamp(new Date().toISOString()) };
}
