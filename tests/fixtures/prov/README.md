# tests/fixtures/prov/ — provider-lifecycle fixture corpus

Sanitized, INERT test data for the g0-provider-lifecycle milestone
(FR-PROV-002/006/007/008/009). By construction this directory is declarative
data ONLY: no imports, no executable content, no credentials. The
malicious-response samples under `forbidden/` are FAKE markers built to trip
the deterministic quarantine scanner in tests — they carry no working key
material, no real payload bytes, and never leave this corpus.

**Documented fixture-corpus exclusion**: production prohibited-capability
scans and quarantine storage audits EXCLUDE this directory (same rule as
`tests/fixtures/sec/prohibited/`). Nothing here is ever imported by product
code; suites load these files as raw text/JSON inputs only.

## Layout

| Path                                          | Purpose                                                                                                                                                                                       |
| --------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `gmgn/*.clean.json`                           | Positive-control recorded responses per GMGN adapter operation (query-only surface).                                                                                                          |
| `gmgn/trading-shaped-definition.variant.json` | A trading-SHAPED operation DEFINITION variant used to prove registration refuses it (FR-PROV-006). Inert description, not code.                                                               |
| `helius/*.clean.json`                         | Positive controls per Helius adapter operation.                                                                                                                                               |
| `helius/enhanced-parser.*.json`               | Deprecated enhanced-parser fixtures: clean + hazardous variants driving decoder-authority/migration-exception behavior (FR-PROV-007).                                                         |
| `forbidden/*.json`                            | One sample per malicious-response class (AC-271): fake private-key marker, transaction-payload skeleton, signing-request skeleton, executable-instruction sample, write-capability indicator. |
| `scenarios/ttl-expiry.scenario.json`          | Declarative clock/TTL timeline for AC-270 expiry → refresh drills.                                                                                                                            |
| `scenarios/rights-change.scenario.json`       | Declarative v1→v2 tightening data for AC-273 drills.                                                                                                                                          |

All fixtures are sanitized recordings or synthetic shapes; addresses use
well-known on-chain program ids or obviously fake base58, amounts are
arbitrary, and no API keys appear anywhere.
