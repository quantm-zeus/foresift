/**
 * MCP Credential fixtures (FR-MCP-004, FR-MCP-005, §17.5, AC-052, AC-053).
 *
 * Provides deterministic test peppers, credential seeds, raw bearer secrets (≥256-bit entropy),
 * keyed hashes, scope sets, and lifecycle states (active, expired, revoked).
 */
import { createHmac } from 'node:crypto';
import type { UtcTimestamp } from '@foresift/domain';

/** Known deterministic server-side pepper for HMAC-SHA256 in test suites. */
export const TEST_MCP_PEPPER = 'test-server-pepper-32-byte-hex-secret-0001';

/** Helper to compute keyed hash in test assertions without touching product code. */
export function computeTestKeyedHash(pepper: string, secret: string): string {
  return `sha256:${createHmac('sha256', pepper).update(secret, 'utf8').digest('hex')}`;
}

/** 32-byte raw hex secret fixture 1 (256 bits of entropy). */
export const RAW_SECRET_1 = '4a7b2c9e1f3d8a5b6c0e2f4a7b9c1d3e5f8a0b2c4d6e8f1a3b5c7d9e0f2a4b6c';
export const KEYED_HASH_1 = computeTestKeyedHash(TEST_MCP_PEPPER, RAW_SECRET_1);

/** 32-byte raw hex secret fixture 2 (256 bits of entropy). */
export const RAW_SECRET_2 = '9f8e7d6c5b4a3f2e1d0c9b8a7f6e5d4c3b2a1f0e9d8c7b6a5f4e3d2c1b0a9f8e';
export const KEYED_HASH_2 = computeTestKeyedHash(TEST_MCP_PEPPER, RAW_SECRET_2);

/** 32-byte raw hex secret fixture 3 (256 bits of entropy - for expert profile). */
export const RAW_SECRET_EXPERT = '11223344556677889900aabbccddeeff00112233445566778899aabbccddeeff';
export const KEYED_HASH_EXPERT = computeTestKeyedHash(TEST_MCP_PEPPER, RAW_SECRET_EXPERT);

/** Standard discovery credential fixture. */
export const STANDARD_DISCOVERY_CREDENTIAL = {
  credentialId: 'cred_disc_0001_standard',
  rawSecret: RAW_SECRET_1,
  keyedHash: KEYED_HASH_1,
  scopes: ['tools:read', 'tools:execute', 'discovery:read', 'resources:read'],
  originPolicyRef: 'origin-policy-standard',
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
  expiresAt: '2028-01-01T00:00:00Z' as UtcTimestamp,
  createdAt: '2026-08-01T00:00:00Z' as UtcTimestamp,
  revokedAt: null,
  lastUsedAt: null,
  lastUsedOrigin: null,
} as const;

/** Expert scoped credential fixture (admits atomic tools). */
export const EXPERT_SCOPED_CREDENTIAL = {
  credentialId: 'cred_expert_0001_scoped',
  rawSecret: RAW_SECRET_EXPERT,
  keyedHash: KEYED_HASH_EXPERT,
  scopes: ['tools:read', 'tools:execute', 'admin:read', 'atomic:read', 'resources:read'],
  originPolicyRef: 'origin-policy-expert',
  profileBindings: ['admin-read'],
  toolBounds: ['get_asset_identity', 'provider_adapter_probe', 'raw_ledger_diagnostic'],
  resourceBounds: ['evidence://*', 'run://*', 'snapshot://*'],
  entityBounds: ['solana:*'],
  rateLimitClass: 'EXPERT_PAID',
  expiresAt: '2028-01-01T00:00:00Z' as UtcTimestamp,
  createdAt: '2026-08-01T00:00:00Z' as UtcTimestamp,
  revokedAt: null,
  lastUsedAt: null,
  lastUsedOrigin: null,
} as const;

/** Expired credential fixture. */
export const EXPIRED_CREDENTIAL = {
  credentialId: 'cred_expired_0001',
  rawSecret: RAW_SECRET_2,
  keyedHash: KEYED_HASH_2,
  scopes: ['tools:read', 'tools:execute'],
  originPolicyRef: 'origin-policy-standard',
  profileBindings: ['discovery'],
  rateLimitClass: 'STANDARD_FREE',
  expiresAt: '2026-01-01T00:00:00Z' as UtcTimestamp,
  createdAt: '2025-01-01T00:00:00Z' as UtcTimestamp,
  revokedAt: null,
} as const;

/** Revoked credential fixture. */
export const REVOKED_CREDENTIAL = {
  credentialId: 'cred_revoked_0001',
  rawSecret: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
  keyedHash: computeTestKeyedHash(
    TEST_MCP_PEPPER,
    'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
  ),
  scopes: ['tools:read', 'tools:execute'],
  originPolicyRef: 'origin-policy-standard',
  profileBindings: ['discovery'],
  rateLimitClass: 'STANDARD_FREE',
  expiresAt: '2028-01-01T00:00:00Z' as UtcTimestamp,
  createdAt: '2026-08-01T00:00:00Z' as UtcTimestamp,
  revokedAt: '2026-08-02T12:00:00Z' as UtcTimestamp,
} as const;
