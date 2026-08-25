/**
 * Shared Phase-D test fixtures: fixture FetchPort (NO real transport is
 * ever configured — plan risk note), static DNS resolver, recorded response
 * bodies for the GMGN and Helius adapters.
 */
import { expect } from 'vitest';
import type { EgressResolver } from '@foresift/security';
import { SUPPORTED_PROGRAM_IDS, type FetchPort, type ProviderHttpResponse } from '../src/index.ts';

/** Static resolver seam: tests pin every answer; nothing resolves live. */
export function staticResolver(answers: Readonly<Record<string, readonly string[]>>): EgressResolver {
  return async (host) => answers[host] ?? [];
}

export const PUBLIC_IP = '203.0.113.10'; // TEST-NET-3: public, not denied.

/** Fixture transport serving a handler's response per request. */
export function fixtureFetch(handler: (request: { url: string }) => ProviderHttpResponse): FetchPort {
  return {
    async fetch(request) {
      return handler({ url: request.url });
    },
  };
}

/**
 * Assert a SYNC throw carries the expected typed provider code (error
 * messages do not embed codes, so match on `.code`, never on text).
 */
export function expectTypedThrow(fn: () => unknown, code: string, messageMatch?: RegExp): void {
  let caught: unknown;
  try {
    fn();
  } catch (error) {
    caught = error;
  }
  expect(caught).toBeInstanceOf(Error);
  expect((caught as { code?: string }).code).toBe(code);
  if (messageMatch !== undefined) expect((caught as Error).message).toMatch(messageMatch);
}

let sequence = 0;
export function jsonResponse(
  body: unknown,
  options?: { readonly status?: number; readonly contentType?: string },
): ProviderHttpResponse {
  sequence += 1; // keep bodies distinguishable without changing content
  void sequence;
  return {
    status: options?.status ?? 200,
    contentType: options?.contentType ?? 'application/json',
    bodyText: typeof body === 'string' ? body : JSON.stringify(body),
  };
}

// --- Recorded GMGN query fixtures (clean, sanitized) ------------------------------

export const GMGN_TOKEN_SECURITY_FIXTURE = {
  data: { symbol: 'TESTCOIN', holder_count: 4211, renounced_mint: true, top10_holder_rate: 0.21 },
};

export const GMGN_WALLET_ACTIVITY_FIXTURE = {
  history: [{ signature: '3NmXfixtureSignature00000000000000000000000000', activity_type: 'swap' }],
};

// --- Recorded Helius raw getTransaction fixtures ----------------------------------

export function rawTransactionFixture(instructionProgramIds: readonly string[]): unknown {
  return {
    signature: '4RfYfixtureRawTxSignature0000000000000000000000000',
    slot: 271_828_182,
    transaction: {
      message: {
        instructions: instructionProgramIds.map((programId, index) => ({
          programId,
          accounts:
            index === 0
              ? ['9xQeWvG816bUx9EPSjvfHUwkQ4mB2uJ7u6FwWcpGRnoT', '3h3Ku9t7WcHb7LcdRqP12eC7n9Y8DkPKdmPHiugTASDE']
              : ['Gh9ZwEmdLJ8DscKNTkTqPbNwLNNBjuSzaG9Vp2KGtKJr'],
          data: '3Bxs4BmY7rTHm',
        })),
      },
    },
    meta: {},
  };
}

export const SUPPORTED_RAW_TX_PROGRAMS: readonly string[] = [
  SUPPORTED_PROGRAM_IDS.SPL_TOKEN_PROGRAM,
  SUPPORTED_PROGRAM_IDS.SYSTEM_PROGRAM,
];

export const UNSUPPORTED_PROGRAM_ID = 'Deprecated11111111111111111111111111111111111';

/** Enhanced-parser (deprecated) recorded shape — supporting evidence only. */
export const ENHANCED_PARSED_FIXTURE = {
  description: 'Swapped 100 tokens for 2 SOL',
  type: 'SWAP',
};
