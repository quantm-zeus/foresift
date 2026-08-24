// Package entrypoint — all modules of this package are exported here.
// Convention: every Foresift workspace package carries a tsconfig.json that
// extends ../../tsconfig.base.json and globs src/** + test/**, so new modules
// and tests require zero root-config edits.
export * from './adapter.ts';
export * from './local.ts';
export * from './artifact-index.ts';
export * from './staged-commit.ts';
