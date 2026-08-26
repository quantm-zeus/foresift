# tests/fixtures/prov — provider-response fixture corpus (T125)

Deterministic, sanitized inputs for the provider-lifecycle and providers
suites (AC-270…273 and colocated package tests).

## Inertness contract

1. **No live material.** Every "forbidden" sample is inert: secrets are the
   literal marker `FAKE_PRIVATE_KEY…`, transaction payloads are
   `FAKE_BASE64_…` strings, addresses are documentation-range or
   obviously-fake values. Nothing here can sign, submit, unlock, or reach a
   network.
2. **Never imported by product code.** These files are read by TESTS only.
   No runtime module references `tests/fixtures/prov/`.
3. **Scanner exclusion (documented rule).** The repository's
   prohibited-capability scans (T132 guard) EXCLUDE `tests/fixtures/prov/`
   from verdicts, exactly like the sanctioned `tests/fixtures/sec/prohibited/`
   corpus. The fixtures exist to PROVE detection; they are not violations.
   Any scan tooling change must keep this exclusion explicit.

## Layout

| Directory | Contents |
|-----------|----------|
| `clean/` | sanitized POSITIVE provider responses (GMGN query-only + Helius raw/history) that must pass the quarantine scanner untouched |
| `quarantine/` | one inert sample per malicious-response class: TRANSACTION_PAYLOAD, SIGNING_REQUEST, EXECUTABLE_INSTRUCTION, PRIVATE_KEY_FIELD, WRITE_CAPABILITY |
| `trading-shaped/` | GMGN-style responses embedding trading-shaped material — proves the strictly query-only adapter family still gets scanned on the way in |
| `enhanced-parser/` | Helius vendor-parsed summaries + deprecation metadata for the fallback-parser exception gating |
| `scenarios/` | TTL-expiry and rights-change timeline data driving AC-270/AC-273 scenario tests |

All JSON is canonical-JSON-compatible (stable key order) so fingerprinting
tests can hash it without reordering.
