export const EvalCliExitCode = { SUCCESS: 0, REFUSED: 1 } as const;
export type EvalCliExitCode = (typeof EvalCliExitCode)[keyof typeof EvalCliExitCode];
