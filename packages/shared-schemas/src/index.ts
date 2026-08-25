// Package entrypoint — versioned schema mirrors of the Foresift domain
// contracts (manifest schemaRefs for the data and DR families).
// Convention: every Foresift workspace package carries a tsconfig.json that
// extends ../../tsconfig.base.json and globs src/** + test/**, so new modules
// and tests require zero root-config edits.
export * from './data.ts';
export * from './dr.ts';
export * from './sec.ts';
