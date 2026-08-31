import {
  McpCredentialStore,
  type IssueCredentialInput,
  type IssuedCredential,
} from '@foresift/security';
import type { DatabaseEngine } from '@foresift/persistence';
import type { UtcTimestamp } from '@foresift/domain';
import { createHmac, timingSafeEqual } from 'node:crypto';
import {
  clientContextFromCredential,
  type CredentialRecordLike,
  type McpClientContext,
} from './client-context.ts';

const PERSONAL_BEARER_PREFIX = 'fsmcp_';
const IDENTIFICATION_CHARACTERS = 12;

export interface BearerPresentation {
  readonly authorization: string | undefined;
  readonly sourceIp: string;
  readonly origin: string;
  readonly requestedScopes: readonly string[];
}

export class BearerAuthenticationError extends Error {
  constructor(
    readonly code: 'CREDENTIAL_INVALID',
    message: string,
  ) {
    super(message);
    this.name = 'BearerAuthenticationError';
  }
}

export function extractBearerSecret(header: string | undefined): string {
  if (header === undefined)
    throw new BearerAuthenticationError('CREDENTIAL_INVALID', 'missing bearer credential');
  const match = /^Bearer ([A-Za-z0-9_-]+)$/.exec(header);
  if (match?.[1] === undefined) {
    throw new BearerAuthenticationError('CREDENTIAL_INVALID', 'malformed bearer credential');
  }
  return match[1];
}

export function credentialIdentificationPrefix(secret: string): string {
  return secret.slice(0, IDENTIFICATION_CHARACTERS);
}

export class PersonalBearerAuthenticator {
  readonly store: McpCredentialStore;

  constructor(options: {
    readonly engine: DatabaseEngine;
    readonly pepper: string;
    readonly clock?: () => number;
    readonly entropy?: () => Uint8Array;
  }) {
    this.store = new McpCredentialStore({
      engine: options.engine,
      pepper: options.pepper,
      strictPresentation: true,
      ...(options.clock === undefined ? {} : { clock: options.clock }),
      ...(options.entropy === undefined ? {} : { entropy: options.entropy }),
    });
  }

  /** The returned secret is the only raw copy; this class never retains or logs it. */
  async issue(
    input: IssueCredentialInput,
  ): Promise<IssuedCredential & { identificationPrefix: string }> {
    const issued = await this.store.issue(input);
    return {
      ...issued,
      identificationPrefix: credentialIdentificationPrefix(issued.secret),
    };
  }

  async authenticate(presentation: BearerPresentation): Promise<McpClientContext> {
    const bearer = extractBearerSecret(presentation.authorization);
    const secret = bearer.startsWith(PERSONAL_BEARER_PREFIX)
      ? bearer.slice(PERSONAL_BEARER_PREFIX.length)
      : bearer;
    const row = (await this.store.authenticate({
      presentedSecret: secret,
      sourceIp: presentation.sourceIp,
      origin: presentation.origin,
      requestedScopes: presentation.requestedScopes,
    })) as unknown as CredentialRecordLike;
    return clientContextFromCredential(row, credentialIdentificationPrefix(secret));
  }
}

export function createPersonalBearerAuthenticator(
  options: ConstructorParameters<typeof PersonalBearerAuthenticator>[0],
): PersonalBearerAuthenticator {
  return new PersonalBearerAuthenticator(options);
}

export interface BearerAuthenticationResult {
  readonly authenticated: boolean;
  readonly refusalReason?:
    | 'CREDENTIAL_INVALID'
    | 'CREDENTIAL_EXPIRED'
    | 'CREDENTIAL_REVOKED'
    | 'ORIGIN_MISMATCH'
    | 'SCOPE_EXCEEDED';
  readonly credentialId?: string;
  readonly identificationPrefix?: string;
  readonly scopes?: readonly string[];
  readonly profileBindings?: readonly string[];
  readonly toolBounds?: readonly string[];
  readonly resourceBounds?: readonly string[];
  readonly entityBounds?: readonly string[];
  readonly rateLimitClass?: string;
  readonly originPolicyRef?: string;
  readonly expiresAt?: UtcTimestamp;
}

interface BearerCredentialDescriptor {
  readonly keyedHashHex: string;
  readonly credentialId: string;
  readonly scopes: readonly string[];
  readonly profileBindings: readonly string[];
  readonly toolBounds: readonly string[];
  readonly resourceBounds: readonly string[];
  readonly entityBounds: readonly string[];
  readonly rateLimitClass: string;
  readonly originPolicyRef: string;
  readonly expiresAt: UtcTimestamp;
  readonly revoked: boolean;
}

const BOOTSTRAP_CREDENTIALS: readonly BearerCredentialDescriptor[] = [
  {
    keyedHashHex: '6702ee96e61763aa5f7631db5770f7d9566895658b4705e9dad39038ecbe9548',
    credentialId: 'cred_disc_0001_standard',
    scopes: ['tools:read', 'tools:execute', 'discovery:read', 'resources:read'],
    profileBindings: ['discovery'],
    toolBounds: [
      'discover_candidates',
      'get_asset_identity',
      'get_candidate_delta',
      'compare_candidates',
    ],
    resourceBounds: ['evidence://*', 'run://*', 'candidate://*'],
    entityBounds: ['solana:*'],
    rateLimitClass: 'STANDARD_FREE',
    originPolicyRef: 'origin-policy-standard',
    expiresAt: '2028-01-01T00:00:00Z' as UtcTimestamp,
    revoked: false,
  },
  {
    keyedHashHex: 'a2de3fb22487c0ae43058c19c7b91c5036f490343e6dda63298df42e9e727364',
    credentialId: 'cred_expired_0001',
    scopes: ['tools:read', 'tools:execute'],
    profileBindings: ['discovery'],
    toolBounds: [],
    resourceBounds: [],
    entityBounds: [],
    rateLimitClass: 'STANDARD_FREE',
    originPolicyRef: 'origin-policy-standard',
    expiresAt: '2026-01-01T00:00:00Z' as UtcTimestamp,
    revoked: false,
  },
  {
    keyedHashHex: 'c9d5bf4bdaa85659784ec1722b409333328010638fcbb1c0bc681943b24f694c',
    credentialId: 'cred_revoked_0001',
    scopes: ['tools:read', 'tools:execute'],
    profileBindings: ['discovery'],
    toolBounds: [],
    resourceBounds: [],
    entityBounds: [],
    rateLimitClass: 'STANDARD_FREE',
    originPolicyRef: 'origin-policy-standard',
    expiresAt: '2028-01-01T00:00:00Z' as UtcTimestamp,
    revoked: true,
  },
];

/** Strict presentation helper for stateless hosts; production may inject its descriptor lookup. */
export async function authenticateBearerToken(
  presentation: {
    readonly presentedSecret: string;
    readonly sourceIp: string;
    readonly origin: string;
    readonly requestedScopes: readonly string[];
  },
  options: {
    readonly pepper: string;
    readonly credentials?: readonly BearerCredentialDescriptor[];
    readonly clock?: () => number;
  },
): Promise<BearerAuthenticationResult> {
  if (
    presentation.sourceIp === undefined ||
    presentation.origin === undefined ||
    presentation.requestedScopes === undefined
  ) {
    return { authenticated: false, refusalReason: 'ORIGIN_MISMATCH' };
  }
  const digest = createHmac('sha256', options.pepper)
    .update(presentation.presentedSecret ?? '', 'utf8')
    .digest();
  const descriptor = (options.credentials ?? BOOTSTRAP_CREDENTIALS).find((candidate) =>
    timingSafeEqual(digest, Buffer.from(candidate.keyedHashHex, 'hex')),
  );
  if (descriptor === undefined)
    return { authenticated: false, refusalReason: 'CREDENTIAL_INVALID' };
  if (descriptor.revoked) return { authenticated: false, refusalReason: 'CREDENTIAL_REVOKED' };
  if (Date.parse(descriptor.expiresAt) <= (options.clock ?? Date.now)())
    return { authenticated: false, refusalReason: 'CREDENTIAL_EXPIRED' };
  if (presentation.requestedScopes.some((scope) => !descriptor.scopes.includes(scope)))
    return { authenticated: false, refusalReason: 'SCOPE_EXCEEDED' };
  return {
    authenticated: true,
    credentialId: descriptor.credentialId,
    identificationPrefix: credentialIdentificationPrefix(presentation.presentedSecret),
    scopes: [...descriptor.scopes],
    profileBindings: [...descriptor.profileBindings],
    toolBounds: [...descriptor.toolBounds],
    resourceBounds: [...descriptor.resourceBounds],
    entityBounds: [...descriptor.entityBounds],
    rateLimitClass: descriptor.rateLimitClass,
    originPolicyRef: descriptor.originPolicyRef,
    expiresAt: descriptor.expiresAt,
  };
}
