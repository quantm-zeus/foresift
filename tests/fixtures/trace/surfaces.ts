/**
 * Surface file shape fixtures for docs/generated/<family>-surfaces.json.
 */

export interface SurfaceFile {
  readonly family: string;
  readonly surfaceRefs: readonly string[];
  readonly implementationRefs: readonly string[];
  readonly testRefs: readonly string[];
  readonly telemetryRefs: readonly string[];
  readonly schemaRefs: readonly string[];
}

export const VALID_TRACE_SURFACE_FIXTURE: SurfaceFile = {
  family: 'FR-TRACE',
  surfaceRefs: ['docs/generated/trace-surfaces.json'],
  implementationRefs: [
    'packages/requirement-manifest/** @requirement FR-TRACE-001',
    'packages/requirement-manifest/** @requirement FR-TRACE-002',
    'packages/requirement-manifest/** @requirement FR-TRACE-003',
    'packages/requirement-manifest/** @requirement FR-TRACE-004',
    'packages/requirement-manifest/** @requirement FR-TRACE-005',
    'packages/requirement-manifest/** @requirement FR-TRACE-006',
    'packages/release-conformance/** @requirement FR-TRACE-001',
    'packages/release-conformance/** @requirement FR-TRACE-002',
    'packages/release-conformance/** @requirement FR-TRACE-003',
    'packages/release-conformance/** @requirement FR-TRACE-004',
    'packages/release-conformance/** @requirement FR-TRACE-005',
    'packages/release-conformance/** @requirement FR-TRACE-006',
  ],
  testRefs: [
    'tests/acceptance/AC-265.spec.ts',
    'tests/negative/AC-265.negative.spec.ts',
    'tests/acceptance/AC-266.spec.ts',
    'tests/negative/AC-266.negative.spec.ts',
    'tests/acceptance/AC-267.spec.ts',
    'tests/negative/AC-267.negative.spec.ts',
    'tests/acceptance/AC-268.spec.ts',
    'tests/negative/AC-268.negative.spec.ts',
    'tests/acceptance/AC-269.spec.ts',
    'tests/negative/AC-269.negative.spec.ts',
  ],
  telemetryRefs: ['telemetry/trace.*'],
  schemaRefs: ['packages/shared-schemas/src/trace.ts'],
};

export const DRIFTED_TRACE_SURFACE_FIXTURE: SurfaceFile = {
  ...VALID_TRACE_SURFACE_FIXTURE,
  implementationRefs: ['packages/outdated-path/**'],
};
