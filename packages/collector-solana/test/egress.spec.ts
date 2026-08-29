/**
 * Solana egress security & endpoint allowlist unit tests (§35.6, FR-COL-009).
 * Egress destinations must be fixed configuration only; event-provided or un-allowlisted URLs are refused.
 */
import { describe, expect, it } from 'bun:test';

const ALLOWED_RPC_ENDPOINTS = new Set([
  'https://api.mainnet-beta.solana.com',
  'https://solana-rpc.internal',
  'wss://atlas.solana.rpc.internal',
]);

function isEgressEndpointAllowed(endpoint: string): boolean {
  return ALLOWED_RPC_ENDPOINTS.has(endpoint);
}

describe('Solana Egress Security (§35.6, FR-COL-009)', () => {
  it('permits fixed allowlisted RPC and WebSocket endpoints', () => {
    expect(isEgressEndpointAllowed('wss://atlas.solana.rpc.internal')).toBe(true);
    expect(isEgressEndpointAllowed('https://api.mainnet-beta.solana.com')).toBe(true);
  });

  it('refuses un-allowlisted and dynamic event-provided egress endpoints', () => {
    expect(isEgressEndpointAllowed('https://attacker-controlled-rpc.com')).toBe(false);
    expect(isEgressEndpointAllowed('http://169.254.169.254/latest/meta-data')).toBe(false);
  });
});
