/**
 * @foresift/provider-lifecycle — provider operation lifecycle truth engine
 * (FR-PROV-001…FR-PROV-010).
 *
 * Holds NO transport code and NO vendor knowledge: adapters live in
 * `@foresift/providers`, which composes THIS package's decisions with the
 * security perimeter. Public surface grows module by module as units land.
 */
export * from './errors.ts';
