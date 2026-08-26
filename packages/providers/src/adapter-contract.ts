/**
 * Exact per-adapter allowlist descriptors + request/response validation layer
 * (FR-PROV-005; T114).
 *
 * Every dimension FR-PROV-005 names is declared on the descriptor and
 * ENFORCED here — scheme/host/port via the security EgressGuard, everything
 * else (path template, method, content types, request fields, redirect
 * policy, max bytes, response schema) by this module. Deny-by-default: an
 * undeclared dimension refuses with its typed code; nothing "passes because
 * it was not checked".
 */
import { z } from 'zod';
import { type EgressAllowlistEntry, type EgressDecision } from '@foresift/shared-schemas';
import { EgressGuard } from '@foresift/security';
import {
  ProviderAdapterError,
  ProvAdapterErrorCode,
  type ProvAdapterErrorCodeValue,
} from './errors.ts';
import type { AdapterHttpRequest, AdapterHttpResponse, FetchPort } from './fetch-port.ts';

export const REDIRECT_POLICIES = ['REFUSE', 'SAME_ORIGIN_APPROVED', 'APPROVED_HOPS'] as const;

/**
 * The exact allowlist descriptor for ONE operation. Serializble on purpose:
 * registration persists these as the audited contract for what the adapter
 * may touch.
 */
export const AllowlistDescriptorSchema = z
  .object({
    /** Links the descriptor to its catalog operation id. */
    operationId: z.string().min(1),
    scheme: z.literal('https'),
    host: z.string().min(1),
    port: z.number().int().min(1).max(65535),
    /** Path template with `{named}` segments; concrete paths must match fully. */
    pathTemplate: z.string().startsWith('/'),
    method: z.enum(['GET', 'POST']),
    /** Admitted request Content-Type values; GET adapters declare []. */
    requestContentTypes: z.array(z.string().min(1)),
    responseContentTypes: z.array(z.string().min(1)).min(1),
    /** Registry-side identifier of the Zod schema responses must satisfy. */
    responseSchemaId: z.string().min(1),
    /** Query parameters allowed — deny-by-default beyond this list. */
    allowedQueryFields: z.array(z.string().min(1)),
    /** JSON body fields allowed — deny-by-default beyond this list. */
    allowedRequestFields: z.array(z.string().min(1)),
    redirectPolicy: z.enum(REDIRECT_POLICIES),
    maxRedirects: z.number().int().nonnegative(),
    maxResponseBytes: z.number().int().positive(),
  })
  .strict();
export type AllowlistDescriptor = z.infer<typeof AllowlistDescriptorSchema>;

/** Compiles '/v1/tokens/{chain}/{address}' to a full-match regex. */
export function compilePathTemplate(template: string): RegExp {
  const source = template
    .split('/')
    .map((segment) =>
      segment.startsWith('{') && segment.endsWith('}')
        ? '[^/]+'
        : segment.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'),
    )
    .join('/');
  return new RegExp(`^${source}/?$`);
}

export interface AdapterRequestInput {
  readonly pathParams?: Readonly<Record<string, string>> | undefined;
  readonly query?: Readonly<Record<string, string>> | undefined;
  /** JSON body; validated against allowedRequestFields before transport. */
  readonly body?: Record<string, unknown> | undefined;
}

interface RequestCheckFailure {
  readonly code: ProvAdapterErrorCodeValue;
  readonly message: string;
  readonly details: Record<string, unknown>;
}

/**
 * The adapter-level validation layer. Pure checks over the descriptor — no
 * I/O — so refusals are exhaustively testable before any egress happens.
 */
export class AdapterRequestValidator {
  readonly descriptor: AllowlistDescriptor;
  private readonly pathRegex: RegExp;

  constructor(descriptor: AllowlistDescriptor) {
    this.descriptor = AllowlistDescriptorSchema.parse(descriptor);
    this.pathRegex = compilePathTemplate(this.descriptor.pathTemplate);
  }

  /** Builds the concrete URL or returns a typed refusal. */
  buildUrl(input: AdapterRequestInput): { url: string } | { refusal: RequestCheckFailure } {
    const params = input.pathParams ?? {};
    const path = this.descriptor.pathTemplate.replace(/\{(\w+)\}/g, (_m: string, name: string) => {
      const value = params[name];
      if (value === undefined || value.length === 0) {
        throw new ProviderAdapterError(
          `missing path parameter {${name}} for ${this.descriptor.operationId}`,
          { operationId: this.descriptor.operationId, pathParam: name },
          ProvAdapterErrorCode.PROV_ADAPTER_PATH_REFUSED,
        );
      }
      return encodeURIComponent(value);
    });
    if (!this.pathRegex.test(path)) {
      return {
        refusal: {
          code: ProvAdapterErrorCode.PROV_ADAPTER_PATH_REFUSED,
          message: `path ${path} does not match template ${this.descriptor.pathTemplate}`,
          details: { operationId: this.descriptor.operationId, path },
        },
      };
    }
    const declaredParams = input.query ?? {};
    for (const key of Object.keys(declaredParams)) {
      if (!this.descriptor.allowedQueryFields.includes(key)) {
        return {
          refusal: {
            code: ProvAdapterErrorCode.PROV_ADAPTER_QUERY_FIELD_REFUSED,
            message: `query field '${key}' is not allowlisted for ${this.descriptor.operationId}`,
            details: { operationId: this.descriptor.operationId, field: key },
          },
        };
      }
    }
    const search = new URLSearchParams(declaredParams).toString();
    const url =
      `${this.descriptor.scheme}://${this.descriptor.host}:${String(this.descriptor.port)}${path}` +
      (search.length > 0 ? `?${search}` : '');
    return { url };
  }

  /** Method gate: anything but the declared method refuses. */
  checkMethod(method: string): RequestCheckFailure | null {
    if (method !== this.descriptor.method) {
      return {
        code: ProvAdapterErrorCode.PROV_ADAPTER_METHOD_REFUSED,
        message: `${this.descriptor.operationId} declares ${this.descriptor.method}; ${method} is not allowlisted`,
        details: { operationId: this.descriptor.operationId, method },
      };
    }
    return null;
  }

  /** Body-field gate over the outgoing request. */
  checkRequest(input: AdapterRequestInput): RequestCheckFailure | null {
    // Body fields (deny-by-default).
    if (input.body !== undefined) {
      if (input.body === null || typeof input.body !== 'object' || Array.isArray(input.body)) {
        return {
          code: ProvAdapterErrorCode.PROV_ADAPTER_REQUEST_FIELD_REFUSED,
          message: 'request body must be a JSON object',
          details: { operationId: this.descriptor.operationId },
        };
      }
      for (const key of Object.keys(input.body)) {
        if (!this.descriptor.allowedRequestFields.includes(key)) {
          return {
            code: ProvAdapterErrorCode.PROV_ADAPTER_REQUEST_FIELD_REFUSED,
            message: `request field '${key}' is not allowlisted for ${this.descriptor.operationId}`,
            details: { operationId: this.descriptor.operationId, field: key },
          };
        }
      }
    }
    return null;
  }

  /**
   * Redirect handling per the descriptor policy: REFUSE always refuses;
   * SAME_ORIGIN_APPROVED admits hops only back onto the descriptor host;
   * APPROVED_HOPS admits any allowlisted destination up to maxRedirects.
   */
  checkRedirect(nextUrl: string, hopsFollowed: number): RequestCheckFailure | null {
    if (this.descriptor.redirectPolicy === 'REFUSE') {
      return {
        code: ProvAdapterErrorCode.PROV_ADAPTER_REDIRECT_REFUSED,
        message: `${this.descriptor.operationId} refuses redirects by policy`,
        details: { operationId: this.descriptor.operationId, nextUrl },
      };
    }
    if (hopsFollowed + 1 > this.descriptor.maxRedirects) {
      return {
        code: ProvAdapterErrorCode.PROV_ADAPTER_REDIRECT_REFUSED,
        message: `redirect hop ${String(hopsFollowed + 1)} exceeds cap ${String(this.descriptor.maxRedirects)}`,
        details: { operationId: this.descriptor.operationId },
      };
    }
    if (this.descriptor.redirectPolicy === 'SAME_ORIGIN_APPROVED') {
      let host: string;
      try {
        host = new URL(nextUrl).hostname.toLowerCase();
      } catch {
        host = '';
      }
      if (host !== this.descriptor.host) {
        return {
          code: ProvAdapterErrorCode.PROV_ADAPTER_REDIRECT_REFUSED,
          message: `cross-origin redirect to '${host}' refused (same-origin policy)`,
          details: { operationId: this.descriptor.operationId, nextUrl },
        };
      }
    }
    return null;
  }

  /** Response-side gates: content type + byte cap (schema parse is the caller's). */
  checkResponse(
    response: Pick<AdapterHttpResponse, 'headers' | 'bodyBytes'>,
  ): RequestCheckFailure | null {
    const contentType =
      (response.headers['content-type'] ?? '').split(';')[0]?.trim().toLowerCase() ?? '';
    if (!this.descriptor.responseContentTypes.includes(contentType)) {
      return {
        code: ProvAdapterErrorCode.PROV_ADAPTER_CONTENT_TYPE_REFUSED,
        message: `response content type '${contentType}' is not admitted for ${this.descriptor.operationId}`,
        details: { operationId: this.descriptor.operationId, contentType },
      };
    }
    if (response.bodyBytes > this.descriptor.maxResponseBytes) {
      return {
        code: ProvAdapterErrorCode.PROV_ADAPTER_RESPONSE_BYTES_EXCEEDED,
        message: `response of ${String(response.bodyBytes)} bytes exceeds cap ${String(this.descriptor.maxResponseBytes)}`,
        details: { operationId: this.descriptor.operationId, bodyBytes: response.bodyBytes },
      };
    }
    return null;
  }
}

export interface AdapterClientOptions {
  readonly guard: EgressGuard;
  /** Egress plane charged for this adapter's traffic. */
  readonly plane: EgressAllowlistEntry['plane'];
  readonly fetchPort: FetchPort;
}

export interface AdapterExecutionResult<T> {
  readonly url: string;
  readonly status: number;
  readonly data: T;
}

/**
 * Executes ONE allowlisted operation end-to-end:
 * validator gates → egress authorize → pin verification → transport →
 * response caps → response-schema parse. Any refusal short-circuits BEFORE
 * the next stage runs.
 */
export class AdapterClient<T> {
  private readonly validator: AdapterRequestValidator;
  private readonly responseSchema: z.ZodType<T>;
  private readonly guard: EgressGuard;
  private readonly plane: EgressAllowlistEntry['plane'];
  private readonly fetchPort: FetchPort;

  constructor(options: {
    descriptor: AllowlistDescriptor;
    responseSchema: z.ZodType<T>;
    guard: EgressGuard;
    plane: EgressAllowlistEntry['plane'];
    fetchPort: FetchPort;
  }) {
    this.validator = new AdapterRequestValidator(options.descriptor);
    this.responseSchema = options.responseSchema;
    this.guard = options.guard;
    this.plane = options.plane;
    this.fetchPort = options.fetchPort;
  }

  private refuse(failure: RequestCheckFailure): never {
    throw new ProviderAdapterError(failure.message, failure.details, failure.code);
  }

  async execute(input: AdapterRequestInput): Promise<AdapterExecutionResult<T>> {
    const built = this.buildUrlOrRefuse(input);
    const bodyFailure = this.validator.checkRequest(input);
    if (bodyFailure !== null) this.refuse(bodyFailure);

    const authorization = await this.guard.authorize(built, this.plane);
    this.requireEgress(authorization);
    const pin = await this.guard.verifyPin(
      built,
      authorization.decision === 'ALLOW' ? authorization.pinnedAddresses : [],
    );
    this.requireEgress(pin);

    const headers: Record<string, string> = { accept: 'application/json' };
    let wireBody: string | undefined;
    if (input.body !== undefined) {
      wireBody = JSON.stringify(input.body);
      headers['content-type'] = 'application/json';
    }

    const rawResponse = await this.fetchPort({
      url: built,
      method: this.validator.descriptor.method,
      headers,
      ...(wireBody !== undefined ? { body: wireBody } : {}),
    } satisfies AdapterHttpRequest);

    const responseFailure = this.validator.checkResponse(rawResponse);
    if (responseFailure !== null) this.refuse(responseFailure);

    let parsedJson: unknown;
    try {
      parsedJson = JSON.parse(rawResponse.bodyText) as unknown;
    } catch {
      this.refuse({
        code: ProvAdapterErrorCode.PROV_ADAPTER_RESPONSE_INVALID,
        message: `response of ${this.validator.descriptor.operationId} is not valid JSON`,
        details: { operationId: this.validator.descriptor.operationId },
      });
    }
    const parsedSchema = this.responseSchema.safeParse(parsedJson);
    if (!parsedSchema.success) {
      throw new ProviderAdapterError(
        `recorded response failed the ${this.validator.descriptor.responseSchemaId} contract`,
        {
          operationId: this.validator.descriptor.operationId,
          issues: parsedSchema.error.issues
            .slice(0, 10)
            .map(
              (issue: { path: (string | number | symbol)[]; message: string }) =>
                `${issue.path.join('.')}: ${issue.message}`,
            ),
        },
        ProvAdapterErrorCode.PROV_ADAPTER_RESPONSE_INVALID,
      );
    }
    return { url: built, status: rawResponse.status, data: parsedSchema.data };
  }

  /**
   * Explicit redirect re-entry point: callers invoke when their transport
   * surfaces a 3xx; policy check + full egress authorization re-run for the
   * hop target before it is fetched.
   */
  async executeRedirect(nextUrl: string, hopsFollowed: number): Promise<AdapterExecutionResult<T>> {
    const redirectFailure = this.validator.checkRedirect(nextUrl, hopsFollowed);
    if (redirectFailure !== null) this.refuse(redirectFailure);
    const authorization = await this.guard.authorize(nextUrl, this.plane);
    this.requireEgress(authorization);
    const pin = await this.guard.verifyPin(
      nextUrl,
      authorization.decision === 'ALLOW' ? authorization.pinnedAddresses : [],
    );
    this.requireEgress(pin);
    const rawResponse = await this.fetchPort({
      url: nextUrl,
      method: this.validator.descriptor.method,
      headers: { accept: 'application/json' },
    });
    const responseFailure = this.validator.checkResponse(rawResponse);
    if (responseFailure !== null) this.refuse(responseFailure);
    let parsedJson: unknown;
    try {
      parsedJson = JSON.parse(rawResponse.bodyText) as unknown;
    } catch {
      this.refuse({
        code: ProvAdapterErrorCode.PROV_ADAPTER_RESPONSE_INVALID,
        message: `redirect response of ${this.validator.descriptor.operationId} is not valid JSON`,
        details: { operationId: this.validator.descriptor.operationId },
      });
    }
    const parsedSchema = this.responseSchema.safeParse(parsedJson);
    if (!parsedSchema.success) {
      throw new ProviderAdapterError(
        `redirect response failed the ${this.validator.descriptor.responseSchemaId} contract`,
        { operationId: this.validator.descriptor.operationId },
        ProvAdapterErrorCode.PROV_ADAPTER_RESPONSE_INVALID,
      );
    }
    return { url: nextUrl, status: rawResponse.status, data: parsedSchema.data };
  }

  private buildUrlOrRefuse(input: AdapterRequestInput): string {
    const built = this.validator.buildUrl(input);
    if ('refusal' in built) this.refuse(built.refusal);
    return built.url;
  }

  private requireEgress(decision: EgressDecision): void {
    if (decision.decision === 'REFUSE') {
      throw new ProviderAdapterError(
        `egress refused (${decision.reason}): ${decision.detail}`,
        { reason: decision.reason, detail: decision.detail },
        ProvAdapterErrorCode.PROV_ADAPTER_EGRESS_REFUSED,
      );
    }
  }
}
