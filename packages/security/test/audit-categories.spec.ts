// §35.9 coverage completeness (T108): every bullet maps to a class, every
// class is reachable, and the vocabulary matches the shared schema exactly.
import { describe, expect, it } from 'bun:test';
import { AuditActionClassSchema } from '@foresift/shared-schemas';
import {
  ALL_AUDIT_ACTION_CLASSES,
  SECTION_35_9_COVERAGE,
  section359Coverage,
} from '../src/audit-categories.ts';

describe('§35.9 audit coverage vocabulary (FR-SEC-002)', () => {
  it('maps every §35.9 bullet to a class with no gaps in either direction', () => {
    const report = section359Coverage();
    expect(report.unmappedBullets).toEqual([]);
    expect(report.uncoveredClasses).toEqual([]);
  });

  it('covers the sixteen §35.9 duties one-to-one', () => {
    expect(SECTION_35_9_COVERAGE).toHaveLength(16);
    const classes = SECTION_35_9_COVERAGE.map((b) => b.actionClass);
    expect(new Set(classes).size).toBe(16);
  });

  it('stays identical to the shared-schema vocabulary (single source of truth)', () => {
    expect([...ALL_AUDIT_ACTION_CLASSES].sort()).toEqual(
      [...AuditActionClassSchema.options].sort(),
    );
  });

  it('names the security-critical classes explicitly', () => {
    const names = ALL_AUDIT_ACTION_CLASSES.join(',');
    for (const required of [
      'BLOCKED_OPERATION',
      'APPROVAL_STEP_UP',
      'SECRET_LIFECYCLE',
      'INCIDENT_RECOVERY',
      'PAUSE_RETIREMENT_ROLLBACK',
    ]) {
      expect(names).toContain(required);
    }
  });
});
