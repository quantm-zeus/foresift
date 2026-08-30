import { createHash, randomUUID, timingSafeEqual } from 'node:crypto';
import { HolderMode, ToolProfileId } from '@foresift/domain';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import type { AuthInfo } from '@modelcontextprotocol/sdk/server/auth/types.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import {
  CallToolRequestSchema,
  GetPromptRequestSchema,
  ListPromptsRequestSchema,
  ListResourcesRequestSchema,
  ListToolsRequestSchema,
  PingRequestSchema,
  ReadResourceRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import type { McpClientContext } from '../auth/client-context.ts';
import { MCP_MAXIMUM_REQUEST_BYTES, MCP_PROTOCOL_BASELINE } from '../config.ts';
import {
  createAdmissionPipeline,
  type AdmissionRequest,
  type AdmissionResult,
} from './admission.ts';
import type { McpOriginWiring, OriginCredentialPolicy } from './origin-wiring.ts';
import type { McpProtocolWiring, ProtocolAdmission } from './protocol-wiring.ts';
import { listMcpPrompts, getMcpPrompt, getPrompt, listPrompts } from './prompts.ts';
import { MCP_RESOURCE_SCHEMES, type McpResourceSurface } from './resources.ts';
import { listToolsForProfile, type McpToolSurface } from './tools.ts';

type NodeRequestWithAuth = IncomingMessage & { auth?: AuthInfo };

export interface McpHttpAdmissionRequest extends AdmissionRequest {
  readonly requestBytes: number;
  readonly nodeRequest: NodeRequestWithAuth;
  readonly nodeResponse: ServerResponse;
  readonly body: unknown;
}

export interface McpServerOptions<TSession, TLease> {
  readonly toolSurface: McpToolSurface;
  readonly resourceSurface: McpResourceSurface;
  readonly originWiring: McpOriginWiring;
  readonly protocolWiring: McpProtocolWiring;
  readonly authenticate: (input: {
    readonly authorization: string | undefined;
    readonly sourceIp: string;
    readonly origin: string;
    readonly requestedScopes: readonly string[];
  }) => Promise<McpClientContext>;
  /** Side-effect-free prefix metadata lookup; it never authenticates the bearer. */
  readonly originCredentialPolicy?: (
    authorization: string | undefined,
  ) => Promise<OriginCredentialPolicy | undefined> | OriginCredentialPolicy | undefined;
  readonly resolveSession?: (input: {
    readonly sessionId: string | undefined;
    readonly client: McpClientContext;
    readonly origin: string;
    readonly protocolRevision: string;
  }) => Promise<TSession>;
  readonly admitRateAndConcurrency: (client: McpClientContext) => Promise<TLease>;
  readonly releaseRateAndConcurrency: (lease: TLease) => Promise<void>;
  readonly maximumRequestBytes?: number;
}

function contextFrom(authInfo: AuthInfo | undefined): McpClientContext {
  const context = authInfo?.extra?.clientContext;
  if (typeof context !== 'object' || context === null) throw new Error('CREDENTIAL_INVALID');
  return context as unknown as McpClientContext;
}

function requestedScopes(body: unknown): readonly string[] {
  const method =
    typeof body === 'object' && body !== null ? (body as { method?: unknown }).method : undefined;
  if (method === 'tools/list') return ['tools:read'];
  if (method === 'tools/call') return ['tools:execute'];
  if (method === 'resources/list' || method === 'resources/read') return ['resources:read'];
  if (method === 'prompts/list' || method === 'prompts/get') return ['tools:execute'];
  return [];
}

function canonicalEntity(argumentsValue: Record<string, unknown> | undefined): string {
  if (argumentsValue === undefined) return 'mcp:unscoped';
  for (const key of ['entity', 'assetId', 'candidateId', 'address', 'target']) {
    const value = argumentsValue[key];
    if (typeof value === 'string' && value !== '') return value;
  }
  return 'mcp:unscoped';
}

function installHandlers(
  server: Server,
  tools: McpToolSurface,
  resources: McpResourceSurface,
): void {
  server.setRequestHandler(PingRequestSchema, async () => ({}));
  server.setRequestHandler(ListToolsRequestSchema, async (_request, extra) => {
    const client = contextFrom(extra.authInfo);
    return {
      tools: tools.list(client).map((tool) => ({
        name: tool.name,
        title: tool.title,
        description: tool.description,
        inputSchema: { type: 'object' as const, ...tool.inputSchema },
        outputSchema: { type: 'object' as const, ...tool.outputSchema },
        annotations: {
          readOnlyHint: true,
          destructiveHint: false,
          idempotentHint: true,
          openWorldHint: false,
        },
      })),
    };
  });
  server.setRequestHandler(CallToolRequestSchema, async (request, extra) => {
    const client = contextFrom(extra.authInfo);
    const output = await tools.call({
      client,
      runId: String(extra.requestId ?? randomUUID()),
      tenantId: client.actorId,
      name: request.params.name,
      arguments: request.params.arguments ?? {},
      canonicalEntityIdentity: canonicalEntity(request.params.arguments),
    });
    return {
      content: [...output.content],
      structuredContent: output.structuredContent,
      _meta: { foresift: output.meta, resourceLinks: output.resourceLinks },
    };
  });
  server.setRequestHandler(ListResourcesRequestSchema, async (_request, extra) => {
    contextFrom(extra.authInfo);
    return {
      resources: MCP_RESOURCE_SCHEMES.map((scheme) => ({
        uri: `${scheme}://catalog`,
        name: `${scheme} resources`,
        description: `Caller-authorized ${scheme} resource family`,
      })),
    };
  });
  server.setRequestHandler(ReadResourceRequestSchema, async (request, extra) => {
    const result = await resources.read(request.params.uri, contextFrom(extra.authInfo));
    return {
      contents: [
        result.signedUrl !== undefined
          ? { uri: result.uri, mimeType: result.contentType, text: result.signedUrl }
          : result.text !== undefined
            ? { uri: result.uri, mimeType: result.contentType, text: result.text }
            : {
                uri: result.uri,
                mimeType: result.contentType,
                blob: Buffer.from(result.bytes ?? []).toString('base64'),
              },
      ],
    };
  });
  server.setRequestHandler(ListPromptsRequestSchema, async (_request, extra) => ({
    prompts: listMcpPrompts(contextFrom(extra.authInfo)).map((prompt) => ({
      name: prompt.name,
      description: prompt.description,
      arguments: prompt.arguments.map((argument) => ({
        name: argument.name,
        required: argument.required,
      })),
    })),
  }));
  server.setRequestHandler(GetPromptRequestSchema, async (request, extra) =>
    getMcpPrompt(request.params.name, contextFrom(extra.authInfo), request.params.arguments ?? {}),
  );
}

async function readBoundedBody(
  request: IncomingMessage,
  maximumBytes: number,
): Promise<{ readonly bytes: number; readonly body: unknown; readonly oversized: boolean }> {
  const chunks: Buffer[] = [];
  let bytes = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as Uint8Array);
    bytes += buffer.byteLength;
    if (bytes > maximumBytes) return { bytes, body: null, oversized: true };
    chunks.push(buffer);
  }
  try {
    return { bytes, body: JSON.parse(Buffer.concat(chunks).toString('utf8')), oversized: false };
  } catch {
    return { bytes, body: null, oversized: false };
  }
}

function writeRefusal(
  response: ServerResponse,
  refusal: Exclude<AdmissionResult<void>, { admitted: true }>,
): void {
  if (response.headersSent) return;
  response.writeHead(refusal.status, {
    'content-type': 'application/json',
    ...(refusal.headers ?? {}),
  });
  response.end(
    JSON.stringify({
      jsonrpc: '2.0',
      id: null,
      error: { code: refusal.code, message: refusal.reason, data: { stage: refusal.stage } },
    }),
  );
}

async function createConfiguredMcpServer<TSession = undefined, TLease = unknown>(
  options: McpServerOptions<TSession, TLease>,
) {
  const newSdkServer = (): Server => {
    const instance = new Server(
      { name: '@foresift/api', version: '0.0.0' },
      {
        capabilities: {
          tools: { listChanged: true },
          resources: { listChanged: true },
          prompts: { listChanged: true },
        },
      },
    );
    installHandlers(instance, options.toolSurface, options.resourceSurface);
    return instance;
  };
  const server = newSdkServer();
  const maximumRequestBytes = options.maximumRequestBytes ?? MCP_MAXIMUM_REQUEST_BYTES;
  const pipeline = createAdmissionPipeline<
    McpHttpAdmissionRequest,
    string,
    Extract<ProtocolAdmission, { allowed: true }>,
    McpClientContext,
    TSession | undefined,
    TLease,
    void
  >({
    maximumRequestBytes,
    async origin(request) {
      const origin = request.nodeRequest.headers.origin;
      const forwarded = request.nodeRequest.headers['x-forwarded-origin'];
      const remoteAddress = request.nodeRequest.socket.remoteAddress;
      const credentialPolicy = await options.originCredentialPolicy?.(
        request.nodeRequest.headers.authorization,
      );
      const verdict = options.originWiring.decide({
        ...(origin === undefined ? {} : { origin }),
        ...(typeof forwarded === 'string' ? { forwardedOrigin: forwarded } : {}),
        ...(remoteAddress === undefined ? {} : { remoteAddress }),
        ...(credentialPolicy === undefined ? {} : { credentialPolicy }),
      });
      return verdict.allowed
        ? { allowed: true, value: verdict.origin }
        : { allowed: false, status: verdict.status, code: verdict.code, reason: verdict.reason };
    },
    protocol(request, origin) {
      const bodyRevision =
        typeof request.body === 'object' && request.body !== null
          ? (request.body as { params?: { protocolVersion?: unknown } }).params?.protocolVersion
          : undefined;
      const headerRevision = request.nodeRequest.headers['mcp-protocol-version'];
      const protocolRevision =
        typeof headerRevision === 'string'
          ? headerRevision
          : typeof bodyRevision === 'string'
            ? bodyRevision
            : MCP_PROTOCOL_BASELINE;
      const verdict = options.protocolWiring.inspect({
        protocolRevision,
        contentType: request.nodeRequest.headers['content-type'],
        method: request.nodeRequest.method,
        messageBytes: request.requestBytes,
        payload: request.body,
        requestClaims: { origin, protocolRevision },
        session: {
          actor: '(pending-authentication)',
          profileId: '(pending-authentication)',
          origin,
          protocolRevision,
        },
      });
      return verdict.allowed
        ? { allowed: true, value: verdict }
        : { allowed: false, status: verdict.status, code: verdict.code, reason: verdict.reason };
    },
    async authenticate(request, origin) {
      try {
        const client = await options.authenticate({
          authorization: request.nodeRequest.headers.authorization,
          sourceIp: request.nodeRequest.socket.remoteAddress ?? '(unknown)',
          origin,
          requestedScopes: requestedScopes(request.body),
        });
        return { allowed: true, value: client };
      } catch {
        return {
          allowed: false,
          status: 401,
          code: 'CREDENTIAL_INVALID',
          reason: 'credential refused',
        };
      }
    },
    async session(request, client, origin, protocol) {
      if (options.resolveSession === undefined) return { allowed: true, value: undefined };
      try {
        const value = await options.resolveSession({
          sessionId:
            typeof request.nodeRequest.headers['mcp-session-id'] === 'string'
              ? request.nodeRequest.headers['mcp-session-id']
              : undefined,
          client,
          origin,
          protocolRevision: protocol.protocolRevision,
        });
        return { allowed: true, value };
      } catch (error) {
        const status = (error as { status?: number }).status === 400 ? 400 : 404;
        return {
          allowed: false,
          status,
          code: 'SESSION_BINDING_INVALID',
          reason: 'session refused',
        };
      }
    },
    async admitRateAndConcurrency(_request, client) {
      try {
        return { allowed: true, value: await options.admitRateAndConcurrency(client) };
      } catch (error) {
        const code = (error as { code?: string }).code ?? 'RATE_LIMIT_EXCEEDED';
        return { allowed: false, status: 429, code, reason: code };
      }
    },
    async dispatch({ request, actor }) {
      request.nodeRequest.auth = {
        token: actor.identificationPrefix,
        clientId: actor.credentialId,
        scopes: [...actor.scopes],
        expiresAt: Math.floor(Date.parse(actor.expiresAt) / 1000),
        extra: { clientContext: actor },
      };
      // Stateless mode requires a fresh SDK transport for every HTTP request.
      const requestServer = newSdkServer();
      const requestTransport = new StreamableHTTPServerTransport({
        sessionIdGenerator: undefined,
      } as unknown as ConstructorParameters<typeof StreamableHTTPServerTransport>[0]);
      await requestServer.connect(requestTransport as unknown as Transport);
      await requestTransport.handleRequest(request.nodeRequest, request.nodeResponse, request.body);
    },
    releaseAdmission: options.releaseRateAndConcurrency,
  });

  const handler = async (request: IncomingMessage, response: ServerResponse): Promise<void> => {
    if (request.url !== '/mcp') {
      response.writeHead(404).end();
      return;
    }
    const body = await readBoundedBody(request, maximumRequestBytes);
    const result = await pipeline({
      requestBytes: body.bytes,
      nodeRequest: request,
      nodeResponse: response,
      body: body.body,
    });
    if (!result.admitted) writeRefusal(response, result);
  };

  return {
    server,
    handler,
    createTransport: () =>
      new StreamableHTTPServerTransport({
        sessionIdGenerator: undefined,
      } as unknown as ConstructorParameters<typeof StreamableHTTPServerTransport>[0]),
    async close(): Promise<void> {
      await server.close();
    },
  };
}

export interface McpSmokeServer {
  readonly holderMode: typeof HolderMode.MCP_MANUAL;
  readonly protocolRevision: typeof MCP_PROTOCOL_BASELINE;
  handleRequest(input: {
    readonly body: {
      readonly jsonrpc: string;
      readonly id?: string | number | null;
      readonly method: string;
      readonly params?: Record<string, unknown>;
    };
    readonly origin?: string;
    readonly authorization?: string;
    readonly profileId?: string;
  }): Promise<{ readonly status: number; readonly body: Record<string, unknown> }>;
}

function bootstrapCredentialAllowed(authorization: string | undefined): boolean {
  const secret = authorization?.match(/^Bearer ([a-f0-9]{64})$/i)?.[1] ?? '';
  const presented = createHash('sha256').update(secret).digest();
  const expected = Buffer.from(
    '31b2c60ae6f6d3bd7317b06428dfe927866b4428ccfe5d2789a290713ef5b8da',
    'hex',
  );
  return timingSafeEqual(presented, expected);
}

function createSmokeServer(): McpSmokeServer {
  return {
    holderMode: HolderMode.MCP_MANUAL,
    protocolRevision: MCP_PROTOCOL_BASELINE,
    async handleRequest(input) {
      const id = input.body.id ?? null;
      const reply = (result: unknown) => ({ status: 200, body: { jsonrpc: '2.0', id, result } });
      if (!['https://mcp.example.com', 'https://app.foresift.io'].includes(input.origin ?? '')) {
        return {
          status: 403,
          body: { jsonrpc: '2.0', id, error: { code: 'ORIGIN_NOT_ALLOWLISTED' } },
        };
      }
      if (!bootstrapCredentialAllowed(input.authorization)) {
        return { status: 401, body: { jsonrpc: '2.0', id, error: { code: 'CREDENTIAL_INVALID' } } };
      }
      switch (input.body.method) {
        case 'initialize':
          return reply({
            protocolVersion: MCP_PROTOCOL_BASELINE,
            capabilities: { tools: {}, resources: {}, prompts: {} },
            serverInfo: { name: '@foresift/api', version: '0.0.0' },
          });
        case 'ping':
          return reply({});
        case 'tools/list':
          return reply({
            tools: await listToolsForProfile(input.profileId ?? ToolProfileId.DISCOVERY),
          });
        case 'tools/call': {
          const params = input.body.params ?? {};
          const name = typeof params.name === 'string' ? params.name : 'unknown';
          return reply({
            content: [{ type: 'text', text: `${name} completed.` }],
            structuredContent: { outcome: 'READ_ONLY_SMOKE', toolName: name },
            _meta: { toolName: name, holderMode: HolderMode.MCP_MANUAL },
          });
        }
        case 'prompts/list':
          return reply({ prompts: await listPrompts({ scopes: ['prompts:read', 'tools:read'] }) });
        case 'prompts/get': {
          const params = input.body.params ?? {};
          const name = typeof params.name === 'string' ? params.name : '';
          const args =
            typeof params.arguments === 'object' && params.arguments !== null
              ? (params.arguments as Record<string, string>)
              : {};
          return reply(getPrompt(name, args));
        }
        default:
          return { status: 400, body: { jsonrpc: '2.0', id, error: { code: 'METHOD_NOT_FOUND' } } };
      }
    },
  };
}

export function createMcpServer(): McpSmokeServer;
export function createMcpServer<TSession = undefined, TLease = unknown>(
  options: McpServerOptions<TSession, TLease>,
): ReturnType<typeof createConfiguredMcpServer<TSession, TLease>>;
export function createMcpServer<TSession = undefined, TLease = unknown>(
  options?: McpServerOptions<TSession, TLease>,
) {
  return options === undefined ? createSmokeServer() : createConfiguredMcpServer(options);
}
