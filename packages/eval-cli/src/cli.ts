#!/usr/bin/env bun

/** Thin deterministic command dispatcher; all business laws live in sibling packages. */
import {
  MaturityLedger,
  assembleDenominatorDisclosure,
  evaluatePromotionEvidence,
  samplingDiagnostics,
  type DenominatorCase,
  type PromotionEvidenceInput,
  type ResolveMaturityInput,
  type SamplingDiagnosticInput,
} from '@foresift/outcome-maturity';
import {
  analyzeMissedOpportunity,
  compareAgainstBaseline,
  compareChampionChallenger,
  computeMetricSuite,
  freezeReplayManifest,
  runFrozenReplay,
  runNegativeControl,
  type MetricSuiteInput,
  type MissedOpportunityInput,
} from '@foresift/evaluation';
import { EvalCliExitCode, type EvalCliExitCode as ExitCode } from './exit-codes.ts';
import { emitReport, type EvalCliReport } from './report.ts';

export const EVAL_COMMANDS = [
  'maturity-sweep',
  'dataset-build',
  'replay-run',
  'metric-report',
  'baseline-compare',
  'missed-scan',
  'controls-run',
  'compare-challenger',
] as const;
export type EvalCommand = (typeof EVAL_COMMANDS)[number];

// The CLI boundary receives parsed JSON (statically unknown). Each branch
// narrows the payload to the exact input contract of the callee it dispatches
// to — explicit casts document the assumption, never `any`.
interface CommandEnvelope {
  readonly populationClaim?: string;
  readonly denominatorDisclosures?: readonly unknown[];
  readonly payload: unknown;
}

export function executeEvalCommand(command: EvalCommand, envelope: CommandEnvelope): unknown {
  switch (command) {
    case 'maturity-sweep': {
      const ledger = new MaturityLedger();
      return (envelope.payload as readonly ResolveMaturityInput[]).map((item) =>
        ledger.apply(item),
      );
    }
    case 'dataset-build': {
      const dataset = envelope.payload as {
        readonly manifest: Parameters<typeof freezeReplayManifest>[0];
        readonly denominatorCases: readonly DenominatorCase[];
        readonly disclosureRef?: string;
        readonly sampling: SamplingDiagnosticInput;
      };
      return {
        manifest: freezeReplayManifest(dataset.manifest),
        disclosure: assembleDenominatorDisclosure(dataset.denominatorCases, dataset.disclosureRef),
        sampling: samplingDiagnostics(dataset.sampling),
      };
    }
    case 'replay-run':
      return runFrozenReplay(envelope.payload as Parameters<typeof runFrozenReplay>[0]);
    case 'metric-report':
      return computeMetricSuite(envelope.payload as MetricSuiteInput);
    case 'baseline-compare':
      return compareAgainstBaseline(
        envelope.payload as Parameters<typeof compareAgainstBaseline>[0],
      );
    case 'missed-scan':
      return (envelope.payload as readonly MissedOpportunityInput[]).map(analyzeMissedOpportunity);
    case 'controls-run':
      return (envelope.payload as readonly Parameters<typeof runNegativeControl>[0][]).map(
        runNegativeControl,
      );
    case 'compare-challenger': {
      const challenger = envelope.payload as {
        readonly comparison: Parameters<typeof compareChampionChallenger>[0];
        readonly promotionEvidence?: PromotionEvidenceInput;
      };
      return {
        comparison: compareChampionChallenger(challenger.comparison),
        ...(challenger.promotionEvidence
          ? { promotionEvidence: evaluatePromotionEvidence(challenger.promotionEvidence) }
          : {}),
      };
    }
  }
}

function parseArguments(argv: readonly string[]): {
  readonly command: EvalCommand;
  readonly input: string;
  readonly outPath?: string;
} {
  const command = argv[0] as EvalCommand;
  if (!EVAL_COMMANDS.includes(command)) throw new Error(`EVAL_COMMAND_UNKNOWN:${argv[0] ?? ''}`);
  const jsonIndex = argv.indexOf('--json');
  const outIndex = argv.indexOf('--out');
  if (jsonIndex < 0 || argv[jsonIndex + 1] === undefined)
    throw new Error('EVAL_INPUT_JSON_REQUIRED');
  return {
    command,
    input: argv[jsonIndex + 1]!,
    ...(outIndex >= 0 && argv[outIndex + 1] !== undefined ? { outPath: argv[outIndex + 1]! } : {}),
  };
}

function refusal(error: unknown): NonNullable<EvalCliReport['refusal']> {
  const record =
    error !== null && typeof error === 'object' ? (error as Record<string, unknown>) : {};
  return {
    code: typeof record.code === 'string' ? record.code : 'EVAL_CLI_REFUSED',
    message: error instanceof Error ? error.message : String(error),
    detail: record.detail ?? null,
  };
}

export async function main(argv: readonly string[] = process.argv.slice(2)): Promise<ExitCode> {
  let outPath: string | undefined;
  let command = argv[0] ?? 'unknown';
  try {
    const parsed = parseArguments(argv);
    command = parsed.command;
    outPath = parsed.outPath;
    const envelope = JSON.parse(parsed.input) as CommandEnvelope;
    const result = executeEvalCommand(parsed.command, envelope);
    await emitReport(
      {
        ok: true,
        command: parsed.command,
        populationClaim: envelope.populationClaim ?? null,
        denominatorDisclosures: envelope.denominatorDisclosures ?? [],
        result,
      },
      outPath,
    );
    return EvalCliExitCode.SUCCESS;
  } catch (error) {
    await emitReport(
      {
        ok: false,
        command,
        populationClaim: null,
        denominatorDisclosures: [],
        refusal: refusal(error),
      },
      outPath,
    );
    return EvalCliExitCode.REFUSED;
  }
}

if (import.meta.main) process.exitCode = await main();
