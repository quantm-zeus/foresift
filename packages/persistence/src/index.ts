// Package entrypoint — persistence core (engine port seam, migrator, repos).
// Convention: every Foresift workspace package carries a tsconfig.json that
// extends ../../tsconfig.base.json and globs src/** + test/**, so new modules
// and tests require zero root-config edits (see specs/g0-contracts-data-truth
// tasks T001–T003).
export * from './db.ts';
export * from './canonical-json.ts';
export * from './migrator.ts';
export * from './repos/identity.ts';
export * from './repos/observations.ts';
export * from './repos/replay.ts';
export * from './repos/backfill.ts';
export * from './repos/quality.ts';
export * from './repos/sources.ts';
export * from './feature-computation.ts';
export * from './repos/features.ts';
export * from './repos/acquisition.ts';
export * from './repos/checkpoints.ts';
export * from './repos/recovery.ts';
export * from './drill/backup.ts';
export * from './drill/restore.ts';
export * from './drill/rpo.ts';
