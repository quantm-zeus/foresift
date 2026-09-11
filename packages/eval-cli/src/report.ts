import { writeFile } from 'node:fs/promises';

export interface EvalCliReport {
  readonly ok: boolean;
  readonly command: string;
  readonly populationClaim: string | null;
  readonly denominatorDisclosures: readonly unknown[];
  readonly result?: unknown;
  readonly refusal?: { readonly code: string; readonly message: string; readonly detail: unknown };
}

export const serializeReport = (report: EvalCliReport): string =>
  `${JSON.stringify(report, null, 2)}\n`;

export async function emitReport(report: EvalCliReport, outPath?: string): Promise<void> {
  const serialized = serializeReport(report);
  if (outPath) await writeFile(outPath, serialized, { encoding: 'utf8', flag: 'w' });
  else process.stdout.write(serialized);
}
