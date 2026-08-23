// Package entrypoint — exports are added as this package's modules land.
// Convention: every Foresift workspace package carries a tsconfig.json that
// extends ../../tsconfig.base.json and globs src/** + test/**, so new modules
// and tests require zero root-config edits (see specs/g0-contracts-data-truth
// tasks T001–T003).
export * from './adapter.ts';
export * from './local.ts';
export * from './artifact-index.ts';
export * from './staged-commit.ts';
