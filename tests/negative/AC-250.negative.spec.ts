// AC-250 (negative): a present invalid, punycode-confused, trailing-dot,
// mixed-scheme, or wrong-port Origin receives its typed refusal BEFORE any
// session/tool/resource processing. (The MCP-surface package wires refuse
// verdicts to HTTP 403.)
import { describe, expect, it } from 'vitest';
import { McpOriginGate } from '../../packages/security/src/mcp-origin.ts';

const PROD_GATE = new McpOriginGate({
  allowlist: ['https://mcp.example.com'],
  absentOriginPolicy: 'PRODUCTION',
});

describe('AC-250 negative: every invalid-origin class refuses deterministically', () => {
  it('refuses malformed and non-origin strings outright', () => {
    expect(PROD_GATE.decide('not an origin').decision).toBe('REFUSE');
    expect(PROD_GATE.decide('https://user@mcp.example.com').decision).toBe('REFUSE');
  });

  it('refuses punycode-confused lookalikes of the allowlisted host', () => {
    expect(PROD_GATE.decide('https://xn--mc-xja.example.com').decision).toBe('REFUSE');
  });

  it('refuses trailing-dot host spellings', () => {
    expect(PROD_GATE.decide('https://mcp.example.com.').decision).toBe('REFUSE');
  });

  it('refuses mixed-scheme (http) attempts at the https-only endpoint', () => {
    expect(PROD_GATE.decide('http://mcp.example.com').decision).toBe('REFUSE');
  });

  it('refuses wrong-port tuples', () => {
    expect(PROD_GATE.decide('https://mcp.example.com:8443').decision).toBe('REFUSE');
  });

  it('refuses unregistered hosts entirely', () => {
    expect(PROD_GATE.decide('https://evil.example.com').decision).toBe('REFUSE');
    expect(PROD_GATE.decide('https://unrelated.org').decision).toBe('REFUSE');
  });

  it('PRODUCTION refuses ABSENT origins (fail-closed default)', () => {
    expect(PROD_GATE.decide(undefined).decision).toBe('REFUSE');
  });
});
