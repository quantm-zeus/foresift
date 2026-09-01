/**
 * Pinned manifest excerpt fixtures copied from the authoritative PRD manifest
 * (docs/spec/crypto_intelligence_agent_gateway_PRD_FINAL_v6.0.requirements.json).
 * Used by acceptance and unit tests to verify manifest parsing, hashing, and integrity.
 */

export interface RequirementExcerpt {
  readonly id: string;
  readonly family: string;
  readonly line: number;
  readonly text: string;
  readonly textSha256: string;
  readonly dependencyGroup: string;
  readonly owner: string;
  readonly implementationRefs: readonly string[];
  readonly schemaRefs: readonly string[];
  readonly persistenceRefs: readonly string[];
  readonly apiToolUiRefs: readonly string[];
  readonly telemetryRefs: readonly string[];
  readonly fixtureRefs: readonly string[];
  readonly testRefs: readonly string[];
  readonly activationGateRefs: readonly string[];
  readonly rollbackRefs: readonly string[];
}

export interface AcceptanceCriterionExcerpt {
  readonly id: string;
  readonly line: number;
  readonly text: string;
  readonly textSha256: string;
  readonly requirementRefs: readonly string[];
  readonly positiveTestRef: string;
  readonly negativeOrFailureTestRef: string;
  readonly evidenceOwner: string;
}

export const PINNED_DOCUMENT_SHA256 = 'baa521d9c67e67a86d7ddb111c793b67462ed4c7acc89cec34ab9f5ade077299';
export const PINNED_NORMALIZED_SHA256 = '1f9b6590c8331dd52ae63c51a93e8e6b631b3a70c37df3e619486e1779e2db8e';
export const PINNED_MANIFEST_SHA256 = 'e0f9f1284473fe097fde591138d16984ae8580feaf13333e22594717eec690ff';
export const PINNED_AUDIT_SHA256 = 'ab4be13b6aeac998f13daa89ae08f4b9f5d6280b4018bd171b7b128b412a47f8';

export const PINNED_FR_TRACE_REQUIREMENTS: readonly RequirementExcerpt[] = [
  {
    id: 'FR-TRACE-001',
    family: 'FR-TRACE',
    line: 6506,
    text: 'A machine-readable requirement manifest is generated from this PRD and is the release-blocking source for every requirement, acceptance criterion, invariant, ADR, dependency group, implementation owner, schema, test, surface, telemetry, and activation/rollback mapping.',
    textSha256: '70ed69312044dd82404119ed56df297e3575db4bd66a17747eefde3892eeddf4',
    dependencyGroup: 'G0',
    owner: 'packages/requirement-manifest',
    implementationRefs: [
      'packages/requirement-manifest/** @requirement FR-TRACE-001',
      'packages/release-conformance/** @requirement FR-TRACE-001',
    ],
    schemaRefs: ['packages/shared-schemas/src/trace.ts'],
    persistenceRefs: ['migrations/g0_trace_*.sql'],
    apiToolUiRefs: ['docs/generated/trace-surfaces.json'],
    telemetryRefs: ['telemetry/trace.*'],
    fixtureRefs: ['tests/fixtures/trace/'],
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
    activationGateRefs: ['dependency-group:G0', 'Section 9.5', 'Section 40', 'Section 46'],
    rollbackRefs: ['FR-PROD-012', 'AC-279', 'Section 85.6'],
  },
  {
    id: 'FR-TRACE-002',
    family: 'FR-TRACE',
    line: 6507,
    text: 'Requirement, acceptance, invariant, ADR, feature, schema, API, tool, policy, artifact, and test IDs are globally unique, stable, immutable once released, and replaced only through explicit deprecation/supersession links.',
    textSha256: '0c1a96b5c59ba06dc3d5b4e4b30d0b3854f16130160ad5f1ac67f69e3f5f6c8a',
    dependencyGroup: 'G0',
    owner: 'packages/requirement-manifest',
    implementationRefs: [
      'packages/requirement-manifest/** @requirement FR-TRACE-002',
      'packages/release-conformance/** @requirement FR-TRACE-002',
    ],
    schemaRefs: ['packages/shared-schemas/src/trace.ts'],
    persistenceRefs: ['migrations/g0_trace_*.sql'],
    apiToolUiRefs: ['docs/generated/trace-surfaces.json'],
    telemetryRefs: ['telemetry/trace.*'],
    fixtureRefs: ['tests/fixtures/trace/'],
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
    activationGateRefs: ['dependency-group:G0', 'Section 9.5', 'Section 40', 'Section 46'],
    rollbackRefs: ['FR-PROD-012', 'AC-279', 'Section 85.6'],
  },
  {
    id: 'FR-TRACE-003',
    family: 'FR-TRACE',
    line: 6508,
    text: 'CI fails when a normative item lacks implementation/test/owner mapping, a mapped code path no longer exists, a requirement is implemented outside its dependency gate, or generated documentation differs from the manifest.',
    textSha256: 'd0eb11f38180ed53fdf9217c542fc34eed2d4ed052f5d99656f58d5ee2580619',
    dependencyGroup: 'G0',
    owner: 'packages/requirement-manifest',
    implementationRefs: [
      'packages/requirement-manifest/** @requirement FR-TRACE-003',
      'packages/release-conformance/** @requirement FR-TRACE-003',
    ],
    schemaRefs: ['packages/shared-schemas/src/trace.ts'],
    persistenceRefs: ['migrations/g0_trace_*.sql'],
    apiToolUiRefs: ['docs/generated/trace-surfaces.json'],
    telemetryRefs: ['telemetry/trace.*'],
    fixtureRefs: ['tests/fixtures/trace/'],
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
    activationGateRefs: ['dependency-group:G0', 'Section 9.5', 'Section 40', 'Section 46'],
    rollbackRefs: ['FR-PROD-012', 'AC-279', 'Section 85.6'],
  },
  {
    id: 'FR-TRACE-004',
    family: 'FR-TRACE',
    line: 6509,
    text: 'Manual, legal, rights, statistical, and owner-approval gates produce signed/hashed evidence artifacts with approver, scope, expiration, and revocation semantics rather than unchecked booleans.',
    textSha256: '4463b56fa7552c29035c902ab400461b46bfa2667c0b5a267e9ea5da1943bc30',
    dependencyGroup: 'G0',
    owner: 'packages/requirement-manifest',
    implementationRefs: [
      'packages/requirement-manifest/** @requirement FR-TRACE-004',
      'packages/release-conformance/** @requirement FR-TRACE-004',
    ],
    schemaRefs: ['packages/shared-schemas/src/trace.ts'],
    persistenceRefs: ['migrations/g0_trace_*.sql'],
    apiToolUiRefs: ['docs/generated/trace-surfaces.json'],
    telemetryRefs: ['telemetry/trace.*'],
    fixtureRefs: ['tests/fixtures/trace/'],
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
    activationGateRefs: ['dependency-group:G0', 'Section 9.5', 'Section 40', 'Section 46'],
    rollbackRefs: ['FR-PROD-012', 'AC-279', 'Section 85.6'],
  },
  {
    id: 'FR-TRACE-005',
    family: 'FR-TRACE',
    line: 6510,
    text: 'Every production decision and alert stores the exact requirement/policy/feature/model/tool/provider/adapter/artifact versions and test/conformance release that authorized its behavior.',
    textSha256: '2fda5324d5b98c02becfcf6dde73b705f3d1fa2d6cd6167ba5a0390090a64547',
    dependencyGroup: 'G0',
    owner: 'packages/requirement-manifest',
    implementationRefs: [
      'packages/requirement-manifest/** @requirement FR-TRACE-005',
      'packages/release-conformance/** @requirement FR-TRACE-005',
    ],
    schemaRefs: ['packages/shared-schemas/src/trace.ts'],
    persistenceRefs: ['migrations/g0_trace_*.sql'],
    apiToolUiRefs: ['docs/generated/trace-surfaces.json'],
    telemetryRefs: ['telemetry/trace.*'],
    fixtureRefs: ['tests/fixtures/trace/'],
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
    activationGateRefs: ['dependency-group:G0', 'Section 9.5', 'Section 40', 'Section 46'],
    rollbackRefs: ['FR-PROD-012', 'AC-279', 'Section 85.6'],
  },
  {
    id: 'FR-TRACE-006',
    family: 'FR-TRACE',
    line: 6511,
    text: 'Release reports include document hash, manifest hash, migration/schema hashes, dependency/SBOM hash, conformance results, unresolved deviations, activation state, and rollback target.',
    textSha256: '8ff8d244cce361e21a45e6810130da4484371301820347e908dc27fc6888eb24',
    dependencyGroup: 'G0',
    owner: 'packages/requirement-manifest',
    implementationRefs: [
      'packages/requirement-manifest/** @requirement FR-TRACE-006',
      'packages/release-conformance/** @requirement FR-TRACE-006',
    ],
    schemaRefs: ['packages/shared-schemas/src/trace.ts'],
    persistenceRefs: ['migrations/g0_trace_*.sql'],
    apiToolUiRefs: ['docs/generated/trace-surfaces.json'],
    telemetryRefs: ['telemetry/trace.*'],
    fixtureRefs: ['tests/fixtures/trace/'],
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
    activationGateRefs: ['dependency-group:G0', 'Section 9.5', 'Section 40', 'Section 46'],
    rollbackRefs: ['FR-PROD-012', 'AC-279', 'Section 85.6'],
  },
];

export const PINNED_AC_TRACE_CRITERIA: readonly AcceptanceCriterionExcerpt[] = [
  {
    id: 'AC-265',
    line: 6792,
    text: 'The generated requirement manifest contains every normative FR, AC, invariant, and ADR exactly once with document anchor, dependency group, owner, code/schema/surface/test/telemetry mapping, activation gate, and rollback target.',
    textSha256: '97180d2c0d35395e899074d588ec5226ca610ed316a212182e4c5cdbc043723f',
    requirementRefs: [
      'FR-TRACE-001',
      'FR-TRACE-002',
      'FR-TRACE-003',
      'FR-TRACE-004',
      'FR-TRACE-005',
      'FR-TRACE-006',
    ],
    positiveTestRef: 'tests/acceptance/AC-265.spec.ts',
    negativeOrFailureTestRef: 'tests/negative/AC-265.negative.spec.ts',
    evidenceOwner: 'packages/release-conformance',
  },
  {
    id: 'AC-266',
    line: 6793,
    text: 'Adding, deleting, duplicating, renumbering, or changing a normative item without a matching manifest/test update fails CI.',
    textSha256: 'e9d289c3353b564a4d0e3590e612f5c42497c43d2dd910bcca2145e59c842dc4',
    requirementRefs: [
      'FR-TRACE-001',
      'FR-TRACE-002',
      'FR-TRACE-003',
      'FR-TRACE-004',
      'FR-TRACE-005',
      'FR-TRACE-006',
    ],
    positiveTestRef: 'tests/acceptance/AC-266.spec.ts',
    negativeOrFailureTestRef: 'tests/negative/AC-266.negative.spec.ts',
    evidenceOwner: 'packages/release-conformance',
  },
  {
    id: 'AC-267',
    line: 6794,
    text: 'Every production decision/alert can be traced to exact document/manifest hash, release, migration, policy, feature, model, tool, provider, pool adapter, evidence, and alpha artifact versions.',
    textSha256: '76ea010a099eef39fb8d1ae80edbdf647b1ca7058451ff8c7ac4b533578e6f2c',
    requirementRefs: [
      'FR-TRACE-001',
      'FR-TRACE-002',
      'FR-TRACE-003',
      'FR-TRACE-004',
      'FR-TRACE-005',
      'FR-TRACE-006',
    ],
    positiveTestRef: 'tests/acceptance/AC-267.spec.ts',
    negativeOrFailureTestRef: 'tests/negative/AC-267.negative.spec.ts',
    evidenceOwner: 'packages/release-conformance',
  },
  {
    id: 'AC-268',
    line: 6795,
    text: 'Manual/legal/rights/statistical/owner approvals require signed or hashed evidence with scope, approver, expiry, and revocation; an unchecked database boolean cannot satisfy a release gate.',
    textSha256: 'fe271d550b887d8826d9b8a8f667d89c7a3d376571fcca492d3fc4b17fc72ff8',
    requirementRefs: [
      'FR-TRACE-001',
      'FR-TRACE-002',
      'FR-TRACE-003',
      'FR-TRACE-004',
      'FR-TRACE-005',
      'FR-TRACE-006',
    ],
    positiveTestRef: 'tests/acceptance/AC-268.spec.ts',
    negativeOrFailureTestRef: 'tests/negative/AC-268.negative.spec.ts',
    evidenceOwner: 'packages/release-conformance',
  },
  {
    id: 'AC-269',
    line: 6796,
    text: 'Release conformance reports document hash, manifest hash, SBOM/dependency hash, migration/schema hashes, all test results, deviations, current activation scope, and tested rollback target.',
    textSha256: '8764449d42211610b4c9f55f50916ecb2af4814ace3812f85c4141040cb8fb0d',
    requirementRefs: [
      'FR-TRACE-001',
      'FR-TRACE-002',
      'FR-TRACE-003',
      'FR-TRACE-004',
      'FR-TRACE-005',
      'FR-TRACE-006',
    ],
    positiveTestRef: 'tests/acceptance/AC-269.spec.ts',
    negativeOrFailureTestRef: 'tests/negative/AC-269.negative.spec.ts',
    evidenceOwner: 'packages/release-conformance',
  },
];
