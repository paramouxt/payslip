import { DomainError } from '../errors';

/**
 * Money is integer minor units (pence) plus an ISO 4217 currency code.
 * No floats ever cross a boundary: every operation that could produce a
 * fraction demands an explicit RoundingMode, because payroll disputes are won
 * and lost on pennies and the rounding step must be auditable (it appears in
 * explanation trees).
 */
export type RoundingMode = 'HALF_UP' | 'HALF_EVEN' | 'FLOOR' | 'CEIL' | 'TRUNCATE';

const SCALE = 1_000_000;

/**
 * Round a (possibly fractional) number to an integer under an explicit mode.
 * Input is first snapped to 6 decimal places to neutralise binary float noise
 * (e.g. 167.53159999999998 from 1388 × 0.1207).
 * HALF_UP means "half away from zero", the payroll-conventional reading.
 */
export function roundToInt(value: number, mode: RoundingMode): number {
  if (!Number.isFinite(value))
    throw new DomainError('cannot round a non-finite number', 'INVALID_ARGUMENT');
  const scaled = Math.round(value * SCALE);
  const int = Math.trunc(scaled / SCALE);
  const rem = scaled - int * SCALE; // −(SCALE−1) … SCALE−1
  if (rem === 0) return int;
  const sign = rem > 0 ? 1 : -1;
  const absRem = Math.abs(rem);
  switch (mode) {
    case 'TRUNCATE':
      return int;
    case 'FLOOR':
      return rem < 0 ? int - 1 : int;
    case 'CEIL':
      return rem > 0 ? int + 1 : int;
    case 'HALF_UP':
      return absRem >= SCALE / 2 ? int + sign : int;
    case 'HALF_EVEN':
      if (absRem > SCALE / 2) return int + sign;
      if (absRem < SCALE / 2) return int;
      return int % 2 === 0 ? int : int + sign;
  }
}

export class Money {
  private constructor(
    readonly pence: number,
    readonly currency: string
  ) {}

  static of(pence: number, currency: string): Money {
    if (!Number.isSafeInteger(pence)) {
      throw new DomainError(
        `money must be integer minor units, got ${String(pence)}`,
        'INVALID_ARGUMENT'
      );
    }
    if (!/^[A-Z]{3}$/.test(currency)) {
      throw new DomainError(`invalid ISO 4217 currency: ${currency}`, 'INVALID_ARGUMENT');
    }
    return new Money(pence, currency);
  }

  static zero(currency: string): Money {
    return Money.of(0, currency);
  }

  static sum(items: readonly Money[], currency: string): Money {
    return items.reduce((acc, m) => acc.add(m), Money.zero(currency));
  }

  private assertSameCurrency(other: Money): void {
    if (other.currency !== this.currency) {
      throw new DomainError(
        `currency mismatch: ${this.currency} vs ${other.currency}`,
        'CURRENCY_MISMATCH'
      );
    }
  }

  add(other: Money): Money {
    this.assertSameCurrency(other);
    return Money.of(this.pence + other.pence, this.currency);
  }

  subtract(other: Money): Money {
    this.assertSameCurrency(other);
    return Money.of(this.pence - other.pence, this.currency);
  }

  negate(): Money {
    return Money.of(-this.pence, this.currency);
  }

  abs(): Money {
    return Money.of(Math.abs(this.pence), this.currency);
  }

  /** Multiply by an arbitrary factor (hours, FTE…) with explicit rounding. */
  multiply(factor: number, rounding: RoundingMode): Money {
    if (!Number.isFinite(factor))
      throw new DomainError('factor must be finite', 'INVALID_ARGUMENT');
    return Money.of(roundToInt(this.pence * factor, rounding), this.currency);
  }

  /** `percent(12.07, …)` = 12.07% of this amount. */
  percent(p: number, rounding: RoundingMode): Money {
    return this.multiply(p / 100, rounding);
  }

  equals(other: Money): boolean {
    return this.currency === other.currency && this.pence === other.pence;
  }

  compare(other: Money): number {
    this.assertSameCurrency(other);
    return this.pence === other.pence ? 0 : this.pence < other.pence ? -1 : 1;
  }

  get isNegative(): boolean {
    return this.pence < 0;
  }

  get isZero(): boolean {
    return this.pence === 0;
  }

  toJSON(): { pence: number; currency: string } {
    return { pence: this.pence, currency: this.currency };
  }

  /** Debug representation only — UI formatting is a locale concern. */
  toString(): string {
    const sign = this.pence < 0 ? '-' : '';
    const abs = Math.abs(this.pence);
    return `${this.currency} ${sign}${Math.trunc(abs / 100).toString()}.${(abs % 100).toString().padStart(2, '0')}`;
  }
}
