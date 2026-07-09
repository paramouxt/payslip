/**
 * Tenancy is schema discipline, not a feature (ADR 10): every repository is
 * constructed *with* a TenantContext and scopes every query by it. There is no
 * way to call tenant-scoped data access without saying who you are.
 */
export interface TenantContext {
  readonly userId: string;
}
