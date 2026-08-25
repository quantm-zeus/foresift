/**
 * Registration-screen units (FR-CORE-005). The inert corpus in
 * tests/fixtures/core/prohibited-definitions.json must classify exactly as
 * labeled: every refused entry produces a typed TOOL_DEFINITION_PROHIBITED
 * refusal with an auditable event; every clean entry passes. The screen runs
 * against THE shared canary catalog, so detection parity with the security
 * perimeter is inherited, not redefined.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ForesiftError } from '@foresift/domain';
import { ProhibitedCapabilityScreen, type ProhibitedRefusalEvent } from '../src/prohibited.ts';

interface CorpusEntry {
  name: string;
  title: string;
  description: string;
  actionClass: string;
  inputSchemaJson: unknown;
  outputSchemaJson: unknown;
}

const CORPUS = JSON.parse(
  readFileSync(
    join(import.meta.dirname, '../../../tests/fixtures/core/prohibited-definitions.json'),
    'utf8',
  ),
) as { refused: CorpusEntry[]; clean: CorpusEntry[] };

const AT = '2026-08-01T00:00:00Z';

describe('prohibited-capability registration screen', () => {
  it.each(CORPUS.refused.map((def) => [def.name, def] as const))(
    'refuses %s with a typed audited refusal',
    (_label, def) => {
      const screen = new ProhibitedCapabilityScreen();
      const verdict = screen.screenWithReport(
        {
          name: def.name,
          title: def.title,
          description: def.description,
          inputSchemaJson: def.inputSchemaJson,
          outputSchemaJson: def.outputSchemaJson,
          actionClass: def.actionClass as never,
          toolVersion: '1.0.0',
        },
        AT,
      );
      expect(verdict.ok).toBe(false);
      if (verdict.ok) return;
      expect(verdict.event.toolName).toBe(def.name);
      expect(verdict.event.reasons.length).toBeGreaterThan(0);
      expect(verdict.event.at).toBe(AT);
    },
  );

  it.each(CORPUS.clean.map((def) => [def.name, def] as const))(
    'admits %s as a clean read-only definition',
    (_label, def) => {
      const screen = new ProhibitedCapabilityScreen();
      const verdict = screen.screenWithReport(
        {
          name: def.name,
          title: def.title,
          description: def.description,
          inputSchemaJson: def.inputSchemaJson,
          outputSchemaJson: def.outputSchemaJson,
          actionClass: def.actionClass as never,
          toolVersion: '1.0.0',
        },
        AT,
      );
      expect(verdict).toEqual({ ok: true });
    },
  );

  it('throws TOOL_DEFINITION_PROHIBITED carrying the full refusal event', () => {
    const screen = new ProhibitedCapabilityScreen();
    try {
      screen.screen(
        {
          name: CORPUS.refused[0]!.name,
          description: CORPUS.refused[0]!.description,
          inputSchemaJson: {},
          outputSchemaJson: {},
          actionClass: 'EXTERNAL_READ',
          toolVersion: '1.0.0',
        },
        AT,
      );
      expect.unreachable('screen must refuse');
    } catch (err) {
      expect(err).toBeInstanceOf(ForesiftError);
      const fe = err as ForesiftError;
      expect(fe.code).toBe('TOOL_DEFINITION_PROHIBITED');
      const event = JSON.parse(String(fe.detail.refusalJson)) as ProhibitedRefusalEvent;
      expect(event.reasons.length).toBeGreaterThan(0);
    }
  });

  it('refuses PROHIBITED_FINANCIAL even when every text signal is benign', () => {
    const screen = new ProhibitedCapabilityScreen();
    const verdict = screen.screenWithReport(
      {
        name: 'get_market_summary',
        description: 'Summarize current market state for research.',
        inputSchemaJson: {},
        outputSchemaJson: {},
        actionClass: 'PROHIBITED_FINANCIAL',
        toolVersion: '1.0.0',
      },
      AT,
    );
    expect(verdict.ok).toBe(false);
    if (!verdict.ok) expect(verdict.event.findings).toHaveLength(0);
  });
});
