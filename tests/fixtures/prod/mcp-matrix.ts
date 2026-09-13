/**
 * Canonical MCP revision×client matrix fixtures (T033, FR-PROD-005, AC-144;
 * PRD §69.7).
 *
 * Inert typed data mirroring `prod.mcp_revisions`, `prod.mcp_target_clients`,
 * and `prod.mcp_compatibility_matrix`: the stable baseline `2025-11-25` tested
 * green for every supported target client, plus draft-default, untested, stale,
 * and failing matrices.
 */
import type { McpCompatibilityMatrixClaim } from '@foresift/release-conformance';

/** The §69.7 baseline mutually tested stable revision. */
export const PROD_MCP_STABLE_REVISION = '2025-11-25';
/** A draft/RC revision that can never be the compatibility default. */
export const PROD_MCP_DRAFT_REVISION = '2026-03-01-draft';

export const PROD_MCP_NOW = '2026-06-01T00:00:00Z';
export const PROD_MCP_RECENT_TEST = '2026-05-01T00:00:00Z';
export const PROD_MCP_STALE_TEST = '2020-01-01T00:00:00Z';

export interface ProdMcpTargetClientFixture {
  readonly clientId: string;
  readonly clientName: string;
  readonly version: string;
  readonly authMode: string;
}

/** The six supported target clients of AC-144. */
export const PROD_MCP_TARGET_CLIENTS: readonly ProdMcpTargetClientFixture[] = [
  {
    clientId: 'claude-desktop',
    clientName: 'Claude Desktop',
    version: '0.7.0',
    authMode: 'OAUTH_2_1',
  },
  {
    clientId: 'cursor-ide',
    clientName: 'Cursor IDE MCP Client',
    version: '1.2.0',
    authMode: 'OAUTH_2_1',
  },
  {
    clientId: 'roo-code',
    clientName: 'Roo Code VSCode Extension',
    version: '3.5.0',
    authMode: 'OAUTH_2_1',
  },
  {
    clientId: 'jetbrains-mcp',
    clientName: 'JetBrains MCP Plugin',
    version: '2025.1.0',
    authMode: 'OAUTH_2_1',
  },
  {
    clientId: 'mcp-sdk-node',
    clientName: '@modelcontextprotocol/sdk Node Client',
    version: '1.30.0',
    authMode: 'OAUTH_2_1',
  },
  {
    clientId: 'web-connector',
    clientName: 'OpenAI Connector / Web MCP Client',
    version: '2.0.0',
    authMode: 'OAUTH_2_1',
  },
];

export interface ProdMcpRevisionFixture {
  readonly revision: string;
  readonly channel: 'STABLE' | 'DRAFT';
  readonly sdkVersion: string;
  readonly transport: string;
  readonly originPolicyRef: string;
  readonly isDefault: boolean;
}

export interface ProdMcpCellFixture {
  readonly cellId: string;
  readonly revision: string;
  readonly clientId: string;
  readonly result: 'PASS' | 'FAIL';
  readonly liveTestDate: string;
}

export const PROD_MCP_STABLE_REVISION_ROW: ProdMcpRevisionFixture = {
  revision: PROD_MCP_STABLE_REVISION,
  channel: 'STABLE',
  sdkVersion: '1.30.0',
  transport: 'STREAMABLE_HTTP',
  originPolicyRef: 'origin-policy://prod',
  isDefault: true,
};

export const PROD_MCP_DRAFT_REVISION_ROW: ProdMcpRevisionFixture = {
  revision: PROD_MCP_DRAFT_REVISION,
  channel: 'DRAFT',
  sdkVersion: '2.0.0-rc.1',
  transport: 'STREAMABLE_HTTP',
  originPolicyRef: 'origin-policy://prod',
  isDefault: false,
};

function cellsFor(
  revision: string,
  mutate: (clientId: string) => { result: 'PASS' | 'FAIL'; liveTestDate: string },
  omitClientId?: string,
): readonly ProdMcpCellFixture[] {
  return PROD_MCP_TARGET_CLIENTS.filter((client) => client.clientId !== omitClientId).map(
    (client) => ({
      cellId: `${revision}-${client.clientId}`,
      revision,
      clientId: client.clientId,
      ...mutate(client.clientId),
    }),
  );
}

/** Stable baseline green for every supported client at a fresh live-test date. */
export const PROD_MCP_CELLS_COMPLIANT: readonly ProdMcpCellFixture[] = cellsFor(
  PROD_MCP_STABLE_REVISION,
  () => ({ result: 'PASS', liveTestDate: PROD_MCP_RECENT_TEST }),
);

/** One client's cell was never tested. */
export const PROD_MCP_CELLS_UNTESTED: readonly ProdMcpCellFixture[] = cellsFor(
  PROD_MCP_STABLE_REVISION,
  () => ({ result: 'PASS', liveTestDate: PROD_MCP_RECENT_TEST }),
  'web-connector',
);

/** One client's live test is long stale. */
export const PROD_MCP_CELLS_STALE: readonly ProdMcpCellFixture[] = cellsFor(
  PROD_MCP_STABLE_REVISION,
  (clientId) => ({
    result: 'PASS',
    liveTestDate: clientId === 'roo-code' ? PROD_MCP_STALE_TEST : PROD_MCP_RECENT_TEST,
  }),
);

/** One client's conformance cell FAILED. */
export const PROD_MCP_CELLS_FAILING: readonly ProdMcpCellFixture[] = cellsFor(
  PROD_MCP_STABLE_REVISION,
  (clientId) => ({
    result: clientId === 'jetbrains-mcp' ? 'FAIL' : 'PASS',
    liveTestDate: PROD_MCP_RECENT_TEST,
  }),
);

/** A compliant claim: stable default, fresh PASS cell for every client. */
export const PROD_MCP_COMPLIANT_CLAIM: McpCompatibilityMatrixClaim = {
  revisions: [PROD_MCP_STABLE_REVISION_ROW],
  clients: PROD_MCP_TARGET_CLIENTS.map((client) => ({ clientId: client.clientId })),
  cells: PROD_MCP_CELLS_COMPLIANT,
  now: PROD_MCP_NOW,
};

/** A draft revision claims the compatibility default — drift. */
export const PROD_MCP_DRAFT_DEFAULT_CLAIM: McpCompatibilityMatrixClaim = {
  ...PROD_MCP_COMPLIANT_CLAIM,
  revisions: [
    { ...PROD_MCP_DRAFT_REVISION_ROW, isDefault: true },
    { ...PROD_MCP_STABLE_REVISION_ROW, isDefault: false },
  ],
};

/** The default stable revision has no default row at all — drift. */
export const PROD_MCP_NO_DEFAULT_CLAIM: McpCompatibilityMatrixClaim = {
  ...PROD_MCP_COMPLIANT_CLAIM,
  revisions: [{ ...PROD_MCP_STABLE_REVISION_ROW, isDefault: false }],
};

export const PROD_MCP_UNTESTED_CLAIM: McpCompatibilityMatrixClaim = {
  ...PROD_MCP_COMPLIANT_CLAIM,
  cells: PROD_MCP_CELLS_UNTESTED,
};

export const PROD_MCP_STALE_CLAIM: McpCompatibilityMatrixClaim = {
  ...PROD_MCP_COMPLIANT_CLAIM,
  cells: PROD_MCP_CELLS_STALE,
};

export const PROD_MCP_FAILING_CLAIM: McpCompatibilityMatrixClaim = {
  ...PROD_MCP_COMPLIANT_CLAIM,
  cells: PROD_MCP_CELLS_FAILING,
};
