# Prohibited-capability scanner (FR-SEC-003, §35.7/§41.1)

Deterministic gate proving the repository stays inside the permanent
read-only boundary (`READ_ONLY_NO_TRADING_CUSTODY_SIGNING`).

## Usage

```sh
node scripts/scan-prohibited-capabilities/cli.mjs            # scan repo root
node scripts/scan-prohibited-capabilities/cli.mjs --out report.json
```

Exit 0 = clean; nonzero = findings. The JSON report is stable (sorted,
deterministic finding ids) so CI diffs are meaningful.

## What is scanned

- **Source files** — TypeScript/JavaScript sources, with CODE-CONTEXT
  signals: a raw regex match only becomes a finding when its category's
  context signals agree within ±2 lines.
- **Dependency manifests** — every committed `package.json` dependency name.
- **Inventory** — routes/tools/schemas collected by deterministic markers;
  names carrying forbidden action verbs (submit, sign, swap, …) refuse.
- **Environment schema** — variable names in `.env.example` against each
  category's forbidden-name list.

## The fixture-corpus exclusion rule

`tests/fixtures/sec/**` intentionally CONTAINS prohibited-code text:
those files are negative-acceptance fixtures consumed by AC-050/AC-254/
AC-255 tests. The scanner EXCLUDES that directory from its own verdict —
otherwise the fixtures would always trip the gate. Exclusion is limited to
that exact path prefix; nothing else is exempt.

The runtime canary (`packages/security/src/negative-capability.ts`) loads
this same `catalog.json`, and a parity test asserts the CLI and the canary
classify every fixture identically.

This scanner NEVER weakens product authority: it is a verification surface.
Findings must be fixed by removing the prohibited capability, never by
editing this catalog to look away.
