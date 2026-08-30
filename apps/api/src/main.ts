import { createServer, type Server as HttpServer } from 'node:http';
import type { ToolCoreConfig } from '@foresift/tool-core';
import { createToolCore } from '@foresift/tool-core';
import type { McpClientContext } from './auth/client-context.ts';
import type { McpOriginWiring } from './mcp/origin-wiring.ts';
import type { McpProtocolWiring } from './mcp/protocol-wiring.ts';
import type { McpResourceSurface } from './mcp/resources.ts';
import { McpToolSurface } from './mcp/tools.ts';
import { createMcpServer } from './mcp/server.ts';

export interface ApiRuntimeOptions<TSession, TLease> {
  readonly toolCore: ToolCoreConfig;
  readonly resourceSurface: McpResourceSurface;
  readonly originWiring: McpOriginWiring;
  readonly protocolWiring: McpProtocolWiring;
  readonly authenticate: (input: {
    readonly authorization: string | undefined;
    readonly sourceIp: string;
    readonly origin: string;
    readonly requestedScopes: readonly string[];
  }) => Promise<McpClientContext>;
  readonly originCredentialPolicy?: Parameters<
    typeof createMcpServer<TSession, TLease>
  >[0]['originCredentialPolicy'];
  readonly resolveSession?: Parameters<
    typeof createMcpServer<TSession, TLease>
  >[0]['resolveSession'];
  readonly admitRateAndConcurrency: (client: McpClientContext) => Promise<TLease>;
  readonly releaseRateAndConcurrency: (lease: TLease) => Promise<void>;
}

/** Composition root. Optional ToolCore seams remain absent and therefore deny closed. */
export async function createApiRuntime<TSession = undefined, TLease = unknown>(
  options: ApiRuntimeOptions<TSession, TLease>,
) {
  const toolCore = createToolCore(options.toolCore);
  const auditor = options.resourceSurface.accessAuditor();
  const toolSurface = new McpToolSurface(toolCore, (input) => auditor.append(input));
  const mcp = await createMcpServer<TSession, TLease>({
    toolSurface,
    resourceSurface: options.resourceSurface,
    originWiring: options.originWiring,
    protocolWiring: options.protocolWiring,
    authenticate: options.authenticate,
    ...(options.originCredentialPolicy === undefined
      ? {}
      : { originCredentialPolicy: options.originCredentialPolicy }),
    ...(options.resolveSession === undefined ? {} : { resolveSession: options.resolveSession }),
    admitRateAndConcurrency: options.admitRateAndConcurrency,
    releaseRateAndConcurrency: options.releaseRateAndConcurrency,
  });
  return { toolCore, toolSurface, ...mcp };
}

export async function startApiServer(
  runtime: Awaited<ReturnType<typeof createApiRuntime>>,
  options: { readonly port?: number; readonly hostname?: string } = {},
): Promise<{ readonly httpServer: HttpServer; readonly port: number }> {
  const httpServer = createServer(runtime.handler);
  await new Promise<void>((resolve, reject) => {
    httpServer.once('error', reject);
    httpServer.listen(options.port ?? 0, options.hostname ?? '127.0.0.1', () => resolve());
  });
  const address = httpServer.address();
  if (address === null || typeof address === 'string')
    throw new Error('HTTP listener has no TCP address');
  return { httpServer, port: address.port };
}
