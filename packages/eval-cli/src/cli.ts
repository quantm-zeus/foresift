#!/usr/bin/env bun

/** Thin deterministic command dispatcher; all business laws live in sibling packages. */
import {
  MaturityLedger,
  assembleDenominatorDisclosure,
  evaluatePromotionEvidence,
  samplingDiagnostics,
} from '@foresift/outcome-maturity';
import {
  analyzeMissedOpportunity,
  compareAgainstBaseline,
  compareChampionChallenger,
  computeMetricSuite,
  freezeReplayManifest,
  runFrozenReplay,
  runNegativeControl,
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

interface CommandEnvelope {
  readonly populationClaim?: string;
  readonly denominatorDisclosures?: readonly unknown[];
  readonly payload: any;
}

export function executeEvalCommand(command: EvalCommand, envelope: CommandEnvelope): unknown {
  switch (command) {
    case 'maturity-sweep': {
      const ledger = new MaturityLedger();
      return (envelope.payload as readonly any[]).map((item) => ledger.apply(item));
    }
    case 'dataset-build':
      return {
        manifest: freezeReplayManifest(envelope.payload.manifest),
        disclosure: assembleDenominatorDisclosure(
          envelope.payload.denominatorCases,
          envelope.payload.disclosureRef,
        ),
        sampling: samplingDiagnostics(envelope.payload.sampling),
      };
    case 'replay-run':
      return runFrozenReplay(envelope.payload);
    case 'metric-report':
      return computeMetricSuite(envelope.payload);
    case 'baseline-compare':
      return compareAgainstBaseline(envelope.payload);
    case 'missed-scan':
      return (envelope.payload as readonly any[]).map(analyzeMissedOpportunity);
    case 'controls-run':
      return (envelope.payload as readonly any[]).map(runNegativeControl);
    case 'compare-challenger':
      return {
        comparison: compareChampionChallenger(envelope.payload.comparison),
        ...(envelope.payload.promotionEvidence
          ? { promotionEvidence: evaluatePromotionEvidence(envelope.payload.promotionEvidence) }
          : {}),
      };
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
