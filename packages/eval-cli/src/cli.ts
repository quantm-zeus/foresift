#!/usr/bin/env bun

/** CLI behavior is added after the evaluation engine; this is its stable bin seam. */
export async function main(_argv: readonly string[] = process.argv.slice(2)): Promise<number> {
  return 0;
}

if (import.meta.main) process.exitCode = await main();
