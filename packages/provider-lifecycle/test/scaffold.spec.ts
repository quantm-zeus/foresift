/**
 * Package scaffold smoke test (same arrangement as the proven security
 * package): proves the entrypoint compiles, the typed-error vocabulary is
 * stable, and the lifecycle graph constants agree with the PRD's seven-state
 * model — before any deeper suite lands in this package.
 */
import { describe, expect, it } from 'vitest';
import {
  ADMISSIBLE_CAPABILITY_CLASSES,
  LifecycleStateSchema,
  PROHIBITED_CAPABILITY_CLASSES,
  ProvErrorCode,
  TRANSITION_REASON_CLASSES,
  VerificationKindSchema,
  isForesiftProviderError,
  ForesiftProviderError,
  RegistryError,
} from '../src/index.ts';
import {
  ALL_LIFECYCLE_STATES,
  LEGAL_TRANSITIONS,
  TERMINAL_STATES,
  isTransitionLegal,
  requireLegalTransition,
} from '../src/index.ts';
import { LifecycleTransitionError } from '../src/index.ts';

describe('provider-lifecycle scaffold (FR-PROV-001…010 substrate)', () => {
  it('exposes a stable machine-readable error-code vocabulary', () => {
    const codes = Object.values(ProvErrorCode);
    expect(codes.length).toBeGreaterThanOrEqual(40);
    for (const code of codes) {
      expect(code).toMatch(/^PROV_[A-Z0-9_]+$/);
    }
    // Spot anchors that later units depend on verbatim.
    expect(ProvErrorCode.PROV_TRANSITION_ILLEGAL).toBe('PROV_TRANSITION_ILLEGAL');
    expect(ProvErrorCode.PROV_REFRESH_PAIR_INCOMPLETE).toBe('PROV_REFRESH_PAIR_INCOMPLETE');
    expect(ProvErrorCode.PROV_MALICIOUS_RESPONSE_REJECTED).toBe(
      'PROV_MALICIOUS_RESPONSE_REJECTED',
    );
    expect(ProvErrorCode.PROV_DEPRECATED_NEW_USE_BLOCKED).toBe('PROV_DEPRECATED_NEW_USE_BLOCKED');
  });

  it('keeps the domain error shape with package-local codes', () => {
    // Subclass signature: (message, detail?, code?, options?) — the package
    // default code applies when none is passed.
    const error = new RegistryError(
      'no such provider',
      { providerId: 'x' },
      ProvErrorCode.PROV_PROVIDER_UNKNOWN,
    );
    expect(error).toBeInstanceOf(ForesiftProviderError);
    expect(error).toBeInstanceOf(Error);
    expect(error.code).toBe('PROV_PROVIDER_UNKNOWN');
    expect(error.detail).toEqual({ providerId: 'x' });
    expect(error.message).toContain('no such provider');
    expect(isForesiftProviderError(error)).toBe(true);
    expect(isForesiftProviderError(new Error('plain'))).toBe(false);

    const defaulted = new LifecycleTransitionError('edge refused');
    expect(defaulted.code).toBe(ProvErrorCode.PROV_TRANSITION_ILLEGAL);
  });

  it('pins the §12.11 state set and the legal transition graph', () => {
    expect(ALL_LIFECYCLE_STATES).toEqual([
      'DISCOVERED',
      'VERIFIED',
      'ACTIVE',
      'DEGRADED',
      'DEPRECATED',
      'BLOCKED',
      'REMOVED',
    ]);
    expect(TERMINAL_STATES).toEqual(['DEPRECATED', 'BLOCKED', 'REMOVED']);
    expect(LEGAL_TRANSITIONS).toHaveLength(7);
    expect(isTransitionLegal('DISCOVERED', 'VERIFIED')).toBe(true);
    expect(isTransitionLegal('DISCOVERED', 'ACTIVE')).toBe(false);
    expect(() => requireLegalTransition('BLOCKED', 'ACTIVE')).toThrow(LifecycleTransitionError);
    try {
      requireLegalTransition('REMOVED', 'ACTIVE');
      throw new Error('expected refusal');
    } catch (error) {
      expect(isForesiftProviderError(error)).toBe(true);
      expect((error as ForesiftProviderError).code).toBe(ProvErrorCode.PROV_TRANSITION_ILLEGAL);
    }
  });

  it('splits capability classes into admissible vs permanently prohibited', () => {
    // Nine READ_*/STREAM/QUOTE classes are representable; PROHIBITED_* never are.
    expect(ADMISSIBLE_CAPABILITY_CLASSES.every((c) => !c.startsWith('PROHIBITED_'))).toBe(true);
    expect(PROHIBITED_CAPABILITY_CLASSES.length).toBeGreaterThan(0);
    expect(PROHIBITED_CAPABILITY_CLASSES.every((c) => c.startsWith('PROHIBITED_'))).toBe(true);
    const all = LifecycleStateSchema.options;
    expect(all).toHaveLength(7);
  });

  it('pins the nine verification kinds', () => {
    expect(VerificationKindSchema.options).toEqual([
      'DOCUMENTATION',
      'PRICING_PLAN',
      'QUOTA',
      'RIGHTS',
      'SCHEMA',
      'ENDPOINT',
      'AUTHENTICATION',
      'DEPRECATION',
      'LIVE_PROBE',
    ]);
    expect(TRANSITION_REASON_CLASSES.length).toBe(19);
  });
});
