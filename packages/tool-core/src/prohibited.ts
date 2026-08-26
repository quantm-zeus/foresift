/**
 * Registration-time prohibited-capability screen (FR-CORE-005; PRD §5.3,
 * §16.9, permanent READ_ONLY_NO_TRADING_CUSTODY_SIGNING boundary).
 *
 * Every tool definition passes through this screen BEFORE it can reach the
 * registry: the action class must be one of the four admissible §5.3 classes
 * (PROHIBITED_FINANCIAL is structurally unregistrable already — this is the
 * behavioral backstop), and the definition's human-readable text plus schema
 * JSON are classified against THE shared security-perimeter canary catalog.
 * Refusals carry typed codes and a structured event suitable for audit.
 */
import { ForesiftError, isAdmissibleActionClass, type ActionClass } from '@foresift/domain';
import {
  NegativeCapabilityCanary,
  loadCanaryCatalog,
  type CanaryFinding,
} from '@foresift/security';

/** The fields of a definition the screen inspects (execute is never text). */
export interface ScreenedDefinitionText {
  readonly name: string;
  readonly title?: string;
  readonly description: string;
  readonly inputSchemaJson: unknown;
  readonly outputSchemaJson: unknown;
}

/** Structured refusal event — what an audit sink receives on screen failure. */
export interface ProhibitedRefusalEvent {
  readonly toolName: string;
  readonly toolVersion: string;
  /** Machine reason the registration was refused. */
  readonly reasons: readonly string[];
  /** Canary findings matched during screening (empty for class refusals). */
  readonly findings: readonly CanaryFinding[];
  readonly at: string;
}

export type ScreenVerdict =
  { readonly ok: true } | { readonly ok: false; readonly event: ProhibitedRefusalEvent };

/** Sink seam for audited registration refusals (injected at composition). */
export interface ProhibitedRefusalSink {
  recordProhibitedRefusal(event: ProhibitedRefusalEvent): Promise<void>;
}

const SCANNER_REFERENCE = 'tool-core/registration-screen';

/**
 * Classification-only screen. Constructing it loads THE shared canary catalog
 * (same file the CLI scanner and AC suites consume) unless one is injected.
 */
export class ProhibitedCapabilityScreen {
  private readonly canary: NegativeCapabilityCanary;

  constructor(
    canary: NegativeCapabilityCanary = new NegativeCapabilityCanary(loadCanaryCatalog()),
  ) {
    this.canary = canary;
  }

  /**
   * Non-throwing verdict: `ok:false` with a complete refusal event when the
   * definition is trading/signing/custody/private-key/transaction-shaped or
   * carries a non-admissible action class.
   */
  screenWithReport(
    def: ScreenedDefinitionText & { actionClass: ActionClass; toolVersion: string },
    at: string,
  ): ScreenVerdict {
    const reasons: string[] = [];
    const findings: CanaryFinding[] = [];

    if (!isAdmissibleActionClass(def.actionClass)) {
      // PROHIBITED_FINANCIAL never registers; unknown classes cannot reach
      // here because callers parse metadata through the strict schema first.
      reasons.push(`action-class ${def.actionClass} is not admissible`);
    }

    findings.push(...this.canary.checkInventory([{ name: def.name, source: SCANNER_REFERENCE }]));

    const schemaText = [
      JSON.stringify(def.inputSchemaJson ?? {}),
      JSON.stringify(def.outputSchemaJson ?? {}),
    ].join('\n');
    findings.push(
      ...this.canary.scanSourceText(
        `${SCANNER_REFERENCE}/${def.name}`,
        [def.title ?? '', def.description, schemaText].join('\n'),
      ),
    );

    for (const finding of findings) {
      reasons.push(`${finding.category} via ${finding.matchedPattern}`);
    }

    if (reasons.length === 0) return { ok: true };
    return {
      ok: false,
      event: {
        toolName: def.name,
        toolVersion: def.toolVersion,
        reasons,
        findings,
        at,
      },
    };
  }

  /**
   * Throwing variant used directly by registration: refuses with
   * TOOL_DEFINITION_PROHIBITED carrying the refusal event in `detail`.
   */
  screen(
    def: ScreenedDefinitionText & { actionClass: ActionClass; toolVersion: string },
    at: string,
  ): void {
    const verdict = this.screenWithReport(def, at);
    if (!verdict.ok) {
      throw new ForesiftError('TOOL_DEFINITION_PROHIBITED', 'tool definition refused', {
        toolName: verdict.event.toolName,
        toolVersion: verdict.event.toolVersion,
        refusalJson: JSON.stringify(verdict.event),
      });
    }
  }
}
