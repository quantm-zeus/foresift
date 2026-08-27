// AC-250 (acceptance): a valid allowlisted MCP Origin reaches
// authentication — exact scheme/host/port tuple matches admit; NON_PRODUCTION
// deployments explicitly allow absent origins through to authentication.
import { describe, expect, it } from 'bun:test';
import { McpOriginGate } from '../../packages/security/src/mcp-origin.ts';

const PROD_GATE = new McpOriginGate({
  allowlist: ['https://mcp.example.com'],
  absentOriginPolicy: 'PRODUCTION',
});

const DEV_GATE = new McpOriginGate({
  allowlist: ['https://localhost:3000'],
  absentOriginPolicy: 'NON_PRODUCTION',
});

describe('AC-250: valid allowlisted origins reach authentication', () => {
  it('admits an exact allowlist hit with implied default port', () => {
    const verdict = PROD_GATE.decide('https://mcp.example.com');
    expect(verdict.decision).toBe('ALLOW');
  });

  it('admits the explicit :443 spelling of the same origin', () => {
    expect(PROD_GATE.decide('https://mcp.example.com:443').decision).toBe('ALLOW');
  });

  it('admits every registered origin independently', () => {
    const multi = new McpOriginGate({
      allowlist: ['https://a.example.com', 'https://b.example.com'],
      absentOriginPolicy: 'PRODUCTION',
    });
    expect(multi.decide('https://a.example.com').decision).toBe('ALLOW');
    expect(multi.decide('https://b.example.com').decision).toBe('ALLOW');
  });

  it('NON_PRODUCTION deployments let absent origins through to authentication', () => {
    expect(DEV_GATE.decide(undefined).decision).toBe('ALLOW');
    expect(DEV_GATE.decide('https://localhost:3000').decision).toBe('ALLOW');
  });
});
