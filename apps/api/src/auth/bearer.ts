import {
  McpCredentialStore,
  type IssueCredentialInput,
  type IssuedCredential,
} from '@foresift/security';
import type { DatabaseEngine } from '@foresift/persistence';
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
