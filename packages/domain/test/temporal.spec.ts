import { describe, expect, it } from 'vitest';
import {
  ErrorCode,
  ForesiftError,
  availabilityProvenanceClass,
  compareForReplayResolution,
  compareTo,
  entryIsNotEarlierThanCounterfactual,
  isHistoricalFetch,
  isLiveReceipt,
  utcTimestamp,
  visibleAt,
  type ReplayOrderable,
} from '../src/index.ts';

const t = (s: string) => utcTimestamp(s);

describe('UTC timestamp policy (§13.1)', () => {
  it('accepts canonical UTC forms including fractional precision', () => {
    expect(utcTimestamp('2026-01-02T03:04:05Z')).toBe('2026-01-02T03:04:05Z');
    expect(utcTimestamp('2026-01-02T03:04:05.123456789Z')).toBe('2026-01-02T03:04:05.123456789Z');
    expect(isUtcLeapSecondAccepted()).toBe(true);
  });

  function isUtcLeapSecondAccepted(): boolean {
    try {
      utcTimestamp('2026-06-30T23:59:60Z');
      return true;
    } catch {
      return false;
    }
  }

  it('refuses non-UTC offsets and impossible calendar values fail-closed', () => {
    for (const bad of [
      '2026-01-02T03:04:05+01:00',
      '2026-01-02T03:04:05',
      '2026-13-01T00:00:00Z',
      '2026-02-30T00:00:00Z',
      '2026-01-02T24:00:00Z',
      '2027-02-29T00:00:00Z', // 2027 not a leap year
      '',
      'not-a-time',
    ]) {
      try {
        utcTimestamp(bad);
        expect.unreachable(`should refuse ${bad}`);
      } catch (e) {
        expect((e as ForesiftError).code).toBe(ErrorCode.TIMESTAMP_INVALID);
      }
    }
  });

  it('orders instants deterministically with precision retention', () => {
    const a = t('2026-01-01T00:00:00Z');
    const b = t('2026-01-01T00:00:00.5Z');
    const c = t('2026-01-01T00:00:00.75Z');
    expect(compareTo(a, b).before).toBe(true);
    expect(compareTo(b, c).before).toBe(true);
    expect(compareTo(c, b).after).toBe(true);
    expect(compareTo(a, a).atOrAfter).toBe(true);
    // Leap-day handling:
    expect(compareTo(t('2024-02-29T00:00:00Z'), t('2024-03-01T00:00:00Z')).before).toBe(true);
  });
});

describe('availability provenance classes (§13.2)', () => {
  it('resolves every declared class and refuses unknown ones without defaulting', () => {
    for (const cls of [
      'FIRST_PARTY_LIVE_OBSERVED',
      'PROVIDER_LIVE_RESPONSE',
      'AUTHORIZED_PUSH_RECEIVED',
      'HISTORICAL_QUERY_FETCHED_LATER',
      'MANUAL_IMPORT_AVAILABLE',
      'DERIVED_FROM_AVAILABLE_INPUTS',
      'LEARNED_ARTIFACT_PUBLISHED',
    ]) {
      expect(availabilityProvenanceClass(cls)).toBe(cls);
    }
    try {
      availabilityProvenanceClass('SOME_FUTURE_CLASS');
      expect.unreachable();
    } catch (e) {
      expect((e as ForesiftError).code).toBe(ErrorCode.AVAILABILITY_PROVENANCE_UNKNOWN);
    }
  });

  it('classifies live receipts vs historical fetches (no-backdating substrate)', () => {
    expect(isLiveReceipt('FIRST_PARTY_LIVE_OBSERVED')).toBe(true);
    expect(isLiveReceipt('PROVIDER_LIVE_RESPONSE')).toBe(true);
    expect(isLiveReceipt('AUTHORIZED_PUSH_RECEIVED')).toBe(true);
    expect(isLiveReceipt('HISTORICAL_QUERY_FETCHED_LATER')).toBe(false);
    expect(isHistoricalFetch('HISTORICAL_QUERY_FETCHED_LATER')).toBe(true);
    expect(isHistoricalFetch('FIRST_PARTY_LIVE_OBSERVED')).toBe(false);
  });
});

describe('replay-boundary predicate visibleAt (FR-DATA-003, AC-020)', () => {
  it('includes records available exactly at T (inclusive boundary)', () => {
    const T = t('2026-01-01T12:00:00Z');
    expect(visibleAt({ availableAt: T }, T)).toBe(true);
    expect(visibleAt({ availableAt: t('2026-01-01T11:59:59Z') }, T)).toBe(true);
    expect(visibleAt({ availableAt: t('2026-01-01T12:00:01Z') }, T)).toBe(false);
  });

  it('is anti-monotone in T: earlier-T visible sets are subsets of later-T sets (T011 property)', () => {
    // Deterministic PRNG (mulberry32) — no Math.random flake.
    let seed = 0x9e3779b9;
    const rand = (): number => {
      seed |= 0;
      seed = (seed + 0x6d2b79f5) | 0;
      let x = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x;
      return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
    };

    const base = Date.parse('2026-01-01T00:00:00Z');
    const instantAt = (minuteOffset: number): string =>
      new Date(base + minuteOffset * 60_000).toISOString().replace('.000Z', 'Z');

    // Random records across one day of instants.
    const records = Array.from({ length: 400 }, (_, i) => ({
      id: `r${i}`,
      availableAt: t(instantAt(Math.floor(rand() * 1440))),
    }));

    // For every pair of boundaries T1 <= T2: visible(T1) ⊆ visible(T2).
    const boundaryMinutes = [0, 137, 600, 601, 1439];
    const minute = (i: number): number => {
      const v = boundaryMinutes[i];
      if (v === undefined) throw new RangeError('boundary missing');
      return v;
    };
    for (let bi = 1; bi < boundaryMinutes.length; bi += 1) {
      const T1 = t(instantAt(minute(bi - 1)));
      const T2 = t(instantAt(minute(bi)));
      const visibleEarlier = new Set(records.filter((r) => visibleAt(r, T1)).map((r) => r.id));
      const visibleLater = new Set(records.filter((r) => visibleAt(r, T2)).map((r) => r.id));
      expect(visibleLater.size).toBeGreaterThanOrEqual(visibleEarlier.size);
      for (const id of visibleEarlier) expect(visibleLater.has(id)).toBe(true);
    }
  });

  it('resolves ties deterministically: latest availability, highest revision, stable key', () => {
    const mk = (availableAt: string, revisionNo: number, key: string): ReplayOrderable => ({
      availableAt: t(availableAt),
      ...(revisionNo >= 0 ? { revisionNo } : {}),
      stableKey: key,
    });
    const candidates = [
      mk('2026-01-01T00:00:00Z', 1, 'a'),
      mk('2026-01-01T00:00:00Z', 3, 'b'),
      mk('2026-01-01T00:00:00Z', 2, 'c'),
      mk('2025-12-31T23:59:59Z', -1, 'd'), // no revision number
    ];
    const sorted = [...candidates].sort(compareForReplayResolution);
    expect(sorted.map((c) => c.stableKey)).toEqual(['b', 'c', 'a', 'd']);
  });
});

describe('symmetric action-time substrate (AC-240)', () => {
  it('rejects non-delivered arms entering earlier than counterfactual delivery', () => {
    const counterfactual = t('2026-01-01T10:00:00Z');
    expect(entryIsNotEarlierThanCounterfactual(t('2026-01-01T10:00:00Z'), counterfactual)).toBe(
      true,
    );
    expect(entryIsNotEarlierThanCounterfactual(t('2026-01-01T09:59:59Z'), counterfactual)).toBe(
      false,
    );
    expect(entryIsNotEarlierThanCounterfactual(t('2026-01-01T10:00:01Z'), counterfactual)).toBe(
      true,
    );
  });
});
