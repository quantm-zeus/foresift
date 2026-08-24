// Re-export the tenant error vocabulary so consumers import it from this
// package without a second dependency edge; the registry itself lives in
// @foresift/security (one stable machine-code namespace for the perimeter).
export { SecErrorCode, TenantIsolationError } from '@foresift/security';
