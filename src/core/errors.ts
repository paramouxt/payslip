/** Raised when a domain invariant would be violated. Always a caller bug or a
 *  rejected user action — never an infrastructure failure. */
export class DomainError extends Error {
  constructor(
    message: string,
    readonly code:
      | 'INVALID_ARGUMENT'
      | 'INVARIANT_VIOLATION'
      | 'NO_OP'
      | 'CURRENCY_MISMATCH'
      | 'CONFIG_INVALID' = 'INVARIANT_VIOLATION'
  ) {
    super(message);
    this.name = 'DomainError';
  }
}

/** Raised by repositories when an optimistic-concurrency check fails. */
export class ConcurrencyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConcurrencyError';
  }
}
