/**
 * Profile-binding units (FR-CORE-004): the eight §16.9 profiles bind STRICT
 * SUBSETS of the catalog (never the whole catalog), atomic tools admit only
 * adapter-test / admin-diagnostic / expert-scoped classes, STANDARD profiles
 * refuse atomic binding with typed errors, and the JSON fixture mirrors the
 * code catalogs by construction.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  ATOMIC_TOOL_CATALOG,
  DEFAULT_PROFILE_BINDINGS,
  DOMAIN_TOOL_CATALOG,
  PROFILE_CLASSES,
  admitsAtomicTools,
  isVisibleToProfile,
  profileClass,
  visibleToolsFor,
  type ProfileBinding,
} from '../src/profiles.ts';
import { ALL_TOOL_PROFILE_IDS } from '@foresift/domain';

const FIXTURE = JSON.parse(
  readFileSync(join(import.meta.dirname, '../../../tests/fixtures/core/tool-catalog.json'), 'utf8'),
) as { domainTools: string[]; atomicTools: string[] };

describe('§16.9 catalog and fixture parity', () => {
  it('binds exactly the eight default profiles', () => {
    expect(DEFAULT_PROFILE_BINDINGS.map((b) => b.id).sort()).toEqual(
      [...ALL_TOOL_PROFILE_IDS].sort(),
    );
    for (const binding of DEFAULT_PROFILE_BINDINGS) expect(binding.klass).toBe('STANDARD');
  });

  it('mirrors the JSON fixture by construction', () => {
    expect(FIXTURE.domainTools).toEqual([...DOMAIN_TOOL_CATALOG]);
    expect(FIXTURE.atomicTools).toEqual([...ATOMIC_TOOL_CATALOG]);
  });
});

describe('strict-subset admission for standard profiles', () => {
  const bindings = DEFAULT_PROFILE_BINDINGS;

  it.each(bindings.map((b) => [b.id] as const))(
    '%s sees a strict subset of the domain catalog — never all of it',
    (id) => {
      const tools = visibleToolsFor({ id, klass: 'STANDARD' });
      expect(tools.length).toBeGreaterThan(0);
      expect(tools.length).toBeLessThan(DOMAIN_TOOL_CATALOG.length);
      for (const tool of tools) expect(DOMAIN_TOOL_CATALOG).toContain(tool);
      // No duplicates, deterministic order.
      expect(new Set(tools).size).toBe(tools.length);
    },
  );

  it('no standard profile ever receives an atomic tool', () => {
    for (const binding of bindings) {
      const tools = visibleToolsFor(binding);
      for (const atomic of ATOMIC_TOOL_CATALOG) expect(tools).not.toContain(atomic);
    }
  });

  it('every profile set contains only known domain names', () => {
    for (const binding of bindings) {
      for (const tool of visibleToolsFor(binding)) {
        expect(DOMAIN_TOOL_CATALOG).toContain(tool);
      }
    }
  });
});

describe('atomic-tool visibility classes', () => {
  it.each([
    ['STANDARD', false],
    ['ADAPTER_TEST', true],
    ['ADMIN_DIAGNOSTIC', true],
    ['EXPERT_SCOPED', true],
  ] as const)('%s atomic admission is %s', (klass, admitted) => {
    expect(admitsAtomicTools(klass)).toBe(admitted);
  });

  it('STANDARD binding requesting atomic tools refuses with typed error', () => {
    expect(() =>
      visibleToolsFor({
        id: 'discovery',
        klass: 'STANDARD',
        extraAtomicTools: ['provider_adapter_probe'],
      }),
    ).toThrow(/AUTHORIZATION_REFUSED|atomic/);
  });

  it.each(['ADAPTER_TEST', 'ADMIN_DIAGNOSTIC', 'EXPERT_SCOPED'] as const)(
    '%s binding may extend with scoped atomic tools',
    (klass) => {
      const tools = visibleToolsFor({
        id: 'admin-read',
        klass,
        extraAtomicTools: ['provider_adapter_probe'],
      });
      expect(tools).toContain('provider_adapter_probe');
      expect(tools).toContain('get_asset_identity');
    },
  );

  it('visibility filter refuses atomic metadata to STANDARD regardless of listing', () => {
    const atomicTool = { name: 'provider_adapter_probe', atomic: true };
    const domainTool = { name: 'get_asset_identity' };
    const expert: ProfileBinding = { id: 'admin-read', klass: 'EXPERT_SCOPED' };
    const standard: ProfileBinding = { id: 'admin-read', klass: 'STANDARD' };
    expect(isVisibleToProfile(atomicTool, expert)).toBe(true);
    expect(isVisibleToProfile(atomicTool, standard)).toBe(false);
    expect(isVisibleToProfile(domainTool, standard)).toBe(true);
  });

  it('resolves profile classes fail-closed', () => {
    for (const klass of PROFILE_CLASSES) expect(profileClass(klass)).toBe(klass);
    expect(() => profileClass('SUPERUSER')).toThrow();
  });
});
